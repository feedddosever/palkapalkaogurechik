import type { RequestItem } from "@/server/db/schema";

export type Verdict = "ALLOW" | "NEEDS_APPROVAL" | "BLOCK";

export const SEVERITY: Record<Verdict, number> = { ALLOW: 0, NEEDS_APPROVAL: 1, BLOCK: 2 };

export function maxVerdict(...verdicts: Verdict[]): Verdict {
  return verdicts.reduce<Verdict>((acc, v) => (SEVERITY[v] > SEVERITY[acc] ? v : acc), "ALLOW");
}

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export const RULE_CODES = [
  "AGENT_PAUSED",
  "NO_ACTIVE_CYCLE",
  "CURRENCY_MISMATCH",
  "AMOUNT_MISMATCH",
  "BUDGET_EXCEEDED",
  "OVER_APPROVAL_THRESHOLD",
  "FORBIDDEN_CATEGORY",
  "CATEGORY_NOT_ALLOWED",
  "CATEGORY_BUDGET_EXCEEDED",
  "ITEM_OVER_CAP",
  "SUPPLIER_BLOCKED",
  "NEW_SUPPLIER",
  "UNVERIFIED_SUPPLIER",
  "NEW_PAYEE",
  "PAYEE_CHANGED",
  "STRUCTURING_SUSPECTED",
  "QUANTITY_ANOMALY",
  "PRICE_ABOVE_MARKET",
  "DUPLICATE_REQUEST",
  "DUPLICATE_INVOICE",
  "NEW_ITEM",
  "LEVEL_REQUIRES_APPROVAL",
] as const;

export type RuleCode = (typeof RULE_CODES)[number];

export type RuleResult = {
  code: RuleCode;
  verdict: Exclude<Verdict, "ALLOW">;
  /** Plain-English explanation shown to the owner. */
  message: string;
  /** True when the pattern is a fraud/attack signal (blocks shorten the leash). */
  attack: boolean;
  data?: Record<string, unknown>;
};

/** What the agent is asking Leash to pay. */
export type GuardRequest = {
  kind: "purchase" | "invoice";
  supplierSlug?: string;
  supplierName: string;
  payeeEmail: string;
  items: RequestItem[];
  amount: string;
  currency: string;
  invoiceNumber?: string;
  idempotencyKey: string;
};

export type RecentRequest = {
  id: string;
  kind: "purchase" | "invoice";
  supplierSlug?: string;
  supplierName: string;
  amount: string;
  categories: string[];
  itemsSignature: string;
  invoiceNumber?: string;
  idempotencyKey: string;
  status: string;
  createdAt: Date;
};

/** Everything the rules need to know, assembled from the database (see context.ts). */
export type GuardContext = {
  now: Date;
  agent: { status: "active" | "paused"; autonomyLevel: AutonomyLevel };
  /** The active PayPal hold. Null = no hold funded yet. */
  cycle: {
    amount: string;
    /** Already captured from the hold. */
    capturedTotal: string;
    /** Approved or awaiting execution, not captured yet. */
    reservedTotal: string;
  } | null;
  /** Spend this cycle per category (captured + reserved), decimal strings. */
  spentByCategory: Record<string, string>;
  supplier: { slug: string; name: string; known: boolean; verified: boolean } | null;
  /** All payees the business has verified, with the supplier they belong to. */
  knownPayees: { email: string; supplierSlug?: string; supplierName: string }[];
  /** Recent non-historical and historical requests (for duplicates and structuring). */
  recentRequests: RecentRequest[];
  /** SKUs / product ids the business has bought before. */
  purchasedBefore: Set<string>;
  /** Usual reorder quantity per SKU. */
  usualQty: Record<string, number>;
  /** Market median unit price per SKU or product id. */
  marketPrice: Record<string, string>;
};

export type RulesEvaluation = {
  verdict: Verdict;
  /** Results that count towards the verdict. */
  results: RuleResult[];
  /** Approval results waived by the agent's autonomy level (shown for transparency). */
  waived: RuleResult[];
  attack: boolean;
};

export function itemsSignature(items: RequestItem[]): string {
  return items
    .map((i) => `${i.productId ?? i.sku ?? i.name}×${i.quantity}@${i.unitPrice}`)
    .sort()
    .join("|");
}
