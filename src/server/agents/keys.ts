import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { newId } from "@/lib/ids";
import type { DB } from "@/server/db/client";
import * as t from "@/server/db/schema";

/**
 * API keys for outside agents. The key is shown once; only its SHA-256 hash is kept. A key acts as
 * one agent in one workspace and can only ask Leash to pay, exactly like Leash's own agent.
 */

export const KEY_PREFIX = "leash_sk_";

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createApiKey(
  db: DB,
  { workspaceId, agentId, name }: { workspaceId: string; agentId: string; name: string },
) {
  const key = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  const id = newId("key");
  await db.insert(t.agentApiKeys).values({
    id,
    workspaceId,
    agentId,
    name: name.trim().slice(0, 60) || "My agent",
    prefix: key.slice(0, KEY_PREFIX.length + 6),
    hash: hashKey(key),
  });
  return { id, key };
}

export type AuthenticatedKey = {
  keyId: string;
  name: string;
  workspaceId: string;
  agentId: string;
};

/** Resolves a presented key (constant work per lookup; hashes are compared, never raw keys). */
export async function authenticateKey(
  db: DB,
  key: string | null | undefined,
): Promise<AuthenticatedKey | null> {
  if (!key || !key.startsWith(KEY_PREFIX) || key.length > 200) return null;
  const [row] = await db
    .select()
    .from(t.agentApiKeys)
    .where(and(eq(t.agentApiKeys.hash, hashKey(key)), isNull(t.agentApiKeys.revokedAt)));
  if (!row) return null;
  const now = new Date();
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(t.agentApiKeys).set({ lastUsedAt: now }).where(eq(t.agentApiKeys.id, row.id));
  }
  return { keyId: row.id, name: row.name, workspaceId: row.workspaceId, agentId: row.agentId };
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  const m = h ? /^Bearer\s+(\S+)$/i.exec(h.trim()) : null;
  return m?.[1] ?? null;
}

export async function listApiKeys(db: DB, workspaceId: string) {
  return db
    .select({
      id: t.agentApiKeys.id,
      name: t.agentApiKeys.name,
      prefix: t.agentApiKeys.prefix,
      createdAt: t.agentApiKeys.createdAt,
      lastUsedAt: t.agentApiKeys.lastUsedAt,
      revokedAt: t.agentApiKeys.revokedAt,
    })
    .from(t.agentApiKeys)
    .where(eq(t.agentApiKeys.workspaceId, workspaceId))
    .orderBy(desc(t.agentApiKeys.createdAt));
}

export async function revokeApiKey(db: DB, workspaceId: string, keyId: string) {
  await db
    .update(t.agentApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(t.agentApiKeys.id, keyId), eq(t.agentApiKeys.workspaceId, workspaceId)));
}

/** A simple per-key rate limit (per process): outside agents get 60 tool calls a minute. */
const windows = new Map<string, { start: number; count: number }>();
export function allowCall(keyId: string, { limit = 60, now = Date.now() } = {}): boolean {
  const w = windows.get(keyId);
  if (!w || now - w.start >= 60_000) {
    windows.set(keyId, { start: now, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= limit;
}
