import { eventsSince } from "./events";
import { getDb } from "@/server/db/client";

/** Server-Sent Events for one agent run, limited to events of `workspaceId`. */
export async function runEventStream(req: Request, runId: string, workspaceId: string | null) {
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
      let finished = workspaceId === null;
      const deadline = Date.now() + 10 * 60 * 1000;
      while (!finished && !req.signal.aborted && Date.now() < deadline) {
        const events = (await eventsSince(db, runId, lastId)).filter((e) => e.workspaceId === workspaceId);
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
