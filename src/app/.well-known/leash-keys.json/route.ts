import { getDb } from "@/server/db/client";
import { listPublicKeys } from "@/server/receipts/keys";

/** Every public key that has signed Leash receipts (JWK set). */
export async function GET() {
  const db = await getDb();
  return Response.json(
    { keys: await listPublicKeys(db) },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
