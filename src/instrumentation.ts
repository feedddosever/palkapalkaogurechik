/**
 * Runs once when a server instance starts.
 *
 * - The allowance cycle jobs (reauthorize, renew, release idle demo holds, reconcile) run here a
 *   minute and a half after start-up and then hourly, for hosts without a cron job (Render's free
 *   plan). CYCLE_JOBS_IN_PROCESS=off when a cron job runs `npm run jobs:cycles` instead.
 * - On a deployment with Claude, LeashBench runs itself a minute after start-up if the current
 *   scenarios have no finished run (src/server/bench/auto.ts). LEASHBENCH_ON_START=off turns it off.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const later = (ms: number, fn: () => void) => setTimeout(fn, ms).unref();

  if (process.env.CYCLE_JOBS_IN_PROCESS !== "off") {
    const tick = () =>
      import("@/server/payments/jobs")
        .then(async (m) => {
          const { getDb } = await import("@/server/db/client");
          const report = await m.runCycleJobs(await getDb());
          if (report.renewed.length || report.closedIdle.length || report.errors.length) {
            console.log(
              `Cycle jobs: ${report.renewed.length} renewed, ${report.closedIdle.length} idle holds released, ` +
                `${report.reauthorized.length} reauthorized, ${report.errors.length} errors`,
            );
          }
        })
        .catch((err) => console.error("Cycle jobs failed:", err));
    later(90_000, () => {
      void tick();
      setInterval(tick, 60 * 60_000).unref();
    });
  }

  if (process.env.LEASHBENCH_ON_START !== "off") {
    later(60_000, () => {
      import("@/server/bench/auto")
        .then((m) => m.maybeRunBenchOnStart())
        .catch((err) => console.error("LeashBench on start failed:", err));
    });
  }
}
