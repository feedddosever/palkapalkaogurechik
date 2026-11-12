import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { runAgent } from "@/server/agent/runner";
import { closeDb, getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { activateCycle, getActiveCycle, startCycle } from "@/server/payments/cycles";
import {
  reauthorizeIfDue,
  reconcileWorkspace,
  renewCycle,
  runCycleJobs,
  settleWindowMs,
} from "@/server/payments/jobs";
import { SimulatedPayPal } from "@/server/paypal/simulator";
import { provisionWorkspace } from "@/server/workspace";

const DAY = 24 * 60 * 60 * 1000;
let clock = new Date();
const sim = new SimulatedPayPal(getDb, { appUrl: "http://localhost:3000", clock: () => clock });

afterAll(() => closeDb());

async function funded({ vault = true, kind = "demo" as "demo" | "sandbox" } = {}) {
  const db = await getDb();
  const ws = await provisionWorkspace(kind);
  const { cycleId, orderId } = await startCycle(db, {
    workspaceId: ws.workspaceId,
    agentId: ws.agentId,
    paypal: sim,
    vault,
    now: clock,
  });
  await sim.simApprove(orderId);
  const cycle = await activateCycle(db, cycleId, { paypal: sim });
  return { ...ws, cycle };
}

describe("reauthorize after PayPal's honor period", () => {
  it("waits for the honor period, refreshes the unspent amount once, and captures still work", async () => {
    clock = new Date();
    const db = await getDb();
    const ws = await funded();
    await runAgent(db, { workspaceId: ws.workspaceId, agentId: ws.agentId, ai: false, paypal: sim });
    const before = (await getActiveCycle(db, ws.agentId))!;
    expect(before.capturedTotal).not.toBe("0.00");

    expect(await reauthorizeIfDue(db, before.id, { paypal: sim, now: clock })).toMatchObject({
      status: "not_due",
    });

    clock = new Date(clock.getTime() + 3.5 * DAY);
    const out = await reauthorizeIfDue(db, before.id, { paypal: sim, now: clock });
    expect(out.status).toBe("reauthorized");
    const after = (await getActiveCycle(db, ws.agentId))!;
    expect(after.paypalAuthorizationId).not.toBe(before.paypalAuthorizationId);
    expect(after.reauthorizedAt).not.toBeNull();
    const remaining = (Number(before.amount) - Number(before.capturedTotal)).toFixed(2);
    expect(out.status === "reauthorized" && out.amount).toBe(remaining);

    expect(await reauthorizeIfDue(db, before.id, { paypal: sim, now: clock })).toMatchObject({
      status: "not_due",
      reason: "Already reauthorized once.",
    });

    // The refreshed hold can still be drawn down and voided at week end.
    const cap = await sim.capture(after.paypalAuthorizationId!, {
      amount: "10.00",
      currency: "USD",
      finalCapture: false,
      requestId: `test-cap-${after.id}`,
    });
    expect(cap.status).toBe("COMPLETED");
  });
});

describe("renew at the end of the period", () => {
  it("voids the rest and places next week's hold from the vaulted PayPal, with no one present", async () => {
    clock = new Date();
    const db = await getDb();
    const ws = await funded();
    expect(ws.cycle.paypalVaultId).toMatch(/^SIM-V-/);
    clock = new Date(clock.getTime() + 7 * DAY);
    const out = await renewCycle(db, ws.cycle.id, { paypal: sim, now: clock });
    expect(out.how).toBe("vault");
    expect(out.closed.status).toBe("closed");
    expect(out.closed.releasedTotal).toBe("500.00");
    expect(out.next).toMatchObject({ status: "active", amount: "500.00", previousCycleId: ws.cycle.id });
    expect(out.next!.paypalAuthorizationId).toMatch(/^SIM-A-/);
    expect(out.next!.paypalAuthorizationId).not.toBe(ws.cycle.paypalAuthorizationId);

    const again = await renewCycle(db, ws.cycle.id, { paypal: sim, now: clock });
    expect(again.next!.id).toBe(out.next!.id);
    const active = await db.select().from(t.cycles).where(eq(t.cycles.agentId, ws.agentId));
    expect(active.filter((c) => c.status === "active")).toHaveLength(1);
  });

  it("without a vault, asks the owner to approve the next hold", async () => {
    clock = new Date();
    const db = await getDb();
    const ws = await funded({ vault: false });
    const out = await renewCycle(db, ws.cycle.id, { paypal: sim, now: clock });
    expect(out.how).toBe("owner");
    expect(out.next!.status).toBe("pending_approval");
    expect(out.approveUrl).toContain("/sim/paypal/checkout");
  });
});

describe("reconcile with PayPal's Transaction Search", () => {
  it("matches every capture and payout after a demo run", async () => {
    clock = new Date();
    const db = await getDb();
    const ws = await funded();
    await runAgent(db, { workspaceId: ws.workspaceId, agentId: ws.agentId, ai: false, paypal: sim });
    const r = await reconcileWorkspace(db, ws.workspaceId, {
      paypal: sim,
      now: new Date(clock.getTime() + 1000),
    });
    expect(r.checked).toBeGreaterThanOrEqual(6); // 3 payments × (capture + payout)
    expect(r.matched).toBe(r.checked);
    expect(r.issues).toEqual([]);
    expect(settleWindowMs("sandbox")).toBeGreaterThan(0);
  });

  it("flags missing, mismatched and unknown money movements", async () => {
    clock = new Date();
    const db = await getDb();
    const ws = await funded();
    await runAgent(db, { workspaceId: ws.workspaceId, agentId: ws.agentId, ai: false, paypal: sim });
    const [capture] = await db
      .select()
      .from(t.paypalOperations)
      .where(eq(t.paypalOperations.workspaceId, ws.workspaceId))
      .then((ops) => ops.filter((o) => o.op === "capture"));
    await db.update(t.paypalOperations).set({ amount: "1.00" }).where(eq(t.paypalOperations.id, capture.id));
    await db.insert(t.paypalOperations).values({
      id: "ppo_fake_missing",
      workspaceId: ws.workspaceId,
      op: "capture",
      mode: "sim",
      paypalId: "SIM-C-NEVERHAPPENED",
      status: "COMPLETED",
      amount: "25.00",
      createdAt: new Date(clock.getTime() - 60_000),
    });
    const cycle = (await getActiveCycle(db, ws.agentId))!;
    await sim.capture(cycle.paypalAuthorizationId!, {
      amount: "5.00",
      currency: "USD",
      finalCapture: false,
      requestId: "unrecorded-capture",
    });

    const r = await reconcileWorkspace(db, ws.workspaceId, { paypal: sim, now: new Date(Date.now() + 1000) });
    const kinds = r.issues.map((i) => i.kind).sort();
    expect(kinds).toEqual(["amount_mismatch", "missing_in_paypal", "unknown_in_paypal"]);
    expect(r.issues.find((i) => i.kind === "amount_mismatch")).toMatchObject({ ours: "1.00" });
  });
});

describe("the scheduled tick", () => {
  it("renews ended periods that were used, closes idle ones, and skips lab sandboxes", async () => {
    clock = new Date();
    const db = await getDb();
    const used = await funded();
    await runAgent(db, { workspaceId: used.workspaceId, agentId: used.agentId, ai: false, paypal: sim });
    const idle = await funded();
    const lab = await funded({ kind: "sandbox" });

    clock = new Date(clock.getTime() + 8 * DAY);
    const report = await runCycleJobs(db, { paypal: sim, now: clock });
    expect(report.renewed.map((r) => r.cycleId)).toContain(used.cycle.id);
    expect(report.renewed.find((r) => r.cycleId === used.cycle.id)?.how).toBe("vault");
    expect(report.closedIdle).toContain(idle.cycle.id);
    expect([...report.renewed.map((r) => r.cycleId), ...report.closedIdle]).not.toContain(lab.cycle.id);
    expect(report.errors).toEqual([]);

    // Reconciliation looks at the last 7 days: run a tick "now" and the used café is checked, clean.
    const today = await runCycleJobs(db, { paypal: sim, now: new Date(Date.now() + 1000) });
    expect(today.reconciled.find((r) => r.workspaceId === used.workspaceId)).toMatchObject({ issues: 0 });
  });
});

describe("idle demo cafés", () => {
  it("releases the hold of a café idle for 2 hours, mid-week, and places no new one", async () => {
    const HOUR = 60 * 60 * 1000;
    clock = new Date();
    const db = await getDb();
    const idle = await funded();
    const busy = await funded();
    clock = new Date(clock.getTime() + 3 * HOUR);
    await db.insert(t.agentRuns).values({
      id: `run_busy_${Date.now()}`,
      workspaceId: busy.workspaceId,
      agentId: busy.agentId,
      task: "Weekly restock",
      status: "succeeded",
      startedAt: new Date(clock.getTime() - HOUR),
    });

    const report = await runCycleJobs(db, { paypal: sim, now: clock });
    expect(report.closedIdle).toContain(idle.cycle.id);
    expect(report.closedIdle).not.toContain(busy.cycle.id);
    expect(report.renewed.map((r) => r.cycleId)).not.toContain(idle.cycle.id);
    expect(await getActiveCycle(db, idle.agentId)).toBeFalsy();
    expect(await getActiveCycle(db, busy.agentId)).toBeTruthy();
    const auth = await sim.getAuthorization(idle.cycle.paypalAuthorizationId!);
    expect(auth.status).toBe("VOIDED");
  });
});
