/**
 * Runs the Leash demo story end to end in a fresh workspace and prints what happened.
 *   npm run demo:restock              (honest agent)
 *   npm run demo:restock -- --hijack  (simulated hijacked agent)
 * Works with zero keys (scripted agent + PayPal simulator); uses Claude / PayPal sandbox when configured.
 */
import { eq } from "drizzle-orm";
import { runAgent } from "@/server/agent/runner";
import { closeDb, getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { features } from "@/server/env";
import { activateCycle, closeCycle, getActiveCycle, startCycle } from "@/server/payments/cycles";
import { decideApproval } from "@/server/payments/service";
import { getPayPal, SimulatedPayPal } from "@/server/paypal";
import { provisionWorkspace } from "@/server/workspace";

const hijack = process.argv.includes("--hijack");
const icon: Record<string, string> = {
  executed: "✅ paid",
  needs_approval: "📱 asks you",
  blocked: "⛔ blocked",
  failed: "⚠️ failed",
  denied: "✖ denied",
};

async function main() {
  const db = await getDb();
  const paypal = getPayPal();
  if (!(paypal instanceof SimulatedPayPal)) {
    console.log(
      "PayPal sandbox mode: approve the hold in a browser. This script runs in simulator mode only.",
    );
    process.exit(1);
  }
  const ws = await provisionWorkspace("demo", "demo:restock");
  console.log(
    `\nLeash demo · workspace ${ws.workspaceId} · agent: ${features.aiLive && !hijack ? "Claude" : "scripted"}${hijack ? " (simulated hijack)" : ""} · PayPal: ${paypal.mode}\n`,
  );

  const { cycleId, orderId } = await startCycle(db, {
    workspaceId: ws.workspaceId,
    agentId: ws.agentId,
    paypal,
  });
  await paypal.simApprove(orderId);
  const cycle = await activateCycle(db, cycleId, { paypal });
  console.log(
    `1. Dana approves a $${cycle.amount} weekly hold in PayPal → authorization ${cycle.paypalAuthorizationId}\n`,
  );

  const run = await runAgent(db, {
    workspaceId: ws.workspaceId,
    agentId: ws.agentId,
    mode: hijack ? "compromised" : "standard",
    paypal,
  });
  console.log("2. The ops agent works; every payment request goes through the guard:\n");
  for (const r of run.results) {
    console.log(`   ${(icon[r.status] ?? r.status).padEnd(13)} $${r.amount.padStart(7)}  ${r.supplierName}`);
    if (r.status !== "executed")
      for (const reason of r.reasons.slice(0, 2)) console.log(`                  ↳ ${reason}`);
    if (r.trust) console.log(`                  ↳ leash shortened: L${r.trust.from} → L${r.trust.to}`);
  }

  const pending = run.results.filter((r) => r.approvalId);
  for (const p of pending.slice(0, 1)) {
    const out = await decideApproval(db, p.approvalId!, { decision: "approve" }, { paypal });
    console.log(`\n3. Dana taps Approve for $${p.amount} ${p.supplierName} → ${out.status}`);
  }

  const active = await getActiveCycle(db, ws.agentId);
  const closed = await closeCycle(db, active!.id, { paypal });
  console.log(
    `\n4. Week ends: captured $${closed.capturedTotal}, released $${closed.releasedTotal} back to Dana (authorization voided)`,
  );
  const [agent] = await db.select().from(t.agents).where(eq(t.agents.id, ws.agentId));
  console.log(`   Agent autonomy level now L${agent.autonomyLevel}\n\n   Summary: ${run.summary}\n`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
