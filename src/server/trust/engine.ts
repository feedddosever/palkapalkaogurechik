import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import type { DB } from "@/server/db/client";
import * as t from "@/server/db/schema";
import type { AutonomyLevel } from "@/server/guard/types";

/**
 * Trust engine. A blocked attack shortens the leash by one level immediately.
 * (Promotions, track-record stats and AI-written proposals land in Step 11.)
 */
export async function demoteOnAttack(
  db: DB,
  {
    workspaceId,
    agentId,
    requestId,
    reason,
  }: { workspaceId: string; agentId: string; requestId: string; reason: string },
): Promise<{ from: AutonomyLevel; to: AutonomyLevel } | null> {
  const [agent] = await db.select().from(t.agents).where(eq(t.agents.id, agentId));
  if (!agent) return null;
  const from = agent.autonomyLevel as AutonomyLevel;
  const to = Math.max(0, from - 1) as AutonomyLevel;
  if (to === from) return { from, to };
  await db.update(t.agents).set({ autonomyLevel: to }).where(eq(t.agents.id, agentId));
  await db.insert(t.trustEvents).values({
    id: newId("tre"),
    workspaceId,
    agentId,
    kind: "demoted",
    fromLevel: from,
    toLevel: to,
    reason,
    evidence: { requestId },
    status: "applied",
  });
  return { from, to };
}
