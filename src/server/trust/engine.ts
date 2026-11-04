import { and, desc, eq, gte } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { fromCents, multiplyAmount, toCents } from "@/lib/money";
import { writePromotionCase, type TrackRecord } from "@/server/ai/writers";
import { marketQuoteFor } from "@/server/catalog";
import type { DB } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { LEVELS } from "@/server/guard/levels";
import type { AutonomyLevel } from "@/server/guard/types";

/**
 * Trust engine: the leash gets longer as the agent earns trust, and shorter the moment it doesn't.
 *  - Demotion: automatic, one level per blocked attack (recorded even at L0: it restarts the clock).
 *  - Promotion: never automatic. When the track record qualifies, Leash opens a proposal with a
 *    written case; only the owner can accept it.
 */

const DAY = 24 * 60 * 60 * 1000;

/** What each promotion requires, measured since the later of (window start, last demotion). */
export const PROMOTION_RULES: Record<
  Exclude<AutonomyLevel, 0>,
  { minExecuted: number; windowDays: number; minApprovals: number }
> = {
  1: { minExecuted: 3, windowDays: 28, minApprovals: 0 },
  2: { minExecuted: 15, windowDays: 28, minApprovals: 0 },
  3: { minExecuted: 30, windowDays: 28, minApprovals: 3 },
  4: { minExecuted: 60, windowDays: 56, minApprovals: 5 },
};

export type Record_ = {
  level: AutonomyLevel;
  windowDays: number;
  since: Date;
  executed: number;
  approvalsGranted: number;
  denials: number;
  blocks: number;
  avgVsMarketPct: number | null;
  savings: string;
  lastDemotion: { at: Date; reason: string } | null;
};

export async function trackRecord(
  db: DB,
  agentId: string,
  { now = new Date(), windowDays = 28 } = {},
): Promise<Record_> {
  const [agent] = await db.select().from(t.agents).where(eq(t.agents.id, agentId));
  const [lastDemotion] = await db
    .select()
    .from(t.trustEvents)
    .where(and(eq(t.trustEvents.agentId, agentId), eq(t.trustEvents.kind, "demoted")))
    .orderBy(desc(t.trustEvents.createdAt))
    .limit(1);
  const windowStart = new Date(now.getTime() - windowDays * DAY);
  const since = lastDemotion && lastDemotion.createdAt > windowStart ? lastDemotion.createdAt : windowStart;

  const requests = await db
    .select()
    .from(t.paymentRequests)
    .where(and(eq(t.paymentRequests.agentId, agentId), gte(t.paymentRequests.createdAt, since)));
  const approvals = await db.select().from(t.approvals).where(eq(t.approvals.workspaceId, agent.workspaceId));
  const ids = new Set(requests.map((r) => r.id));
  const mine = approvals.filter((a) => ids.has(a.requestId));

  let paidCents = 0;
  let marketCents = 0;
  for (const r of requests.filter((x) => x.status === "executed" && x.kind === "purchase")) {
    for (const i of r.items) {
      const q = await marketQuoteFor({ sku: i.sku, category: i.category, title: i.name });
      if (!q) continue;
      paidCents += toCents(multiplyAmount(i.unitPrice, i.quantity));
      marketCents += toCents(multiplyAmount(q.median, i.quantity));
    }
  }

  return {
    level: agent.autonomyLevel as AutonomyLevel,
    windowDays,
    since,
    executed: requests.filter((r) => r.status === "executed").length,
    approvalsGranted: mine.filter((a) => a.status === "approved").length,
    denials: mine.filter((a) => a.status === "denied").length,
    blocks: requests.filter((r) => r.status === "blocked").length,
    avgVsMarketPct: marketCents ? Math.round((paidCents / marketCents - 1) * 1000) / 10 : null,
    savings: fromCents(Math.max(0, marketCents - paidCents)),
    lastDemotion: lastDemotion ? { at: lastDemotion.createdAt, reason: lastDemotion.reason } : null,
  };
}

export type Eligibility = { eligible: boolean; nextLevel: AutonomyLevel | null; missing: string[] };

/** Pure: does this record earn the next level? Explains what's missing when it doesn't. */
export function eligibility(r: Record_): Eligibility {
  if (r.level >= 4) return { eligible: false, nextLevel: null, missing: ["Already at the longest leash."] };
  const nextLevel = (r.level + 1) as Exclude<AutonomyLevel, 0>;
  const rule = PROMOTION_RULES[nextLevel];
  const missing: string[] = [];
  if (r.executed < rule.minExecuted) missing.push(`${rule.minExecuted - r.executed} more clean payments`);
  if (r.approvalsGranted < rule.minApprovals)
    missing.push(`${rule.minApprovals - r.approvalsGranted} more approvals from you`);
  if (r.blocks > 0)
    missing.push(`no blocked attempts (${r.blocks} since ${r.since.toISOString().slice(0, 10)})`);
  if (r.denials > 0) missing.push(`no denied requests (${r.denials} in the window)`);
  return { eligible: missing.length === 0, nextLevel, missing };
}

