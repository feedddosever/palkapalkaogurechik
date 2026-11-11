import { after } from "next/server";
import { isAdminRequest } from "@/server/admin";
import { benchRunning, executeBenchRun, startBenchRun } from "@/server/bench/store";
import { getDb } from "@/server/db/client";
import { features } from "@/server/env";

/**
 * Runs LeashBench on the server with its Claude key (operator only: x-leash-admin-token =
 * CRON_SECRET). Returns at once; the report lands at GET /api/bench/latest in a few minutes.
 */
export async function POST(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!features.aiLive) {
    return Response.json(
      { error: "Claude isn't live here (no key, or today's AI budget is used up)." },
      { status: 409 },
    );
  }
  const running = benchRunning();
  if (running) return Response.json({ error: "A run is already in progress.", id: running }, { status: 409 });
  const db = await getDb();
  const id = await startBenchRun(db);
  after(() => executeBenchRun(db, id));
  return Response.json({ id, status: "running", poll: "/api/bench/latest" }, { status: 202 });
}
