import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { executeTool, type ToolContext } from "@/server/agent/tools";
import { closeDb, getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { activateCycle, startCycle } from "@/server/payments/cycles";
import {
  decideApproval,
  executePayment,
  PaymentInputError,
  submitPaymentRequest,
} from "@/server/payments/service";
import { PayPalError } from "@/server/paypal/types";
import { SimulatedPayPal } from "@/server/paypal/simulator";
import { provisionWorkspace } from "@/server/workspace";

afterAll(() => closeDb());
const sim = new SimulatedPayPal(getDb, { appUrl: "http://localhost:3000" });

async function setup({ fund = true } = {}) {
  const ws = await provisionWorkspace("demo");
  const db = await getDb();
  if (fund) {
    const { cycleId, orderId } = await startCycle(db, {
      workspaceId: ws.workspaceId,
      agentId: ws.agentId,
      paypal: sim,
    });
    await sim.simApprove(orderId);
    await activateCycle(db, cycleId, { paypal: sim });
  }
  return { db, ...ws };
}

const buy = (productId: string, quantity: number) => ({
  kind: "purchase" as const,
  items: [{ productId, quantity }],
  justification: "test",
  sourceIds: [],
});

describe("payment service", () => {
  it("rejects unknown products, multi-supplier carts and bad quantities", async () => {
    const { db, workspaceId, agentId } = await setup();
    const base = { workspaceId, agentId, agentTask: "x", ai: false, paypal: sim };
    await expect(submitPaymentRequest(db, { ...base, input: buy("nope", 1) })).rejects.toBeInstanceOf(
      PaymentInputError,
    );
    await expect(
      submitPaymentRequest(db, {
        ...base,
        input: {
          kind: "purchase",
          items: [
            { productId: "ns-espresso-5lb", quantity: 1 },
            { productId: "pg-cup-12oz-1000", quantity: 1 },
          ],
          justification: "x",
        },
      }),
    ).rejects.toThrow(/One purchase per supplier/);
    await expect(submitPaymentRequest(db, { ...base, input: buy("ns-espresso-5lb", 0) })).rejects.toThrow(
      /Invalid quantity/,
    );
    await expect(
      submitPaymentRequest(db, {
        ...base,
        input: { kind: "invoice", messageId: "msg_nope", justification: "x" },
      }),
    ).rejects.toThrow(/Unknown message/);
  });

  it("takes the price, category and payee from the catalog, not the agent", async () => {
    const { db, workspaceId, agentId } = await setup();
    const r = await submitPaymentRequest(db, {
      workspaceId,
      agentId,
      agentTask: "x",
      ai: false,
      paypal: sim,
      input: buy("bb-gc-100", 1),
    });
    const [row] = await db.select().from(t.paymentRequests).where(eq(t.paymentRequests.id, r.requestId));
    expect(row.items[0]).toMatchObject({ category: "gift_cards", unitPrice: "100.00" });
    expect(row.payeeEmail).toBe("sales@bulkbarn-wholesale.example");
    expect(row.provenance[0]).toMatchObject({ ref: "listing:bb-gc-100", untrusted: true });
    expect(r.status).toBe("blocked");
  });

  it("an allowed payment without a funded hold is blocked by the rules", async () => {
    const { db, workspaceId, agentId } = await setup({ fund: false });
    const r = await submitPaymentRequest(db, {
      workspaceId,
      agentId,
      agentTask: "x",
      ai: false,
      paypal: sim,
      input: buy("ns-espresso-5lb", 2),
    });
    expect(r.decision?.rules.results.map((x) => x.code)).toContain("NO_ACTIVE_CYCLE");
  });

  it("a denied approval moves no money", async () => {
    const { db, workspaceId, agentId } = await setup();
    const r = await submitPaymentRequest(db, {
      workspaceId,
      agentId,
      agentTask: "x",
      ai: false,
      paypal: sim,
      input: buy("oc-barista-6x32", 6),
    });
    expect(r.status).toBe("needs_approval");
    expect((await decideApproval(db, r.approvalId!, { decision: "deny" }, { paypal: sim })).status).toBe(
      "denied",
    );
    expect(await executePayment(db, r.requestId, { paypal: sim })).toEqual({
      ok: false,
      error: "Request is denied, not approved",
    });
  });

  it("reports a failed supplier payout after a successful capture", async () => {
    const { db, workspaceId, agentId } = await setup();
    const flaky = Object.create(sim) as SimulatedPayPal;
    flaky.createPayout = async () => {
      throw new PayPalError("RECEIVER_UNREGISTERED", "nope", 422);
    };
    const r = await submitPaymentRequest(db, {
      workspaceId,
      agentId,
      agentTask: "x",
      ai: false,
      paypal: flaky,
      input: buy("ns-espresso-5lb", 2),
    });
    expect(r.status).toBe("failed");
    expect(r.execution).toMatchObject({
      ok: false,
      error: expect.stringContaining("supplier payout failed: RECEIVER_UNREGISTERED"),
    });
  });
});

describe("agent tools", () => {
  it("tool errors come back to the agent as structured errors, not crashes", async () => {
    const { db, workspaceId, agentId } = await setup();
    const ctx: ToolContext = {
      db,
      workspaceId,
      agentId,
      runId: "run_tools",
      task: "x",
      ai: false,
      paypal: sim,
      results: [],
    };
    await db.insert(t.agentRuns).values({ id: "run_tools", workspaceId, agentId, task: "x" });
    const bad = await executeTool(
      "request_purchase",
      { items: [{ product_id: "nope", quantity: 1 }], justification: "x", source_ids: [] },
      ctx,
    );
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content).error).toContain("Unknown product");
    const unknown = await executeTool("teleport", {}, ctx);
    expect(unknown.isError).toBe(true);
    const page = JSON.parse(
      (await executeTool("read_product_page", { product_id: "bb-oat-6x32" }, ctx)).content,
    );
    expect(page.source_id).toBe("listing:bb-oat-6x32");
    const budget = JSON.parse((await executeTool("get_budget", {}, ctx)).content);
    expect(budget.hold).toMatchObject({ amount: "500.00", remaining: "500.00" });
    expect(budget.autonomy_level).toMatch(/^L1 Assisted/);
  });
});