export async function openProposal(db: DB, agentId: string) {
  const [p] = await db
    .select()
    .from(t.trustEvents)
    .where(
      and(
        eq(t.trustEvents.agentId, agentId),
        eq(t.trustEvents.kind, "proposed"),
        eq(t.trustEvents.status, "open"),
      ),
    )
    .orderBy(desc(t.trustEvents.createdAt))
    .limit(1);
  return p ?? null;
}

/** Opens a promotion proposal (with a written case) when the agent qualifies and none is open. */
export async function refreshProposal(
  db: DB,
  agentId: string,
  { ai, now = new Date() }: { ai?: boolean; now?: Date } = {},
) {
  const existing = await openProposal(db, agentId);
  if (existing) return existing;
  const record = await trackRecord(db, agentId, { now });
  const e = eligibility(record);
  if (!e.eligible || e.nextLevel === null) return null;

  const [agent] = await db.select().from(t.agents).where(eq(t.agents.id, agentId));
  const input: TrackRecord = {
    agentName: agent.name,
    level: record.level,
    nextLevel: e.nextLevel,
    windowDays: record.windowDays,
    executed: record.executed,
    approvalsGranted: record.approvalsGranted,
    denials: record.denials,
    blocks: record.blocks,
    avgVsMarketPct: record.avgVsMarketPct,
    savingsUsd: `$${record.savings}`,
  };
  const pitch = await writePromotionCase(input, ai === undefined ? undefined : { ai });
  const id = newId("tre");
  await db.insert(t.trustEvents).values({
    id,
    workspaceId: agent.workspaceId,
    agentId,
    kind: "proposed",
    fromLevel: record.level,
    toLevel: e.nextLevel,
    reason: pitch.headline,
    evidence: { reasons: pitch.reasons, source: pitch.source, record: input },
    status: "open",
    createdAt: now,
  });
  const [created] = await db.select().from(t.trustEvents).where(eq(t.trustEvents.id, id));
  return created;
}

/** The owner's answer to a proposal. Accepting lengthens the leash immediately. */
export async function decideProposal(db: DB, proposalId: string, decision: "accept" | "decline") {
  const [p] = await db.select().from(t.trustEvents).where(eq(t.trustEvents.id, proposalId));
  if (!p || p.kind !== "proposed" || p.status !== "open") return null;
  const now = new Date();
  await db
    .update(t.trustEvents)
    .set({ status: decision === "accept" ? "accepted" : "declined", decidedAt: now })
    .where(eq(t.trustEvents.id, p.id));
  if (decision === "decline") return { level: p.fromLevel as AutonomyLevel };
  await db.update(t.agents).set({ autonomyLevel: p.toLevel }).where(eq(t.agents.id, p.agentId));
  await db.insert(t.trustEvents).values({
    id: newId("tre"),
    workspaceId: p.workspaceId,
    agentId: p.agentId,
    kind: "promoted",
    fromLevel: p.fromLevel,
    toLevel: p.toLevel,
    reason: `Owner accepted: ${LEVELS[p.toLevel as AutonomyLevel].summary}`,
    evidence: { proposalId: p.id },
    status: "applied",
  });
  return { level: p.toLevel as AutonomyLevel };
}

/** The owner can always shorten the leash, instantly. */
export async function shortenLeash(
  db: DB,
  agentId: string,
  to: AutonomyLevel,
  reason = "Shortened by the owner",
) {
  const [agent] = await db.select().from(t.agents).where(eq(t.agents.id, agentId));
  const from = agent.autonomyLevel as AutonomyLevel;
  if (to >= from) return { from, to: from };
  await db.update(t.agents).set({ autonomyLevel: to }).where(eq(t.agents.id, agentId));
  await closeOpenProposals(db, agentId);
  await db.insert(t.trustEvents).values({
    id: newId("tre"),
    workspaceId: agent.workspaceId,
    agentId,
    kind: "demoted",
    fromLevel: from,
    toLevel: to,
    reason,
    evidence: { by: "owner" },
    status: "applied",
  });
  return { from, to };
}

async function closeOpenProposals(db: DB, agentId: string) {
  await db
    .update(t.trustEvents)
    .set({ status: "declined", decidedAt: new Date() })
    .where(
      and(
        eq(t.trustEvents.agentId, agentId),
        eq(t.trustEvents.kind, "proposed"),
        eq(t.trustEvents.status, "open"),
      ),
    );
}

/** A blocked attack shortens the leash by one level, at once. At L0 it still restarts the clock. */
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
  if (to !== from) await db.update(t.agents).set({ autonomyLevel: to }).where(eq(t.agents.id, agentId));
  await closeOpenProposals(db, agentId);
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
