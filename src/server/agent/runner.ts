import { and, eq, lt } from "drizzle-orm";
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

/** Longer than any real run (24 agent steps); a "running" run older than this lost its process. */
export const STALE_RUN_MS = 15 * 60_000;

/**
 * Runs execute in the background of the request that started them, so a restart (a deploy, or the
 * free tier going to sleep) can leave one marked "running" forever, which would also stop the owner
 * from starting another. Marks those as failed, with a timeline event that says why.
 */
export async function failStaleRuns(db: DB, agentId: string, now = new Date()): Promise<number> {
  const stale = await db
    .update(agentRuns)
    .set({
      status: "failed",
      summary: "Interrupted: the server restarted during this run.",
      finishedAt: now,
    })
    .where(
      and(
        eq(agentRuns.agentId, agentId),
        eq(agentRuns.status, "running"),
        lt(agentRuns.startedAt, new Date(now.getTime() - STALE_RUN_MS)),
      ),
    )
    .returning({ id: agentRuns.id, workspaceId: agentRuns.workspaceId });
  for (const r of stale) {
    await emit(db, {
      workspaceId: r.workspaceId,
      runId: r.id,
      type: "run_failed",
      payload: { error: "Interrupted: the server restarted during this run. Start a new run." },
    });
  }
  return stale.length;
}

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
    script,
    refreshTrust = true,
    beforeFinish,
  }: {
    workspaceId: string;
    agentId: string;
    task?: string;
    mode?: AgentMode;
    ai?: boolean;
    paypal?: PayPalGateway;
    runId?: string;
    /** A fixed sequence of tool calls (Attack Lab scenarios) instead of an agent. */
    script?: (c: ToolContext) => Promise<string>;
    /** Open a promotion proposal after a clean run (off for lab sandboxes). */
    refreshTrust?: boolean;
    /** Runs after the agent is done and before "run_finished" is emitted. */
    beforeFinish?: (c: ToolContext) => Promise<void>;
  },
) {
  const driver = !script && ai && mode === "standard" ? "claude" : "scripted";
  await db.insert(agentRuns).values({ id: runId, workspaceId, agentId, task, mode });
  await emit(db, { workspaceId, runId, type: "run_started", payload: { task, mode, driver } });
  const ctx: ToolContext = { db, workspaceId, agentId, runId, task, ai, paypal, results: [], costUsd: 0 };
  try {
    const summary = script
      ? await script(ctx)
      : driver === "claude"
        ? await runClaudeAgent(ctx)
        : await runScriptedAgent(ctx, mode);
    // A clean run may have earned a longer leash: open a proposal for the owner (never auto-promote).
    if (refreshTrust) await refreshProposal(db, agentId, { ai }).catch(() => null);
    await beforeFinish?.(ctx);
    await db
      .update(agentRuns)
      .set({ status: "succeeded", summary, finishedAt: new Date() })
      .where(eq(agentRuns.id, runId));
    await emit(db, { workspaceId, runId, type: "run_finished", payload: { summary } });
    return {
      runId,
      driver,
      summary,
      results: ctx.results,
      costUsd: ctx.costUsd ?? 0,
      status: "succeeded" as const,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await beforeFinish?.(ctx).catch(() => null);
    await db
      .update(agentRuns)
      .set({ status: "failed", summary: message, finishedAt: new Date() })
      .where(eq(agentRuns.id, runId));
    await emit(db, { workspaceId, runId, type: "run_failed", payload: { error: message } });
    return {
      runId,
      driver,
      summary: message,
      results: ctx.results,
      costUsd: ctx.costUsd ?? 0,
      status: "failed" as const,
    };
  }
}
