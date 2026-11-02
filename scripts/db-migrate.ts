/** Applies pending migrations to the configured database (Postgres or PGlite). */
import { getDbHandle, closeDb } from "@/server/db/client";

async function main() {
  const { kind } = await getDbHandle();
  console.log(`✓ migrations applied (${kind})`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
