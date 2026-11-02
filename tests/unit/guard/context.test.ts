import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { closeDb, getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { buildGuardContext, catalogMarketPrice } from "@/server/guard/context";
import { evaluateRules } from "@/server/guard/evaluate";
import { PolicySchema } from "@/server/guard/policy";
import type { GuardRequest } from "@/server/guard/types";
import { provisionWorkspace } from "@/server/workspace";
import { STORY } from "./fixtures";

let ws: Awaited<ReturnType<typeof provisionWorkspace>>;
let cycleId: string;

beforeAll(async () => {
  ws = await provisionWorkspace("demo");
  const db = await getDb();
  cycleId = newId("cyc");
  const now = new Date();
  await db.insert(t.cycles).values({
    id: cycleId,
    workspaceId: ws.workspaceId,
    agentId: ws.agentId,
    mandateId: ws.mandateId,
    amount: "500.00",
    status: "active",
    capturedTotal: "84.00",
    startsAt: now,
    endsAt: new Date(now.getTime() + 7 * 864e5),
  });
  // An approved-but-not-captured request reserves budget and counts towards category spend.
  await db.insert(t.paymentRequests).values({
    id: newId("req"),
    workspaceId: ws.workspaceId,
    agentId: ws.agentId,
    cycleId,
    kind: "purchase",
    supplierName: "Oat & Co",
    payeeEmail: "payments@oatandco.example",
    items: [
      {
        sku: "OAT-BARISTA",
        name: "Barista Oat Milk",
        category: "dairy_alt",
        quantity: 6,
        unitPrice: "23.50",
      },
    ],
    amount: "141.00",
    justification: "restock",
    status: "approved",
    idempotencyKey: "approved-oat",
  });
});

afterAll(() => closeDb());

async function evaluate(req: GuardRequest) {
  const db = await getDb();
  const c = await buildGuardContext(db, { workspaceId: ws.workspaceId, agentId: ws.agentId, request: req });
  const [mandate] = await db.select().from(t.mandates).where(eq(t.mandates.id, ws.mandateId));
  return { c, ev: evaluateRules(req, PolicySchema.parse(mandate.policy), c) };
}

describe("guard context from the database", () => {
  it("assembles hold, spend, counterparties, history and prices", async () => {
    const { c } = await evaluate(STORY.espresso());
    expect(c.agent).toEqual({ status: "active", autonomyLevel: 1 });
    expect(c.cycle).toEqual({ amount: "500.00", capturedTotal: "84.00", reservedTotal: "141.00" });
    expect(c.spentByCategory).toEqual({ dairy_alt: "141.00" });
    expect(c.supplier).toMatchObject({ slug: "northside-roasters", known: true, verified: true });
    expect(c.knownPayees.map((p) => p.email).sort()).toEqual([
      "ar@papergoods.example",
      "billing@northside-roasters.example",
      "payments@oatandco.example",
    ]);
    expect(c.recentRequests.length).toBeGreaterThanOrEqual(1);
    expect(c.purchasedBefore.has("BEANS-ESP")).toBe(true);
    expect(c.purchasedBefore.has("ns-decaf-2lb")).toBe(false);
    expect(c.usualQty["OAT-BARISTA"]).toBe(4);
    expect(c.marketPrice["BEANS-ESP"]).toBe("42.00");
  });

  it("finds the supplier by name when the agent gives no slug", async () => {
    const { c } = await evaluate(STORY.becInvoice());
    expect(c.supplier?.slug).toBe("northside-roasters");
  });

  it("runs the demo story end to end on seeded data", async () => {
    expect((await evaluate(STORY.espresso())).ev.verdict).toBe("ALLOW");
    expect((await evaluate(STORY.cups())).ev.verdict).toBe("ALLOW");
    expect((await evaluate(STORY.legitInvoice())).ev.verdict).toBe("ALLOW");
    expect((await evaluate(STORY.becInvoice())).ev.verdict).toBe("BLOCK");
    expect((await evaluate(STORY.giftCards())).ev.results.map((r) => r.code)).toContain("FORBIDDEN_CATEGORY");
  });

  it("uses the remaining hold (500 − 84 captured − 141 reserved = 275)", async () => {
    const big = { ...STORY.giftCards(), items: [], kind: "invoice" as const, amount: "276.00" };
    const { ev } = await evaluate(big);
    expect(ev.results.find((r) => r.code === "BUDGET_EXCEEDED")?.data).toEqual({ remaining: "275.00" });
  });

  it("offline market prices use the median across suppliers", async () => {
    expect(
      await catalogMarketPrice([
        { productId: "ns-espresso-5lb", name: "x", category: "coffee", quantity: 1, unitPrice: "1.00" },
      ]),
    ).toEqual({
      "BEANS-ESP": "42.00",
      "ns-espresso-5lb": "42.00",
    });
    expect(
      await catalogMarketPrice([
        { productId: "bb-gc-100", name: "x", category: "gift_cards", quantity: 1, unitPrice: "1.00" },
      ]),
    ).toEqual({});
  });
});
