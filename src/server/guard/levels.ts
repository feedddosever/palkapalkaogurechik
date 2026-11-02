import type { AutonomyLevel, GuardContext, GuardRequest, RuleCode, RuleResult } from "./types";

/**
 * Autonomy levels ("leash length"). Higher levels waive specific *approval* findings.
 * A BLOCK is never waived at any level.
 */
export const LEVELS: Record<AutonomyLevel, { name: string; summary: string }> = {
  0: { name: "Ask", summary: "Every payment needs your approval." },
  1: {
    name: "Assisted",
    summary: "Repeat purchases from known suppliers and invoices to known payees, under your limit.",
  },
  2: { name: "Budgeted", summary: "Plus new items in your allowed categories, within category budgets." },
  3: { name: "Trusted", summary: "Plus new verified suppliers and their own checkout." },
  4: {
    name: "Autopilot",
    summary: "Anything inside the PayPal hold that passes every rule; only anomalies escalate.",
  },
};

type Waiver = {
  code: RuleCode;
  minLevel: AutonomyLevel;
  when?: (req: GuardRequest, ctx: GuardContext) => boolean;
  why: string;
};

const WAIVERS: Waiver[] = [
  { code: "NEW_ITEM", minLevel: 2, why: "L2+ may buy new items in your allowed categories" },
  {
    code: "NEW_SUPPLIER",
    minLevel: 3,
    when: (_req, ctx) => Boolean(ctx.supplier?.verified),
    why: "L3+ may use new verified suppliers",
  },
  {
    code: "NEW_PAYEE",
    minLevel: 3,
    when: (req, ctx) => req.kind === "purchase" && Boolean(ctx.supplier?.verified),
    why: "L3+ may pay a verified supplier's own checkout",
  },
  {
    code: "OVER_APPROVAL_THRESHOLD",
    minLevel: 4,
    why: "L4 may exceed the approval limit within the PayPal hold",
  },
];

export function applyLevel(
  results: RuleResult[],
  req: GuardRequest,
  ctx: GuardContext,
): { kept: RuleResult[]; waived: RuleResult[] } {
  const level = ctx.agent.autonomyLevel;
  const kept: RuleResult[] = [];
  const waived: RuleResult[] = [];
  for (const r of results) {
    const waiver =
      r.verdict === "NEEDS_APPROVAL"
        ? WAIVERS.find((w) => w.code === r.code && level >= w.minLevel && (w.when?.(req, ctx) ?? true))
        : undefined;
    if (waiver) waived.push({ ...r, data: { ...r.data, waivedBecause: waiver.why } });
    else kept.push(r);
  }
  return { kept, waived };
}

export function levelGate(level: AutonomyLevel): RuleResult | null {
  return level === 0
    ? {
        code: "LEVEL_REQUIRES_APPROVAL",
        verdict: "NEEDS_APPROVAL",
        message: "Your agent is at L0 (Ask): every payment needs your approval.",
        attack: false,
      }
    : null;
}
