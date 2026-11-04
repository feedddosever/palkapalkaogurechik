import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent } from "@/server/agent/runner";
import { closeDb, getDb } from "@/server/db/client";
import { ledgerRows, weekStart, type LedgerRow } from "@/server/ledger";
import { activateCycle, startCycle } from "@/server/payments/cycles";
import { SimulatedPayPal } from "@/server/paypal/simulator";
import { provisionWorkspace } from "@/server/workspace";

const sim = new SimulatedPayPal(getDb, { appUrl: "http://localhost:3000" });
let rows: LedgerRow[] = [];

beforeAll(async () => {
  const ws = await provisionWorkspace("demo");
  const db = await getDb();
  const { cycleId, orderId } = await startCycle(db, {
    workspaceId: ws.workspaceId,
    agentId: ws.agentId,
    paypal: sim,
  });
  await sim.simApprove(orderId);
  await activateCycle(db, cycleId, { paypal: sim });
  await runAgent(db, { workspaceId: ws.workspaceId, agentId: ws.agentId, ai: false, paypal: sim });
  rows = await ledgerRows(ws.workspaceId);
});
afterAll(() => closeDb());

describe("ledger rows", () => {
  it("weeks start on Monday (UTC)", () => {
    expect(weekStart(new Date("2026-11-04T10:00:00Z"))).toBe("2026-11-02"); // Wednesday
    expect(weekStart(new Date("2026-11-02T00:00:00Z"))).toBe("2026-11-02"); // Monday
    expect(weekStart(new Date("2026-11-08T23:00:00Z"))).toBe("2026-11-02"); // Sunday
  });

  it("includes history, this week's requests, and every PayPal hold", () => {
    expect(rows.filter((r) => r.historical && r.event === "Purchase")).toHaveLength(20);
    expect(rows.filter((r) => r.event === "PayPal hold")).toHaveLength(5);
    expect(rows.filter((r) => r.event === "Hold released")).toHaveLength(4);
    const live = rows.filter((r) => !r.historical && r.requestId);
    expect(live.map((r) => r.status).sort()).toEqual(["Blocked", "Paid", "Paid", "Paid", "Waiting for you"]);
  });

  it("only counts money that moved as spent", () => {
    for (const r of rows) expect(r.spent !== null, r.id).toBe(r.status === "Paid");
    const blocked = rows.find((r) => r.status === "Blocked")!;
    expect(blocked).toMatchObject({ amount: 112, spent: null, decidedBy: "rules + scanner" });
    expect(blocked.reason).toContain("billing@northside-roasters.example");
  });

  it("links paid rows to receipts and PayPal ids, with market comparisons and trends", () => {
    const espresso = rows.find(
      (r) => !r.historical && r.supplier === "Northside Roasters" && r.status === "Paid",
    )!;
    expect(espresso.receiptId).toMatch(/^rcp_/);
    expect(espresso.captureId).toMatch(/^SIM-C-/);
    expect(espresso.payoutBatchId).toMatch(/^SIM-P-/);
    expect(espresso.vsMarketPct).toBe(-6);
    expect(espresso.saved).toBe(5.4);
    expect(espresso.trend.length).toBeGreaterThan(1);
    expect(espresso.trend.every((n) => n >= 0)).toBe(true);
  });
});
