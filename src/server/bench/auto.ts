import { createHash } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
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
  // A run started before this process did belonged to an instance a deploy or restart has replaced
  // (it will be stopped, if it isn't already): record it as cut off and run again here.
  const processStart = new Date(Date.now() - process.uptime() * 1000);
  await db
    .update(benchReports)
    .set({
      status: "failed",
      error: "Interrupted: the server restarted during this run.",
      finishedAt: new Date(),
    })
    .where(and(eq(benchReports.status, "running"), lt(benchReports.createdAt, processStart)));
  const id = await startBenchRun(db);
  await executeBenchRun(db, id, { fingerprint });
  return id;
}
