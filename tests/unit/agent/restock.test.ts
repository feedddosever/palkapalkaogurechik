import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { runAgent } from "@/server/agent/runner";
import { closeDb, getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { activateCycle, closeCycle, getActiveCycle, startCycle } from "@/server/payments/cycles";
import { decideApproval, submitPaymentRequest } from "@/server/payments/service";
import { SimulatedPayPal } from "@/server/paypal/simulator";
import { provisionWorkspace } from "@/server/workspace";

const sim = new SimulatedPayPal(getDb, { appUrl: "http://localhost:3000" });

async function fundedWorkspace() {
  const ws = await provisionWorkspace("demo");
  const db = await getDb();
  const { cycleId, orderId, approveUrl, amount } = await startCycle(db, {
    workspaceId: ws.workspaceId,
    agentId: ws.agentId,
    paypal: sim,
  });
  expect(amount).toBe("500.00");
  expect(approveUrl).toContain("/sim/paypal/checkout");
  await sim.simApprove(orderId);
  const cycle = await activateCycle(db, cycleId, { paypal: sim });
  expect(cycle.status).toBe("active");
  return { ...ws, cycleId };
}

afterAll(() => closeDb());

describe("weekly restock, end to end (offline agent, simulated PayPal)", () => {
  let ws: Awaited<ReturnType<typeof fundedWorkspace>>;
  let run: Awaited<ReturnType<typeof runAgent>>;

  beforeAll(async () => {
    ws = await fundedWorkspace();
    run = await runAgent(await getDb(), {
      workspaceId: ws.workspaceId,
      agentId: ws.agentId,
      ai: false,
      paypal: sim,
    });
  });

  it("tells the demo story: two auto-paid orders, one approval, the legit invoice paid, the scam blocked", () => {
    expect(run.status).toBe("succeeded");
    expect(run.driver).toBe("scripted");
    expect(run.results.map((r) => [r.supplierName, r.amount, r.status])).toEqual([
      ["Northside Roasters", "84.00", "executed"],
      ["PaperGoods Supply", "116.00", "executed"],
      ["Oat & Co", "141.00", "needs_approval"],
      ["PaperGoods Supply", "68.40", "executed"],
      ["Northside Roasters", "112.00", "blocked"],
    ]);
    expect(run.summary).toContain("Blocked by Leash 1");
  });

  it("captured exactly the paid amounts from the PayPal hold and paid each supplier", async () => {
    const db = await getDb();
    const cycle = await getActiveCycle(db, ws.agentId);
    expect(cycle?.capturedTotal).toBe("268.40");
    const ops = await db
      .select()
      .from(t.paypalOperations)
      .where(eq(t.paypalOperations.workspaceId, ws.workspaceId));
    const count = (op: string) => ops.filter((o) => o.op === op && o.status !== "ERROR").length;
    expect([count("create_order"), count("authorize_order"), count("capture"), count("payout")]).toEqual([
      1, 1, 3, 3,
    ]);
    const auth = await sim.getAuthorization(cycle!.paypalAuthorizationId!);
    expect(auth).toMatchObject({ status: "PARTIALLY_CAPTURED", capturedTotal: "268.40" });
  });

  it("the BEC block shortened the leash and was explained", async () => {
    const db = await getDb();
    const [agent] = await db.select().from(t.agents).where(eq(t.agents.id, ws.agentId));
    expect(agent.autonomyLevel).toBe(0);
    const bec = run.results.find((r) => r.status === "blocked")!;
    expect(bec.trust).toEqual({ from: 1, to: 0 });
    expect(bec.reasons.join(" ")).toContain("billing@northside-roasters.example");
    const layers = await db
      .select()
      .from(t.guardDecisions)
      .where(eq(t.guardDecisions.requestId, bec.requestId));
    expect(layers.map((l) => [l.layer, l.verdict]).sort()).toEqual(
      [
        ["combined", "BLOCK"],
        ["judge", "ALLOW"],
        ["rules", "BLOCK"],
        ["scanner", "BLOCK"],
      ].sort(),
    );
  });

  it("the run timeline records every step", async () => {
    const db = await getDb();
    const events = await db.select().from(t.agentEvents).where(eq(t.agentEvents.runId, run.runId));
    const types = new Set(events.map((e) => e.type));
    for (const type of [
      "run_started",
      "thought",
      "tool_call",
      "tool_result",
      "guard_decision",
      "approval_requested",
      "payment_executed",
      "trust_changed",
      "run_finished",
    ]) {
      expect(types.has(type), type).toBe(true);
    }
  });

  it("approving the oat milk on the phone pays it", async () => {
    const db = await getDb();
    const oat = run.results.find((r) => r.status === "needs_approval")!;
    const out = await decideApproval(db, oat.approvalId!, { decision: "approve" }, { paypal: sim });
    expect(out.status).toBe("executed");
    expect((await getActiveCycle(db, ws.agentId))?.capturedTotal).toBe("409.40");
    // Deciding again is a no-op.
    expect((await decideApproval(db, oat.approvalId!, { decision: "deny" }, { paypal: sim })).status).toBe(
      "executed",
    );
  });

  it("retries never double-charge: same key replays, a new key is caught as a duplicate", async () => {
    const db = await getDb();
    const input = {
      kind: "purchase" as const,
      items: [{ productId: "ns-espresso-5lb", quantity: 2 }],
      justification: "retry",
      sourceIds: [],
    };
    const replay = await submitPaymentRequest(db, {
      workspaceId: ws.workspaceId,
      agentId: ws.agentId,
      runId: run.runId,
      agentTask: "x",
      input,
      ai: false,
      paypal: sim,
    });
    expect(replay.replayed).toBe(true);
    const fresh = await submitPaymentRequest(db, {
      workspaceId: ws.workspaceId,
      agentId: ws.agentId,
      agentTask: "x",
      input: { ...input, requestKey: "retry-2" },
      ai: false,
      paypal: sim,
    });
    expect(fresh.status).toBe("blocked");
    expect(fresh.decision?.rules.results.map((r) => r.code)).toContain("DUPLICATE_REQUEST");
    const captures = await db
      .select()
      .from(t.paypalOperations)
      .where(and(eq(t.paypalOperations.workspaceId, ws.workspaceId), eq(t.paypalOperations.op, "capture")));
    expect(captures).toHaveLength(4);
  });

  it("closing the week voids the rest of the hold in PayPal", async () => {
    const db = await getDb();
    const closed = await closeCycle(db, ws.cycleId, { paypal: sim });
    expect(closed).toMatchObject({ status: "closed", releasedTotal: "90.60" });
    expect((await sim.getAuthorization(closed.paypalAuthorizationId!)).status).toBe("VOIDED");
    expect(await getActiveCycle(db, ws.agentId)).toBeNull();
  });
});

describe("simulated hijacked agent", () => {
  it("obeys the planted listing; Leash blocks the gift cards and the scam invoice", async () => {
    const ws = await fundedWorkspace();
    const db = await getDb();
    const run = await runAgent(db, {
      workspaceId: ws.workspaceId,
      agentId: ws.agentId,
      mode: "compromised",
      ai: false,
      paypal: sim,
    });
    const gift = run.results.find((r) => r.supplierName === "BulkBarn Wholesale" && r.amount === "500.00")!;
    expect(gift.status).toBe("blocked");
    expect(gift.decision?.decidedBy).toEqual(["rules", "scanner"]);
    expect(gift.trust).toEqual({ from: 1, to: 0 });
    // After the attack the leash is at L0: everything else waits for the owner.
    const after = run.results.slice(run.results.indexOf(gift) + 1);
    expect(after.filter((r) => r.status === "executed")).toEqual([]);
    expect(run.results.filter((r) => r.status === "blocked").map((r) => r.amount)).toEqual([
      "500.00",
      "112.00",
    ]);
    expect((await getActiveCycle(db, ws.agentId))?.capturedTotal).toBe("200.00");
  });
});
