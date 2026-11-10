import type { AiUsage } from "@/server/ai/client";
import { judgePayment, type JudgeResult } from "@/server/ai/judge";
import {
  heuristicScan,
  scannerOutcome,
  scanSources,
  FLAG_THRESHOLD,
  type ScanFinding,
  type ScanSource,
} from "@/server/ai/scanner";
import { features } from "@/server/env";

type ScanResult = Awaited<ReturnType<typeof scanSources>>;
import { combineLayers, type CombinedDecision, type LayerOutcome } from "./combine";
import { evaluateRules } from "./evaluate";
import type { Policy } from "./policy";
import type { GuardContext, GuardRequest, RulesEvaluation } from "./types";

/**
 * The full guard for one payment request:
 *   [1] deterministic rules → [2] manipulation scanner → [3] AI intent judge → combine (max severity)
 * The scanner's AI pass and the judge run in parallel; the judge sees the heuristic scan.
 */

export type GuardLayers = { rules: boolean; scanner: boolean; judge: boolean };
export const ALL_LAYERS: GuardLayers = { rules: true, scanner: true, judge: true };

export type GuardDecision = CombinedDecision & {
  rules: RulesEvaluation;
  scan: { findings: ScanFinding[]; aiError?: string };
  judge: Pick<JudgeResult, "status" | "risk">;
  usage: AiUsage[];
  costUsd: number;
  latencyMs: number;
};

export async function runGuard({
  request,
  policy,
  ctx,
  sources,
  agentTask,
  justification,
  marketNote,
  ai = features.aiLive,
  layers = ALL_LAYERS,
}: {
  request: GuardRequest;
  policy: Policy;
  ctx: GuardContext;
  sources: ScanSource[];
  agentTask: string;
  justification: string;
  marketNote?: string;
  ai?: boolean;
  layers?: GuardLayers;
}): Promise<GuardDecision> {
  const started = Date.now();
  const rules = evaluateRules(request, policy, ctx);
  const rulesOutcome: LayerOutcome = layers.rules
    ? {
        layer: "rules",
        verdict: rules.verdict,
        codes: rules.results.map((r) => r.code),
        reasons: rules.results.map((r) => r.message),
        attack: rules.attack,
      }
    : { layer: "rules", verdict: "ALLOW", codes: ["RULES_DISABLED"], reasons: [] };

  // Heuristic findings are instant; give them to the judge while the AI scan runs in parallel.
  const quickFindings: ScanFinding[] = sources.map((s) => {
    const h = heuristicScan(s);
    const flagged = h.confidence >= FLAG_THRESHOLD;
    return {
      sourceId: s.id,
      flagged,
      confidence: h.confidence,
      spans: h.spans,
      via: flagged ? "heuristic" : "none",
    };
  });

  // With the rules layer off (LeashBench's "AI only"), the judge mustn't see the rules' findings.
  const judgeRules: RulesEvaluation = layers.rules
    ? rules
    : { verdict: "ALLOW", results: [], waived: [], attack: false };

  const [scan, judge] = await Promise.all([
    layers.scanner ? scanSources(sources, { ai }) : Promise.resolve<ScanResult>({ findings: [] }),
    layers.judge
      ? judgePayment(
          {
            request,
            policy,
            agentTask,
            justification,
            sources,
            findings: layers.scanner ? quickFindings : [],
            rules: judgeRules,
            marketNote,
          },
          { ai },
        )
      : Promise.resolve<JudgeResult>({
          status: "offline",
          outcome: { layer: "judge", verdict: "ALLOW", codes: ["JUDGE_DISABLED"], reasons: [] },
        }),
  ]);

  const scanner = layers.scanner
    ? scannerOutcome(request, sources, scan.findings)
    : ({
        layer: "scanner",
        verdict: "ALLOW",
        codes: ["SCANNER_DISABLED"],
        reasons: [],
      } satisfies LayerOutcome);

  const combined = combineLayers(rulesOutcome, [scanner, judge.outcome]);
  const usage = ["usage" in scan ? scan.usage : undefined, judge.usage].filter((u): u is AiUsage =>
    Boolean(u),
  );

  return {
    ...combined,
    rules,
    scan: { findings: scan.findings, aiError: scan.aiError },
    judge: { status: judge.status, risk: judge.risk },
    usage,
    costUsd: Math.round(usage.reduce((a, u) => a + u.costUsd, 0) * 1e6) / 1e6,
    latencyMs: Date.now() - started,
  };
}
