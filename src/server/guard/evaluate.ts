import type { Policy } from "./policy";
import { applyLevel, levelGate } from "./levels";
import { RULES } from "./rules";
import { maxVerdict, type GuardContext, type GuardRequest, type RulesEvaluation } from "./types";

/** Runs every deterministic rule, then the autonomy-level overlay. Pure function. */
export function evaluateRules(req: GuardRequest, policy: Policy, ctx: GuardContext): RulesEvaluation {
  const findings = RULES.flatMap((rule) => rule(req, policy, ctx));
  const { kept, waived } = applyLevel(findings, req, ctx);

  let verdict = maxVerdict(...kept.map((r) => r.verdict));
  if (verdict === "ALLOW") {
    const gate = levelGate(ctx.agent.autonomyLevel);
    if (gate) {
      kept.push(gate);
      verdict = gate.verdict;
    }
  }

  // Most important first: attack signals, then blocks, then approvals (stable within each group).
  const rank = (r: (typeof kept)[number]) => (r.attack ? 0 : r.verdict === "BLOCK" ? 1 : 2);
  const results = kept
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
  return { verdict, results, waived, attack: kept.some((r) => r.attack) };
}
