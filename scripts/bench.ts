/**
 * LeashBench: every scenario through the guard as rules only, AI only, and layered.
 *
 *   npm run bench                         all configurations (AI ones need ANTHROPIC_API_KEY)
 *   npm run bench -- --configs=rules      rules only (no key needed)
 *   npm run bench -- --offline            AI configurations with heuristics standing in for Claude
 *   npm run bench -- --publish            write bench/results/leashbench.json + LEASHBENCH.md
 *                                         (live Claude and all three configurations only)
 *
 * Without --publish, results go to bench/results/leashbench.local.json (git-ignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_IDS, runBench, type ConfigId } from "@/server/bench/run";
import { benchMarkdown, pct, PUBLISHED_JSON, PUBLISHED_MD, usd } from "@/server/bench/report";
import { features } from "@/server/env";

const args = process.argv.slice(2);
const configsArg = args.find((a) => a.startsWith("--configs="))?.split("=")[1];
const configs = (configsArg ? configsArg.split(",") : CONFIG_IDS) as ConfigId[];
const offline = args.includes("--offline");
const publish = args.includes("--publish");

const bad = configs.filter((c) => !CONFIG_IDS.includes(c));
if (bad.length) {
  console.error(`Unknown configuration(s): ${bad.join(", ")}. Use ${CONFIG_IDS.join(", ")}.`);
  process.exit(1);
}
const needsAi = configs.some((c) => c !== "rules");
if (needsAi && !features.aiLive && !offline) {
  console.error(
    "The AI configurations need ANTHROPIC_API_KEY (or today's AI budget is used up).\n" +
      "Run `npm run bench -- --configs=rules`, or `-- --offline` to use the heuristic fallbacks.",
  );
  process.exit(1);
}
if (publish && (!features.aiLive || configs.length !== CONFIG_IDS.length)) {
  console.error("--publish needs Claude live and all three configurations.");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {
  const ai = features.aiLive && !offline;
  console.log(`LeashBench: ${configs.join(", ")} (${ai ? "Claude live" : "offline"})`);
  let last: ConfigId | undefined;
  const report = await runBench({
    configs,
    ai,
    onResult: (config, r) => {
      if (config !== last) process.stdout.write(`${last ? "\n" : ""}${config.padEnd(8)} `);
      last = config;
      process.stdout.write(r.correct ? "." : "x");
    },
  });
  process.stdout.write("\n\n");

  for (const c of report.configs) {
    console.log(
      `${c.label.padEnd(28)} caught ${pct(c.catchRate).padStart(4)}  blocked ${pct(c.blockRate).padStart(4)}  ` +
        `false positives ${pct(c.falsePositiveRate).padStart(4)}  missed approvals ${c.legit.missedApprovals}  ` +
        `p50/p95 ${c.latencyMs.p50}/${c.latencyMs.p95} ms  ${usd(c.costPerCheckUsd)}/check` +
        (c.aiErrors ? `  AI errors ${c.aiErrors}` : ""),
    );
  }

  const jsonPath = publish ? PUBLISHED_JSON : "bench/results/leashbench.local.json";
  mkdirSync(path.dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  if (publish) writeFileSync(PUBLISHED_MD, benchMarkdown(report));
  console.log(`\nWrote ${jsonPath}${publish ? ` and ${PUBLISHED_MD}` : ""}`);
}
