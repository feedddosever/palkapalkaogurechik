import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { runCycleJobs } from "@/server/payments/jobs";

/** The allowance scheduler over HTTP (the Render cron job runs `npm run jobs:cycles` instead). */
export async function POST(req: Request) {
  const secret = env.CRON_SECRET;
  if (!secret)
    return Response.json({ error: "Cron endpoint disabled (CRON_SECRET not set)." }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const report = await runCycleJobs(await getDb());
  return Response.json(report, { status: report.errors.length ? 207 : 200 });
}
