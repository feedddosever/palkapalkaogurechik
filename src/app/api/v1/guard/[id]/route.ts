import { z } from "zod";
import { authenticateKey, bearerToken } from "@/server/agents/keys";
import { guardStatus, reportToolkitResult } from "@/server/agents/toolkit";
import { getDb } from "@/server/db/client";
import { PaymentInputError } from "@/server/payments/service";

/** GET: where a guarded call stands. POST { ok, paypal_id?, error? }: report what the tool did. */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/guard/[id]">) {
  const db = await getDb();
  const key = await authenticateKey(db, bearerToken(req));
  if (!key) return Response.json({ error: "Missing or invalid Leash API key." }, { status: 401 });
  const status = await guardStatus(db, key, (await ctx.params).id);
  return status ? Response.json(status) : Response.json({ error: "Not found." }, { status: 404 });
}

const Result = z.object({
  ok: z.boolean(),
  paypal_id: z.string().max(64).optional(),
  error: z.string().max(500).optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/v1/guard/[id]">) {
  const db = await getDb();
  const key = await authenticateKey(db, bearerToken(req));
  if (!key) return Response.json({ error: "Missing or invalid Leash API key." }, { status: 401 });
  const parsed = Result.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Body must be { ok, paypal_id?, error? }." }, { status: 400 });
  try {
    return Response.json(await reportToolkitResult(db, key, (await ctx.params).id, parsed.data));
  } catch (err) {
    if (err instanceof PaymentInputError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
