import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Leash categories. Matching happens on structured product data (Channel3 / storefront
 * attributes), never on free-text keywords, so the forbidden-category rule stays deterministic.
 */
export const LEASH_CATEGORIES = [
  "coffee",
  "tea",
  "dairy",
  "dairy_alt",
  "bakery",
  "packaging",
  "cleaning",
  "equipment",
  "office",
  "gift_cards",
  "prepaid_cards",
  "crypto",
  "money_transfer",
  "other",
] as const;

export const LeashCategory = z.enum(LEASH_CATEGORIES);
export type LeashCategory = z.infer<typeof LeashCategory>;

/** Categories that are a classic fraud cash-out path. Suggested as forbidden by default. */
export const HIGH_RISK_CATEGORIES: LeashCategory[] = [
  "gift_cards",
  "prepaid_cards",
  "crypto",
  "money_transfer",
];

const Dollars = z.number().nonnegative().max(1_000_000);

export const PolicySchema = z.object({
  version: z.literal(1),
  cycle: z.object({
    amount: Dollars.positive(),
    currency: z.literal("USD"),
    period: z.enum(["weekly", "monthly"]),
  }),
  /** Any single payment above this amount needs the owner's approval. */
  approvalThreshold: Dollars,
  /** Categories the agent may buy. Anything else needs approval (or is blocked if forbidden). */
  categories: z.array(
    z.object({
      name: LeashCategory,
      /** Max spend per cycle in this category. */
      budget: Dollars.optional(),
      /** Max price of a single line item. */
      perItemMax: Dollars.optional(),
    }),
  ),
  suppliers: z.object({
    /** Supplier slugs the owner explicitly trusts. */
    allow: z.array(z.string()),
    block: z.array(z.string()),
    newSupplier: z.enum(["allow", "approve", "block"]),
  }),
  payees: z.object({
    newPayee: z.enum(["allow", "approve", "block"]),
    /** A known supplier asking to be paid somewhere new: the classic BEC pattern. */
    changedPayee: z.enum(["approve", "block"]),
  }),
  forbidden: z.array(LeashCategory),
  sanity: z.object({
    /** Block quantities above N× the usual reorder quantity. */
    maxQtyMultipleOfUsual: z.number().positive().max(100),
    /** Flag unit prices more than X% above the market median. */
    maxOverMarketPct: z.number().nonnegative().max(1000),
  }),
  structuring: z.object({
    enabled: z.boolean(),
    /** Rolling window used to detect payments split to stay under the threshold. */
    windowHours: z
      .number()
      .positive()
      .max(24 * 31),
  }),
  /** The owner's original words, kept verbatim (the intent the AI judge checks against). */
  ownerText: z.string(),
});

export type Policy = z.infer<typeof PolicySchema>;

/** Canonical JSON (sorted keys) so the hash is stable regardless of key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function policyHash(policy: Policy): string {
  return `sha256:${createHash("sha256").update(canonicalJson(policy)).digest("hex")}`;
}
