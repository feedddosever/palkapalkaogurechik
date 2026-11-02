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

  return { verdict, results: kept, waived, attack: kept.some((r) => r.attack) };
}
