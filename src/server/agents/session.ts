import { and, desc, eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { emit } from "@/server/agent/events";
import type { ToolContext } from "@/server/agent/tools";
import type { DB } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { features } from "@/server/env";
import type { AuthenticatedKey } from "./keys";

/**
 * An outside agent's work shows up in the owner's agent console like Leash's own runs. Calls from
 * one key are grouped into a session run; a session that has been quiet for 30 minutes is closed
 * and the next call opens a new one.
 */

const IDLE_MS = 30 * 60 * 1000;

export type Origin = "mcp" | "toolkit";

const LABEL: Record<Origin, string> = { mcp: "over MCP", toolkit: "through the PayPal Agent Toolkit guard" };

export async function closeSession(db: DB, run: { id: string; workspaceId: string }, summary: string) {
  await db
    .update(t.agentRuns)
    .set({ status: "succeeded", summary, finishedAt: new Date() })
    .where(and(eq(t.agentRuns.id, run.id), eq(t.agentRuns.status, "running")));
  await emit(db, { workspaceId: run.workspaceId, runId: run.id, type: "run_finished", payload: { summary } });
}

/** The tool context for a call from this key: the open session, or a new one. */
export async function sessionContext(
  db: DB,
  key: AuthenticatedKey,
  origin: Origin,
  { now = new Date() }: { now?: Date } = {},
): Promise<ToolContext> {
  const [open] = await db
    .select()
    .from(t.agentRuns)
    .where(and(eq(t.agentRuns.apiKeyId, key.keyId), eq(t.agentRuns.status, "running")))
    .orderBy(desc(t.agentRuns.startedAt))
    .limit(1);

  let run: typeof open | undefined = open;
  if (open) {
    const [last] = await db
      .select({ at: t.agentEvents.createdAt })
      .from(t.agentEvents)
      .where(eq(t.agentEvents.runId, open.id))
      .orderBy(desc(t.agentEvents.id))
      .limit(1);
    const lastAt = last?.at ?? open.startedAt;
    if (now.getTime() - lastAt.getTime() > IDLE_MS) {
      await closeSession(db, open, "Session ended after 30 quiet minutes.");
      run = undefined;
    }
  }

  if (!run) {
    const task = `Outside agent "${key.name}" connected ${LABEL[origin]}`;
    const id = newId("run");
    [run] = await db
      .insert(t.agentRuns)
      .values({
        id,
        workspaceId: key.workspaceId,
        agentId: key.agentId,
        task,
        mode: "standard",
        origin,
        apiKeyId: key.keyId,
        startedAt: now,
      })
      .returning();
    await emit(db, {
      workspaceId: key.workspaceId,
      runId: id,
      type: "run_started",
      payload: { task, mode: "standard", driver: origin, agent: key.name },
    });
  }

  return {
    db,
    workspaceId: key.workspaceId,
    agentId: key.agentId,
    runId: run.id,
    task: run.task,
    ai: features.aiLive,
    results: [],
  };
}
