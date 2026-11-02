import { getDb } from "@/server/db/client";
import { verifyReceipt } from "@/server/receipts/receipts";

/** Raw signed receipt + server-side verification, for anyone who wants to check it themselves. */
export async function GET(_req: Request, ctx: RouteContext<"/api/receipts/[id]">) {
  const { id } = await ctx.params;
  const db = await getDb();
  const { receipt, valid, checks } = await verifyReceipt(db, id);
  if (!receipt) return Response.json({ error: "Receipt not found" }, { status: 404 });
  return Response.json({
    payload: receipt.payload,
    hash: receipt.hash,
    signature: {
      alg: "EdDSA (Ed25519)",
      keyId: receipt.keyId,
      value: receipt.signature,
      encoding: "base64url",
    },
    canonicalization: "JSON with sorted keys, no whitespace (RFC 8785 style); signature over the UTF-8 bytes",
    keys: "/.well-known/leash-keys.json",
    verification: { valid, checks },
  });
}
