import { eventsSince } from "@/server/agent/events";
import { getDb } from "@/server/db/client";
import { currentWorkspaceId } from "@/server/views";

/** Server-Sent Events: the live timeline of one agent run (scoped to the caller's workspace). */
export async function GET(req: Request, ctx: RouteContext<"/api/runs/[id]/events">) {
  const { id } = await ctx.params;
  const workspaceId = await currentWorkspaceId();
  const db = await getDb();
  const encoder = new TextEncoder();
  let lastId = Number(new URL(req.url).searchParams.get("after") ?? 0) || 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* client went away */
        }
      };
      let finished = false;
      const deadline = Date.now() + 10 * 60 * 1000;
      while (!finished && !req.signal.aborted && Date.now() < deadline) {
        const events = (await eventsSince(db, id, lastId)).filter((e) => e.workspaceId === workspaceId);
        for (const e of events) {
          lastId = e.id;
          send(
            `id: ${e.id}\nevent: agent\ndata: ${JSON.stringify({ id: e.id, type: e.type, payload: e.payload, at: e.createdAt })}\n\n`,
          );
          if (e.type === "run_finished" || e.type === "run_failed") finished = true;
        }
        if (!finished) {
          if (events.length === 0) send(": ping\n\n");
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      send("event: end\ndata: {}\n\n");
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
