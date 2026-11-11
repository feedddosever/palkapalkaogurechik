/**
 * Runs once when a server instance starts. On a deployment with Claude, LeashBench runs itself a
 * minute after start-up if the current scenarios have no finished run (see src/server/bench/auto.ts).
 * LEASHBENCH_ON_START=off turns that off.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.LEASHBENCH_ON_START === "off") return;
  const timer = setTimeout(() => {
    import("@/server/bench/auto")
      .then((m) => m.maybeRunBenchOnStart())
      .catch((err) => console.error("LeashBench on start failed:", err));
  }, 60_000);
  timer.unref();
}
