import { runEventStream } from "@/server/agent/sse";
import { currentWorkspaceId } from "@/server/views";

/** Server-Sent Events: the live timeline of one agent run (scoped to the caller's workspace). */
export async function GET(req: Request, ctx: RouteContext<"/api/runs/[id]/events">) {
  const { id } = await ctx.params;
  return runEventStream(req, id, await currentWorkspaceId());
}
