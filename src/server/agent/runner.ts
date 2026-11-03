import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import type { DB } from "@/server/db/client";
import { agentRuns } from "@/server/db/schema";
import { features } from "@/server/env";
import type { PayPalGateway } from "@/server/paypal";
import { refreshProposal } from "@/server/trust/engine";
import { emit } from "./events";
import { runClaudeAgent } from "./ops-agent";
import { runScriptedAgent } from "./scripted";
import type { ToolContext } from "./tools";

export const WEEKLY_RESTOCK_TASK =
  "Weekly restock: bring every supply that is below its par level back to par, then pay this week's supplier invoices from the inbox.";

export type AgentMode = "standard" | "compromised";

/**
 * Runs the ops agent once. Claude drives it when an API key is set; otherwise (and always for the
 * simulated hijack) the scripted agent uses the very same tools.
 */
export async function runAgent(
  db: DB,
  {
    workspaceId,
    agentId,
    task = WEEKLY_RESTOCK_TASK,
    mode = "standard",
    ai = features.aiLive,
    paypal,
    runId = newId("run"),
  }: {
    workspaceId: string;
    agentId: string;
    task?: string;
    mode?: AgentMode;
    ai?: boolean;
    paypal?: PayPalGateway;
    runId?: string;
  },
) {
  const driver = ai && mode === "standard" ? "claude" : "scripted";
  await db.insert(agentRuns).values({ id: runId, workspaceId, agentId, task, mode });
  await emit(db, { workspaceId, runId, type: "run_started", payload: { task, mode, driver } });
  const ctx: ToolContext = { db, workspaceId, agentId, runId, task, ai, paypal, results: [] };
  try {
    const summary = driver === "claude" ? await runClaudeAgent(ctx) : await runScriptedAgent(ctx, mode);
    // A clean run may have earned a longer leash: open a proposal for the owner (never auto-promote).
    await refreshProposal(db, agentId, { ai }).catch(() => null);
    await db
      .update(agentRuns)
      .set({ status: "succeeded", summary, finishedAt: new Date() })
      .where(eq(agentRuns.id, runId));
    await emit(db, { workspaceId, runId, type: "run_finished", payload: { summary } });
    return { runId, driver, summary, results: ctx.results, status: "succeeded" as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(agentRuns)
      .set({ status: "failed", summary: message, finishedAt: new Date() })
      .where(eq(agentRuns.id, runId));
    await emit(db, { workspaceId, runId, type: "run_failed", payload: { error: message } });
    return { runId, driver, summary: message, results: ctx.results, status: "failed" as const };
  }
}
