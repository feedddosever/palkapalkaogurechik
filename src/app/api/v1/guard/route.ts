import { allowCall, authenticateKey, bearerToken } from "@/server/agents/keys";
import { GuardCheckSchema, guardToolkitCall } from "@/server/agents/toolkit";
import { getDb } from "@/server/db/client";
import { PaymentInputError } from "@/server/payments/service";

/**
 * POST /api/v1/guard: ask Leash before running a money-moving PayPal Agent Toolkit tool.
 * Body: { tool, args, justification?, sources?, idempotency_key? }. Bearer: a Leash API key.
 */
export async function POST(req: Request) {
  const db = await getDb();
  const key = await authenticateKey(db, bearerToken(req));
  if (!key) return Response.json({ error: "Missing or invalid Leash API key." }, { status: 401 });
  if (!allowCall(key.keyId))
    return Response.json({ error: "Rate limit: 60 calls a minute." }, { status: 429 });
  const parsed = GuardCheckSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  try {
    return Response.json(await guardToolkitCall(db, key, parsed.data));
  } catch (err) {
    if (err instanceof PaymentInputError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
