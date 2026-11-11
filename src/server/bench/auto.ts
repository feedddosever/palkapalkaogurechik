import { createHash } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { benchReports } from "@/server/db/schema";
import { features } from "@/server/env";
import { SCENARIOS } from "./scenarios";
import { benchRunning, executeBenchRun, startBenchRun } from "./store";

/**
 * LeashBench runs itself on a deployment with Claude: once after the server starts, if there's no
 * finished run of the current scenario set. No secret and no public trigger; the daily AI budget
 * still applies. Results: GET /api/bench/latest (published with `npm run bench -- --from=<url>`).
 */

/** Changes whenever a scenario's request, sources, task or expected outcome changes. */
export function scenarioFingerprint(): string {
  const canonical = SCENARIOS.map((s) => ({
    id: s.id,
    truth: s.truth,
    expected: s.expected,
    task: s.task,
    justification: s.justification,
    request: s.request(),
    sources: s.sources ?? [],
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}

export async function maybeRunBenchOnStart(): Promise<string | null> {
  if (!features.aiLive || benchRunning()) return null;
  const db = await getDb();
  const fingerprint = scenarioFingerprint();
  const done = await db
    .select({ report: benchReports.report })
    .from(benchReports)
    .where(eq(benchReports.status, "done"))
    .orderBy(desc(benchReports.createdAt))
    .limit(5);
  if (done.some((r) => (r.report as { fingerprint?: string } | null)?.fingerprint === fingerprint))
    return null;
  // Another instance (or one a restart cut off) may be on it; give that 30 minutes.
  const [recent] = await db
    .select({ id: benchReports.id })
    .from(benchReports)
    .where(
      and(eq(benchReports.status, "running"), gt(benchReports.createdAt, new Date(Date.now() - 30 * 60_000))),
    )
    .limit(1);
  if (recent) return null;
  const id = await startBenchRun(db);
  await executeBenchRun(db, id, { fingerprint });
  return id;
}
