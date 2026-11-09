// Render cron job: asks the web service to run the allowance scheduler (reauthorize, renew,
// reconcile). Dependency-free so the cron service needs no build. Exits non-zero on failure.
const base = process.env.LEASH_INTERNAL ? `http://${process.env.LEASH_INTERNAL}` : process.env.LEASH_URL;
if (!base || !process.env.CRON_SECRET) {
  console.error("Set LEASH_INTERNAL (or LEASH_URL) and CRON_SECRET.");
  process.exit(1);
}
const res = await fetch(`${base}/api/cron/cycles`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
});
console.log(res.status, await res.text());
if (res.status !== 200 && res.status !== 207) process.exit(1);
