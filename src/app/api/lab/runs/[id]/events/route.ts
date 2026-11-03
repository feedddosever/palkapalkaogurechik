import { eq } from "drizzle-orm";
import { runEventStream } from "@/server/agent/sse";
import { getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";

/** Public live timeline of an Attack Lab run (only ever streams that run's sandbox events). */
export async function GET(req: Request, ctx: RouteContext<"/api/lab/runs/[id]/events">) {
  const { id } = await ctx.params;
  const db = await getDb();
  const [lab] = await db.select().from(t.labRuns).where(eq(t.labRuns.id, id));
  return runEventStream(req, lab?.runId ?? "", lab?.workspaceId ?? null);
}
