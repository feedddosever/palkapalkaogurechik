/**
 * Wipes the database and re-seeds the default Bean There Café workspace.
 * PGlite: deletes the data directory. Postgres: drops and recreates the public schema.
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { count } from "drizzle-orm";
import { closeDb, getDbHandle } from "@/server/db/client";
import { paymentRequests } from "@/server/db/schema";
import { env } from "@/server/env";
import { ensureDefaultWorkspace } from "@/server/workspace";

async function main() {
  if (env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    await pool.query(
      "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
    );
    await pool.end();
  } else if (env.PGLITE_DIR !== "memory://") {
    rmSync(path.resolve(env.PGLITE_DIR ?? ".data/pglite"), { recursive: true, force: true });
  }

  const { db, kind } = await getDbHandle();
  const ws = await ensureDefaultWorkspace();
  const [{ n }] = await db.select({ n: count() }).from(paymentRequests);
  console.log(`✓ ${kind} reset; seeded workspace ${ws} (${n} historical payments)`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
