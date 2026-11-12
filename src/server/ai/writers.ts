import * as z from "zod/v4";
import { features } from "@/server/env";
import { LEVELS } from "@/server/guard/levels";
import type { AutonomyLevel } from "@/server/guard/types";
import { runStructured, type AiUsage } from "./client";

/** Short owner-facing writing. Every writer has a deterministic offline template. */

export type TrackRecord = {
  agentName: string;
  level: AutonomyLevel;
  nextLevel: AutonomyLevel;
  windowDays: number;
  executed: number;
  approvalsGranted: number;
  denials: number;
  blocks: number;
  /** Average price vs Channel3 market median, e.g. -6.2 means 6.2% below market. */
  avgVsMarketPct: number | null;
  savingsUsd: string;
};

export type PromotionCase = {
  headline: string;
  reasons: string[];
  source: "ai" | "offline";
  usage?: AiUsage;
};

const PromotionOutput = z.object({ headline: z.string(), reasons: z.array(z.string()) });

const PROMOTION_SYSTEM = `You write a short, honest recommendation for a small-business owner about giving their AI operations agent more autonomy ("a longer leash"). Use only the numbers provided; never invent facts. Headline: one sentence, ≤ 12 words, phrased as a question. Reasons: 3-4 short bullet sentences: the track record, what the new level would let the agent do, and what still always needs the owner (blocks are never waived). Plain, warm, no hype.`;

export function promotionOffline(r: TrackRecord): PromotionCase {
  const next = LEVELS[r.nextLevel];
  const reasons = [
    `${r.executed} payments in the last ${r.windowDays} days, all within your rules: ${r.approvalsGranted} approved by you, ${r.denials} denied, ${r.blocks} blocked.`,
    r.avgVsMarketPct !== null
      ? `It paid ${Math.abs(r.avgVsMarketPct).toFixed(1)}% ${r.avgVsMarketPct <= 0 ? "below" : "above"} market prices on average (${r.savingsUsd} saved).`
      : `It saved ${r.savingsUsd} versus market prices.`,
    `At L${r.nextLevel} (${next.name}): ${next.summary}`,
    "Blocked patterns (gift cards, changed bank details, split payments) still never go through.",
  ];
  return {
    headline: `Give ${r.agentName} a longer leash: move to L${r.nextLevel} ${next.name}?`,
    reasons,
    source: "offline",
  };
}

export async function writePromotionCase(
  r: TrackRecord,
  { ai = features.aiLive } = {},
): Promise<PromotionCase> {
  if (!ai) return promotionOffline(r);
  try {
    const { data, usage } = await runStructured({
      tier: "smart",
      system: PROMOTION_SYSTEM,
      user: JSON.stringify(
        { ...r, currentLevel: LEVELS[r.level], proposedLevel: LEVELS[r.nextLevel] },
        null,
        2,
      ),
      schema: PromotionOutput,
      effort: "low",
      maxTokens: 2000,
    });
    return { headline: data.headline, reasons: data.reasons.slice(0, 4), source: "ai", usage };
  } catch {
    return promotionOffline(r);
  }
}
