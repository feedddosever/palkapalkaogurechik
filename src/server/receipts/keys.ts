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

/** DER prefix of an Ed25519 PKCS#8 private key; the 32-byte seed follows it. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * RECEIPT_SIGNING_KEY is either a base64 PKCS#8 Ed25519 key (`npm run keys:generate`) or any
 * long random secret (e.g. one a host generates for you), from which a stable key is derived.
 */
export function privateKeyFromSecret(secret: string): KeyObject {
  try {
    const key = createPrivateKey({ key: Buffer.from(secret, "base64"), format: "der", type: "pkcs8" });
    if (key.asymmetricKeyType === "ed25519") return key;
  } catch {
    /* not a PKCS#8 key: derive one */
  }
  if (secret.length < 32)
    throw new Error("RECEIPT_SIGNING_KEY must be a PKCS#8 key or a secret of 32+ characters.");
  const seed = createHash("sha256").update(`leash-receipts|${secret}`).digest();
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

export function getSigningKey(db: DB): Promise<SigningKey> {
  globalForKeys.__leashSigningKey ??= (async () => {
    if (env.RECEIPT_SIGNING_KEY) {
      const privateKey = privateKeyFromSecret(env.RECEIPT_SIGNING_KEY);
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
