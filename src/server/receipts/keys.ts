import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { signingKeys } from "@/server/db/schema";
import { env } from "@/server/env";

/**
 * Ed25519 receipt-signing keys.
 *  - Production: RECEIPT_SIGNING_KEY (PKCS#8 DER, base64). Only its public half is stored.
 *  - Development: a key is generated once and kept in the database so receipts survive restarts.
 */

export type SigningKey = { kid: string; privateKey: KeyObject; publicKeySpki: string };

export function kidFor(spkiB64: string): string {
  return `ed25519-${createHash("sha256").update(Buffer.from(spkiB64, "base64")).digest("hex").slice(0, 16)}`;
}

const spkiOf = (k: KeyObject) =>
  createPublicKey(k).export({ format: "der", type: "spki" }).toString("base64");

const globalForKeys = globalThis as unknown as { __leashSigningKey?: Promise<SigningKey> };

export function getSigningKey(db: DB): Promise<SigningKey> {
  globalForKeys.__leashSigningKey ??= (async () => {
    if (env.RECEIPT_SIGNING_KEY) {
      const privateKey = createPrivateKey({
        key: Buffer.from(env.RECEIPT_SIGNING_KEY, "base64"),
        format: "der",
        type: "pkcs8",
      });
      const publicKeySpki = spkiOf(privateKey);
      const kid = kidFor(publicKeySpki);
      await db.insert(signingKeys).values({ kid, publicKeySpki, source: "env" }).onConflictDoNothing();
      return { kid, privateKey, publicKeySpki };
    }
    const [existing] = await db
      .select()
      .from(signingKeys)
      .where(eq(signingKeys.source, "generated"))
      .limit(1);
    if (existing?.privateKeyPkcs8) {
      const privateKey = createPrivateKey({
        key: Buffer.from(existing.privateKeyPkcs8, "base64"),
        format: "der",
        type: "pkcs8",
      });
      return { kid: existing.kid, privateKey, publicKeySpki: existing.publicKeySpki };
    }
    const { privateKey } = generateKeyPairSync("ed25519");
    const publicKeySpki = spkiOf(privateKey);
    const kid = kidFor(publicKeySpki);
    await db
      .insert(signingKeys)
      .values({
        kid,
        publicKeySpki,
        privateKeyPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
        source: "generated",
      })
      .onConflictDoNothing();
    return { kid, privateKey, publicKeySpki };
  })().catch((err) => {
    globalForKeys.__leashSigningKey = undefined;
    throw err;
  });
  return globalForKeys.__leashSigningKey;
}

export function resetSigningKeyCacheForTesting(): void {
  globalForKeys.__leashSigningKey = undefined;
}

export async function getPublicKey(db: DB, kid: string): Promise<KeyObject | null> {
  const [row] = await db.select().from(signingKeys).where(eq(signingKeys.kid, kid));
  return row
    ? createPublicKey({ key: Buffer.from(row.publicKeySpki, "base64"), format: "der", type: "spki" })
    : null;
}

/** Public keys in JWK form, for /.well-known/leash-keys.json. */
export async function listPublicKeys(db: DB) {
  const rows = await db.select().from(signingKeys);
  return rows.map((r) => {
    const jwk = createPublicKey({
      key: Buffer.from(r.publicKeySpki, "base64"),
      format: "der",
      type: "spki",
    }).export({ format: "jwk" });
    return { kid: r.kid, alg: "EdDSA", use: "sig", ...jwk, createdAt: r.createdAt.toISOString() };
  });
}

/** Generates a fresh production key (base64 PKCS#8) for RECEIPT_SIGNING_KEY. */
export function generateSigningKeyForEnv(): { privateKeyPkcs8: string; kid: string } {
  const { privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    kid: kidFor(spkiOf(privateKey)),
  };
}
