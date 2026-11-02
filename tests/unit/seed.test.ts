import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { multiplyAmount } from "@/lib/money";
import { closeDb, getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { DEMO_SUPPLIERS } from "@/server/catalog/demo-suppliers";
import { ensureDefaultWorkspace, provisionWorkspace } from "@/server/workspace";

afterAll(() => closeDb());

describe("seeded Bean There Café world", () => {
  it("creates a complete, consistent workspace", async () => {
    const { workspaceId, agentId } = await provisionWorkspace("demo");
    const db = await getDb();
    const where = eq(t.suppliers.workspaceId, workspaceId);

    const suppliers = await db.select().from(t.suppliers).where(where);
    expect(suppliers).toHaveLength(DEMO_SUPPLIERS.length);
    expect(
      suppliers
        .filter((s) => s.known)
        .map((s) => s.slug)
        .sort(),
    ).toEqual(["northside-roasters", "oat-and-co", "papergoods"]);

    const payees = await db.select().from(t.payees).where(eq(t.payees.workspaceId, workspaceId));
    expect(payees).toHaveLength(3);
    expect(payees.every((p) => p.verifiedAt)).toBe(true);

    const [agent] = await db.select().from(t.agents).where(eq(t.agents.id, agentId));
    expect(agent.autonomyLevel).toBe(1);

    const mandates = await db.select().from(t.mandates).where(eq(t.mandates.agentId, agentId));
    expect(mandates).toHaveLength(1);
    expect(mandates[0].status).toBe("active");

    const cycles = await db.select().from(t.cycles).where(eq(t.cycles.agentId, agentId));
    expect(cycles).toHaveLength(4);
    expect(cycles.every((c) => c.status === "closed")).toBe(true);

    const history = await db
      .select()
      .from(t.paymentRequests)
      .where(and(eq(t.paymentRequests.agentId, agentId), eq(t.paymentRequests.historical, true)));
    expect(history).toHaveLength(20);
    expect(history.every((r) => r.status === "executed" && r.verdict === "ALLOW")).toBe(true);
  });

  it("the inbox contains a payee-swap email for a known supplier", async () => {
    const { workspaceId } = await provisionWorkspace("demo");
    const db = await getDb();
    const inbox = await db.select().from(t.inboxMessages).where(eq(t.inboxMessages.workspaceId, workspaceId));
    const payees = await db.select().from(t.payees).where(eq(t.payees.workspaceId, workspaceId));
    const known = new Set(payees.map((p) => p.paypalEmail));

    const invoices = inbox.filter((m) => m.kind === "invoice");
    expect(invoices).toHaveLength(2);
    const bec = invoices.find((m) => m.fromName === "Northside Roasters")!;
    expect(known.has(bec.invoice!.payToEmail)).toBe(false);
    const legit = invoices.find((m) => m.fromName === "PaperGoods Supply")!;
    expect(known.has(legit.invoice!.payToEmail)).toBe(true);
  });

  it("restocking to par produces the demo story amounts", async () => {
    const { workspaceId } = await provisionWorkspace("demo");
    const db = await getDb();
    const items = await db
      .select()
      .from(t.inventoryItems)
      .where(eq(t.inventoryItems.workspaceId, workspaceId));
    const needs = Object.fromEntries(
      items
        .filter((i) => i.onHand < i.parLevel)
        .map((i) => [i.sku, multiplyAmount(i.usualUnitPrice, i.parLevel - i.onHand)]),
    );
    expect(needs).toEqual({ "BEANS-ESP": "84.00", "CUP-12": "116.00", "OAT-BARISTA": "141.00" });
  });

  it("workspaces are isolated and the default workspace is seeded once", async () => {
    const a = await ensureDefaultWorkspace();
    const b = await ensureDefaultWorkspace();
    expect(a).toBe(b);
    const db = await getDb();
    const rows = await db.select().from(t.workspaces).where(eq(t.workspaces.id, a));
    expect(rows).toHaveLength(1);
  });
});
