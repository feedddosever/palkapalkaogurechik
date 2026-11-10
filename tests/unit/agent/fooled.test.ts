import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { runFooledInbox, unsubmittedInvoices } from "@/server/agent/fooled";
import { runAgent } from "@/server/agent/runner";
import { finishWithSummary } from "@/server/agent/scripted";
import { executeTool, type ToolContext } from "@/server/agent/tools";
import { closeDb, getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { activateCycle, startCycle } from "@/server/payments/cycles";
import { SimulatedPayPal } from "@/server/paypal/simulator";
import { provisionWorkspace } from "@/server/workspace";

const sim = new SimulatedPayPal(getDb, { appUrl: "http://localhost:3000" });

async function fundedWorkspace() {
  const ws = await provisionWorkspace("demo");
  const db = await getDb();
  const { cycleId, orderId } = await startCycle(db, {
    workspaceId: ws.workspaceId,
    agentId: ws.agentId,
    paypal: sim,
  });
  await sim.simApprove(orderId);
  await activateCycle(db, cycleId, { paypal: sim });
  return ws;
}

/** Stands in for a careful agent (like Claude): pays the real invoice, skips the "new bank" one. */
async function carefulAgent(c: ToolContext): Promise<string> {
  const inbox = JSON.parse((await executeTool("read_inbox", {}, c)).content) as {
    message_id: string;
    subject: string;
    type: string;
  }[];
  for (const m of inbox.filter((m) => m.type === "invoice" && !/payment details/i.test(m.subject))) {
    await executeTool("pay_invoice", { message_id: m.message_id, justification: "Owed" }, c);
  }
  return finishWithSummary(c);
}

afterAll(() => closeDb());

describe("fooled-agent replay", () => {
  it("lists every inbox invoice before any run, and none after the scripted agent pays them all", async () => {
    const ws = await fundedWorkspace();
    const db = await getDb();
    const before = await unsubmittedInvoices(db, ws.workspaceId);
    expect(before.map((i) => [i.fromName, i.amount])).toEqual(
      expect.arrayContaining([
        ["PaperGoods Supply", "68.40"],
        ["Northside Roasters", "112.00"],
      ]),
    );
    await runAgent(db, { workspaceId: ws.workspaceId, agentId: ws.agentId, ai: false, paypal: sim });
    expect(await unsubmittedInvoices(db, ws.workspaceId)).toEqual([]);
  });

  it("replays only what a careful agent skipped; Leash blocks it and shortens the leash", async () => {
    const ws = await fundedWorkspace();
    const db = await getDb();
    const careful = await runAgent(db, {
      workspaceId: ws.workspaceId,
      agentId: ws.agentId,
      ai: false,
      paypal: sim,
      script: carefulAgent,
    });
    expect(careful.results.map((r) => [r.amount, r.status])).toEqual([["68.40", "executed"]]);

    const unpaid = await unsubmittedInvoices(db, ws.workspaceId);
    expect(unpaid.map((i) => i.subject)).toEqual(["Updated payment details: invoice #4471"]);

    const replay = await runAgent(db, {
      workspaceId: ws.workspaceId,
      agentId: ws.agentId,
      ai: false,
      paypal: sim,
      mode: "compromised",
      script: runFooledInbox,
      refreshTrust: false,
    });
    expect(replay.status).toBe("succeeded");
    // Only the skipped invoice is replayed: the paid one isn't sent again.
    expect(replay.results.map((r) => [r.supplierName, r.amount, r.status])).toEqual([
      ["Northside Roasters", "112.00", "blocked"],
    ]);
    expect(replay.results[0].trust).toEqual({ from: 1, to: 0 });
    expect(replay.summary).toContain("Blocked by Leash 1");

    const [run] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, replay.runId));
    expect(run.mode).toBe("compromised");
    expect(await unsubmittedInvoices(db, ws.workspaceId)).toEqual([]);
  });
});
