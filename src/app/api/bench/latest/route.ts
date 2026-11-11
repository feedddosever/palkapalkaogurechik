import { connection } from "next/server";
import { latestBenchRun } from "@/server/bench/store";
import { getDb } from "@/server/db/client";

/** The most recent server-side LeashBench run (public: scores and scenario results, no secrets). */
export async function GET() {
  await connection();
  const run = await latestBenchRun(await getDb());
  if (!run) return Response.json({ error: "No server-side run yet." }, { status: 404 });
  return Response.json(run, { headers: { "Cache-Control": "no-store" } });
}
