import { asc, eq, gt, and } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { agentEvents } from "@/server/db/schema";

/** Everything the agent and the guard do during a run, streamed to the UI timeline. */
export type AgentEventType =
  | "run_started"
  | "thought"
  | "tool_call"
  | "tool_result"
  | "guard_decision"
  | "approval_requested"
  | "payment_executed"
  | "payment_failed"
  | "trust_changed"
  | "run_finished"
  | "run_failed";

export async function emit(
  db: DB,
  e: { workspaceId: string; runId: string; type: AgentEventType; payload: Record<string, unknown> },
): Promise<void> {
  await db
    .insert(agentEvents)
    .values({ workspaceId: e.workspaceId, runId: e.runId, type: e.type, payload: e.payload });
}

export async function eventsSince(db: DB, runId: string, afterId = 0) {
  return db
    .select()
    .from(agentEvents)
    .where(and(eq(agentEvents.runId, runId), gt(agentEvents.id, afterId)))
    .orderBy(asc(agentEvents.id));
}
