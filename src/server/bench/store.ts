import { desc, eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import type { DB } from "@/server/db/client";
import { benchReports } from "@/server/db/schema";
import { runBench, type BenchReport } from "./run";

/**
 * LeashBench on the server, where the Claude key lives: a run is recorded as "running", executes in
 * the background, and stores its report. One run at a time.
 */

const globalForBench = globalThis as unknown as { __leashBenchRunning?: string };

export function benchRunning(): string | undefined {
  return globalForBench.__leashBenchRunning;
}

export async function startBenchRun(db: DB): Promise<string> {
  const id = newId("bench");
  globalForBench.__leashBenchRunning = id;
  await db.insert(benchReports).values({ id, status: "running" });
  return id;
}

export async function executeBenchRun(db: DB, id: string, { concurrency = 2 } = {}): Promise<void> {
  try {
    const report = await runBench({ ai: true, concurrency });
    await db
      .update(benchReports)
      .set({ status: "done", report, finishedAt: new Date() })
      .where(eq(benchReports.id, id));
  } catch (err) {
    await db
      .update(benchReports)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      })
      .where(eq(benchReports.id, id));
  } finally {
    if (globalForBench.__leashBenchRunning === id) globalForBench.__leashBenchRunning = undefined;
  }
}

export async function latestBenchRun(db: DB) {
  const [row] = await db.select().from(benchReports).orderBy(desc(benchReports.createdAt)).limit(1);
  return row
    ? {
        id: row.id,
        status: row.status,
        error: row.error,
        createdAt: row.createdAt,
        finishedAt: row.finishedAt,
        report: (row.report ?? null) as BenchReport | null,
      }
    : null;
}
