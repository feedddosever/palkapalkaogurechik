/**
 * The allowance scheduler: reauthorize holds after PayPal's honor period, renew ended periods from
 * the owner's vaulted PayPal, and reconcile the ledger with PayPal's Transaction Search.
 *   npm run jobs:cycles   (Render cron job; safe to run as often as you like)
 */
import { closeDb, getDb } from "@/server/db/client";
import { runCycleJobs } from "@/server/payments/jobs";

async function main() {
  const report = await runCycleJobs(await getDb());
  console.log(JSON.stringify(report, null, 2));
  await closeDb();
  if (report.errors.length) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
