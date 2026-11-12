import path from "node:path";
import { mkdirSync } from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { attachAiSpendStore } from "@/server/ai/budget";
import { env } from "@/server/env";
import * as schema from "./schema";

export type Schema = typeof schema;
export type DB = PgDatabase<PgQueryResultHKT, Schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

type Handle = { db: DB; kind: "postgres" | "pglite"; close: () => Promise<void> };

// Survive Next.js dev hot reloads: one connection + one migration run per process.
const globalForDb = globalThis as unknown as {
  __leashDb?: Promise<Handle>;
};

async function connect(): Promise<Handle> {
  if (env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
    const db = drizzle({ client: pool, schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return { db: db as unknown as DB, kind: "postgres", close: () => pool.end() };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir =
    env.PGLITE_DIR === "memory://"
      ? "memory://"
      : path.resolve(/*turbopackIgnore: true*/ env.PGLITE_DIR ?? ".data/pglite");
  if (dataDir !== "memory://") mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as DB, kind: "pglite", close: () => client.close() };
}

/** Lazily connects and applies pending migrations (zero-setup local dev). */
export function getDbHandle(): Promise<Handle> {
  globalForDb.__leashDb ??= connect()
    .then(async (handle) => {
      // Today's Claude spend survives restarts (the daily AI budget).
      await attachAiSpendStore(handle.db).catch(() => undefined);
      return handle;
    })
    .catch((err) => {
      globalForDb.__leashDb = undefined;
      throw err;
    });
  return globalForDb.__leashDb;
}

export async function getDb(): Promise<DB> {
  return (await getDbHandle()).db;
}

export async function closeDb(): Promise<void> {
  const pending = globalForDb.__leashDb;
  globalForDb.__leashDb = undefined;
  if (pending) await (await pending).close();
}

export { schema };
