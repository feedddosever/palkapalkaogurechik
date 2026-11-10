import { sql } from "drizzle-orm";
import { getDbHandle } from "@/server/db/client";
import { aiBudgetReached, publicFeatureSnapshot } from "@/server/env";

/** Liveness + integration status. Used by Render health checks and the judge-mode banner. */
export async function GET() {
  const startedAt = Date.now();
  try {
    const { db, kind } = await getDbHandle();
    await db.execute(sql`select 1`);
    return Response.json({
      ok: true,
      db: kind,
      features: publicFeatureSnapshot(),
      /** Claude is configured but today's AI_DAILY_BUDGET_USD is used up (offline until 00:00 UTC). */
      aiBudgetReached: aiBudgetReached(),
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown error" },
      { status: 503 },
    );
  }
}
