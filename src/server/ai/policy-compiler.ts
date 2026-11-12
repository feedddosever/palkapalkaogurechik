import * as z from "zod/v4";
import { features } from "@/server/env";
import {
  HIGH_RISK_CATEGORIES,
  LEASH_CATEGORIES,
  PolicySchema,
  type LeashCategory,
  type Policy,
} from "@/server/guard/policy";
import { applySafetyFloors, ruleCardFromPolicy, type RuleCard } from "@/server/guard/rule-card";
import { DEFAULT_OWNER_TEXT, DEFAULT_POLICY } from "@/server/seed/defaults";
import { runStructured, type AiUsage } from "./client";

/**
 * Policy compiler: the owner's plain-English rules → a structured policy the guard enforces.
 * The model only drafts; safety floors are applied in code afterwards, and the Rule Card the owner
 * sees is rendered from the final policy (see guard/rule-card.ts).
 */

export type SupplierRef = { slug: string; name: string; known: boolean };

export type CompileResult = {
  policy: Policy;
  ruleCard: RuleCard;
  /** Defaults the compiler had to choose because the owner didn't say. */
  assumptions: string[];
  /** Questions worth asking the owner (ambiguous or missing rules). */
  clarifications: string[];
  source: "ai" | "offline";
  usage?: AiUsage;
};

const Category = z.enum(LEASH_CATEGORIES);

const CompilerOutput = z.object({
  cycle: z.object({ amount: z.number(), period: z.enum(["weekly", "monthly"]) }),
  approvalThreshold: z.number(),
  categories: z.array(
    z.object({ name: Category, budget: z.number().nullable(), perItemMax: z.number().nullable() }),
  ),
  suppliers: z.object({
    allow: z.array(z.string()),
    block: z.array(z.string()),
    newSupplier: z.enum(["allow", "approve", "block"]),
  }),
  payees: z.object({
    newPayee: z.enum(["allow", "approve", "block"]),
    changedPayee: z.enum(["approve", "block"]),
  }),
  forbidden: z.array(Category),
  sanity: z.object({ maxQtyMultipleOfUsual: z.number(), maxOverMarketPct: z.number() }),
  structuring: z.object({ enabled: z.boolean(), windowHours: z.number() }),
  assumptions: z.array(z.string()),
  clarifications: z.array(z.string()),
});

const SYSTEM = `You compile a small-business owner's spending rules for their AI operations agent into a structured policy for Leash, a payment guard built on PayPal.

The owner's words are the only source of permissions. Rules:
- Never grant a permission the owner did not give. When something is unspecified, choose the SAFER option and record it in "assumptions" (one short sentence each, in plain English).
- cycle: the budget the agent may spend per period. If no amount is given, use 200 weekly and add a clarification.
- approvalThreshold: any single payment above this needs the owner's approval. If not given, use about a quarter of the budget, rounded, and add an assumption.
- categories: only categories the owner says the agent may buy. Use null for budget/perItemMax unless the owner states a number for that category.
- suppliers.allow: slugs of suppliers the owner trusts. "Our usual suppliers" means every supplier marked known=true. Only use slugs from the supplier list provided.
- suppliers.newSupplier: "approve" unless the owner says new suppliers are fine ("allow") or forbidden ("block").
- payees.newPayee: "approve" unless stated. payees.changedPayee: "block" unless the owner explicitly accepts changed payment details, then "approve".
- forbidden: categories the owner says never to buy. Gift cards, prepaid cards, crypto and money transfers are common fraud cash-outs; include any the owner mentions or implies ("anything like them").
- sanity: maxQtyMultipleOfUsual 3 and maxOverMarketPct 25 unless stated. structuring: enabled, 24 hours unless stated.
- clarifications: at most 3 short questions, only for genuinely ambiguous or missing rules that matter for money. Empty if the rules are clear.

Category values: ${LEASH_CATEGORIES.join(", ")}.`;

function toPolicy(out: z.infer<typeof CompilerOutput>, ownerText: string): Policy {
  return PolicySchema.parse({
    version: 1,
    cycle: { amount: out.cycle.amount, currency: "USD", period: out.cycle.period },
    approvalThreshold: out.approvalThreshold,
    categories: out.categories.map((c) => ({
      name: c.name,
      ...(c.budget != null ? { budget: c.budget } : {}),
      ...(c.perItemMax != null ? { perItemMax: c.perItemMax } : {}),
    })),
    suppliers: out.suppliers,
    payees: out.payees,
    forbidden: [...new Set(out.forbidden)],
    sanity: out.sanity,
    structuring: out.structuring,
    ownerText,
  });
}

