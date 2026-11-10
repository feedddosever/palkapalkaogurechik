import { eq, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { aiSpend } from "@/server/db/schema";

/**
 * Estimated Claude spend for the current UTC day, across every visitor of this deployment.
 *
 * The daily budget (AI_DAILY_BUDGET_USD) is checked synchronously wherever the app decides between
 * Claude and its offline fallbacks, so the running total lives in memory. It is written through to
 * the database so a restart (or a free-tier wake-up) doesn't reset it. The cap is soft: a check or an
 * agent run that has already started finishes even if it crosses the line.
 */
type State = { day: string; usd: number; db?: DB };

const globalForSpend = globalThis as unknown as { __leashAiSpend?: State };

function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function state(): State {
  const today = utcDay();
  const s = (globalForSpend.__leashAiSpend ??= { day: today, usd: 0 });
  if (s.day !== today) {
    s.day = today;
    s.usd = 0;
  }
  return s;
}

export function aiSpentToday(): number {
  return state().usd;
}

/** Adds one call's estimated cost to today's total. */
export function recordAiSpend(usd: number): void {
  if (!Number.isFinite(usd) || usd <= 0) return;
  const s = state();
  s.usd += usd;
  if (!s.db) return;
  void s.db
    .insert(aiSpend)
    .values({ day: s.day, usd: usd.toFixed(6) })
    .onConflictDoUpdate({
      target: aiSpend.day,
      set: { usd: sql`${aiSpend.usd} + excluded.usd`, updatedAt: new Date() },
    })
    .catch(() => undefined);
}

/** Called once the database is ready: persists from now on and picks up what was spent today. */
export async function attachAiSpendStore(db: DB): Promise<void> {
  const s = state();
  s.db = db;
  const [row] = await db.select({ usd: aiSpend.usd }).from(aiSpend).where(eq(aiSpend.day, s.day));
  s.usd = Math.max(s.usd, Number(row?.usd ?? 0));
}

/** Test hook. */
export function resetAiSpendForTesting(): void {
  globalForSpend.__leashAiSpend = undefined;
}
