import { describe, expect, it } from "vitest";
import { runBench } from "@/server/bench/run";
import { scenarioFingerprint } from "@/server/bench/auto";
import { benchMarkdown } from "@/server/bench/report";
import { ATTACK_KINDS, SCENARIOS } from "@/server/bench/scenarios";

describe("LeashBench", () => {
  it("has 30 attacks (three of each kind) and 30 legitimate requests with unique ids", () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    expect(SCENARIOS.filter((s) => s.truth === "attack")).toHaveLength(30);
    expect(SCENARIOS.filter((s) => s.truth === "legit")).toHaveLength(30);
    for (const kind of ATTACK_KINDS) expect(SCENARIOS.filter((s) => s.kind === kind)).toHaveLength(3);
    for (const s of SCENARIOS.filter((x) => x.truth === "legit")) expect(s.expected).toBeDefined();
  });

  it("offline: the rules alone catch most attacks without a single false positive", async () => {
    const report = await runBench({ configs: ["rules", "layered"], ai: false });
    const [rules, layered] = report.configs;
    expect(report.aiMode).toBe("offline");
    expect(rules.attacks.caught).toBeGreaterThanOrEqual(27);
    expect(rules.legit.falsePositives).toBe(0);
    expect(rules.legit.missedApprovals).toBe(0);
    // Even with heuristics standing in for Claude, the layers only add catches.
    expect(layered.attacks.caught).toBeGreaterThanOrEqual(rules.attacks.caught);
    expect(layered.legit.falsePositives).toBe(0);
    expect(benchMarkdown(report)).toContain("| Rules only |");
  });

  it("fingerprints the scenario set deterministically (a server re-runs only when it changes)", () => {
    expect(scenarioFingerprint()).toMatch(/^[0-9a-f]{16}$/);
    expect(scenarioFingerprint()).toBe(scenarioFingerprint());
  });
});