function finish(
  policy: Policy,
  suppliers: SupplierRef[],
  extra: Omit<CompileResult, "policy" | "ruleCard">,
): CompileResult {
  const { policy: safe, notes } = applySafetyFloors(
    policy,
    suppliers.map((s) => s.slug),
  );
  return {
    ...extra,
    policy: safe,
    ruleCard: ruleCardFromPolicy(safe, Object.fromEntries(suppliers.map((s) => [s.slug, s.name]))),
    assumptions: [...extra.assumptions, ...notes],
  };
}

export async function compilePolicy(
  ownerText: string,
  suppliers: SupplierRef[],
  { ai = features.aiLive }: { ai?: boolean } = {},
): Promise<CompileResult> {
  const text = ownerText.trim();
  if (!ai) return compileOffline(text, suppliers);

  const user = [
    "Suppliers (slug | name | known):",
    ...suppliers.map((s) => `- ${s.slug} | ${s.name} | ${s.known ? "known" : "new"}`),
    "",
    "Owner's rules:",
    `"""${text}"""`,
  ].join("\n");
  const { data, usage } = await runStructured({
    tier: "smart",
    system: SYSTEM,
    user,
    schema: CompilerOutput,
    effort: "medium",
  });
  return finish(toPolicy(data, text), suppliers, {
    assumptions: data.assumptions,
    clarifications: data.clarifications.slice(0, 3),
    source: "ai",
    usage,
  });
}

// ─── offline compiler (no API key): deterministic heuristics ────────────────

const CATEGORY_WORDS: [LeashCategory, RegExp][] = [
  ["coffee", /coffee|espresso|beans/],
  ["tea", /\btea\b|matcha/],
  ["dairy_alt", /oat milk|plant milk|milk alternative|almond milk|oat\b/],
  ["dairy", /\bdairy\b|whole milk|cream\b/],
  ["packaging", /cups?|lids?|napkins?|packaging|to-go/],
  ["cleaning", /cleaning|sanitiz|detergent/],
  ["bakery", /pastr|bakery|croissant/],
  ["equipment", /equipment|machine|grinder/],
  ["office", /office|printer/],
];

const money = (s: string) => Number(s.replace(/,/g, ""));

export function compileOffline(ownerText: string, suppliers: SupplierRef[]): CompileResult {
  if (normalize(ownerText) === normalize(DEFAULT_OWNER_TEXT)) {
    return finish(DEFAULT_POLICY, suppliers, { assumptions: [], clarifications: [], source: "offline" });
  }
  const t = ownerText.toLowerCase();
  const assumptions: string[] = [];
  const clarifications: string[] = [];

  const budget = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(?:a|per|each|\/|every)\s*(week|month)/.exec(t);
  const amount = budget ? money(budget[1]) : 200;
  const period = budget?.[2] === "month" ? "monthly" : "weekly";
  if (!budget) clarifications.push("How much may the agent spend each week?");

  const limit = /(?:over|above|more than|exceeding)\s*\$\s?(\d[\d,]*(?:\.\d+)?)/.exec(t);
  const threshold = limit ? money(limit[1]) : Math.max(25, Math.round(amount / 4 / 5) * 5);
  if (!limit) assumptions.push(`Payments over $${threshold} will need your approval.`);

  const categories = CATEGORY_WORDS.filter(([, re]) => re.test(t)).map(([name]) => ({ name }));
  if (categories.length === 0) clarifications.push("What kinds of things may the agent buy?");

  const usual = /usual suppliers|regular suppliers|current suppliers|suppliers we (?:already )?use/.test(t);
  const named = suppliers.filter((s) => t.includes(s.name.toLowerCase())).map((s) => s.slug);
  const allow = [
    ...new Set([...(usual ? suppliers.filter((s) => s.known).map((s) => s.slug) : []), ...named]),
  ];

  const newSupplier = /new suppliers? (?:are|is) (?:fine|ok)|any supplier/.test(t) ? "allow" : "approve";
  const changedPayee = /changed (?:bank|payment) details (?:are|is) (?:fine|ok)/.test(t)
    ? "approve"
    : "block";

  const forbidden = new Set<LeashCategory>();
  if (/gift ?cards?/.test(t)) forbidden.add("gift_cards");
  if (/anything like (?:them|that)|similar/.test(t) || forbidden.size)
    HIGH_RISK_CATEGORIES.forEach((c) => forbidden.add(c));
  if (/crypto|bitcoin/.test(t)) forbidden.add("crypto");

  const policy = PolicySchema.parse({
    version: 1,
    cycle: { amount, currency: "USD", period },
    approvalThreshold: threshold,
    categories,
    suppliers: { allow, block: [], newSupplier },
    payees: { newPayee: "approve", changedPayee },
    forbidden: [...forbidden],
    sanity: { maxQtyMultipleOfUsual: 3, maxOverMarketPct: 25 },
    structuring: { enabled: true, windowHours: 24 },
    ownerText,
  });
  return finish(policy, suppliers, { assumptions, clarifications, source: "offline" });
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
