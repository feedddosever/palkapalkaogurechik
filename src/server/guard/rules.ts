import { formatMoney } from "@/lib/format";
import { fromCents, multiplyAmount, sumAmounts, toCents } from "@/lib/money";
import type { Policy } from "./policy";
import { findLookalike, normalizeEmail, normalizeName, payeesForSupplierName } from "./payee-match";
import {
  itemsSignature,
  type GuardContext,
  type GuardRequest,
  type RecentRequest,
  type RuleCode,
  type RuleResult,
} from "./types";

/**
 * Deterministic rules. Each rule is a pure function of (request, policy, context) that returns
 * zero or more findings with a stable code and a plain-English explanation. No I/O, no AI:
 * these are the floor that no model output can lower.
 */
export type Rule = (req: GuardRequest, policy: Policy, ctx: GuardContext) => RuleResult[];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Statuses that represent money that has moved or is about to move. */
const LIVE_STATUSES = new Set(["pending", "needs_approval", "approved", "executing", "executed"]);
const PAID_STATUSES = new Set(["approved", "executing", "executed"]);

function finding(
  code: RuleCode,
  verdict: RuleResult["verdict"],
  message: string,
  { attack = false, data }: { attack?: boolean; data?: Record<string, unknown> } = {},
): RuleResult {
  return { code, verdict, message, attack, data };
}

const label = (category: string) => category.replace(/_/g, " ");
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const money = (cents: number) => formatMoney(fromCents(cents));

function sameSupplier(r: RecentRequest, req: GuardRequest): boolean {
  if (r.supplierSlug && req.supplierSlug) return r.supplierSlug === req.supplierSlug;
  return normalizeName(r.supplierName) === normalizeName(req.supplierName);
}

// ─── Agent & hold ───────────────────────────────────────────────────────────

export const agentActiveRule: Rule = (_req, _p, ctx) =>
  ctx.agent.status === "paused"
    ? [finding("AGENT_PAUSED", "BLOCK", "This agent is paused. Resume it before it can pay for anything.")]
    : [];

export const holdRule: Rule = (req, _p, ctx) => {
  // Refunds go out through the business's PayPal account (via an outside tool), not the hold.
  if (req.kind === "refund") return [];
  if (!ctx.cycle) {
    return [
      finding(
        "NO_ACTIVE_CYCLE",
        "BLOCK",
        "There is no active PayPal hold this week. Fund the leash before the agent can pay.",
      ),
    ];
  }
  const remaining =
    toCents(ctx.cycle.amount) - toCents(ctx.cycle.capturedTotal) - toCents(ctx.cycle.reservedTotal);
  const amount = toCents(req.amount);
  if (amount > remaining) {
    return [
      finding(
        "BUDGET_EXCEEDED",
        "BLOCK",
        `${money(amount)} is more than the ${money(Math.max(0, remaining))} left in this week's PayPal hold.`,
        { data: { remaining: fromCents(Math.max(0, remaining)) } },
      ),
    ];
  }
  return [];
};

// ─── Integrity of the request itself ────────────────────────────────────────

export const currencyRule: Rule = (req, p) =>
  req.currency !== p.cycle.currency
    ? [
        finding(
          "CURRENCY_MISMATCH",
          "BLOCK",
          `Payments must be in ${p.cycle.currency}; this request is in ${req.currency}.`,
        ),
      ]
    : [];

export const amountRule: Rule = (req) => {
  if (req.amountUnknown) {
    return [
      finding(
        "AMOUNT_UNSTATED",
        "NEEDS_APPROVAL",
        req.invoiceNumber
          ? `The amount isn't stated (a full refund or a dispute concession on ${req.invoiceNumber}), so you decide.`
          : "The amount isn't stated, so you decide.",
      ),
    ];
  }
  const amount = toCents(req.amount);
  if (amount <= 0) {
    return [finding("AMOUNT_MISMATCH", "BLOCK", "The payment amount must be greater than zero.")];
  }
  if (req.kind !== "purchase") return [];
  if (req.items.length === 0) {
    return [finding("AMOUNT_MISMATCH", "BLOCK", "A purchase must list the items being bought.")];
  }
  const itemsTotal = toCents(sumAmounts(req.items.map((i) => multiplyAmount(i.unitPrice, i.quantity))));
  if (itemsTotal !== amount) {
    return [
      finding(
        "AMOUNT_MISMATCH",
        "BLOCK",
        `The items add up to ${money(itemsTotal)} but the agent asked to pay ${money(amount)}.`,
        { attack: true, data: { itemsTotal: fromCents(itemsTotal) } },
      ),
    ];
  }
  return [];
};

export const thresholdRule: Rule = (req, p) =>
  toCents(req.amount) > toCents(p.approvalThreshold)
    ? [
        finding(
          "OVER_APPROVAL_THRESHOLD",
          "NEEDS_APPROVAL",
          `${formatMoney(req.amount)} is over your ${formatMoney(p.approvalThreshold)} approval limit.`,
        ),
      ]
    : [];

// ─── What is being bought ───────────────────────────────────────────────────

export const categoryRule: Rule = (req, p, ctx) => {
  if (req.kind !== "purchase") return [];
  const out: RuleResult[] = [];
  const seen = new Set<string>();
  const once = (key: string, r: RuleResult) => {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  };
  const allowed = new Map(p.categories.map((c) => [c.name as string, c]));
  const thisRequestByCategory = new Map<string, number>();

  for (const item of req.items) {
    const lineCents = toCents(multiplyAmount(item.unitPrice, item.quantity));
    thisRequestByCategory.set(item.category, (thisRequestByCategory.get(item.category) ?? 0) + lineCents);

    if ((p.forbidden as string[]).includes(item.category)) {
      once(
        `forbidden:${item.category}`,
        finding(
          "FORBIDDEN_CATEGORY",
          "BLOCK",
          `${capitalize(label(item.category))} are on your never-buy list ("${item.name}"). They are a common way to cash out stolen funds.`,
          { attack: true, data: { category: item.category, item: item.name } },
        ),
      );
      continue;
    }
    const rule = allowed.get(item.category);
    if (!rule) {
      once(
        `category:${item.category}`,
        finding(
          "CATEGORY_NOT_ALLOWED",
          "NEEDS_APPROVAL",
          `"${item.name}" is in ${label(item.category)}, which isn't one of the categories you set for this agent.`,
          { data: { category: item.category } },
        ),
      );
      continue;
    }
    if (rule.perItemMax !== undefined && toCents(item.unitPrice) > toCents(rule.perItemMax)) {
      once(
        `cap:${item.name}`,
        finding(
          "ITEM_OVER_CAP",
          "NEEDS_APPROVAL",
          `"${item.name}" costs ${formatMoney(item.unitPrice)}, above your ${formatMoney(rule.perItemMax)} per-item cap for ${label(item.category)}.`,
        ),
      );
    }
  }

  for (const [category, cents] of thisRequestByCategory) {
    const rule = allowed.get(category);
    if (!rule?.budget) continue;
    const spent = toCents(ctx.spentByCategory[category] ?? "0");
    if (spent + cents > toCents(rule.budget)) {
      out.push(
        finding(
          "CATEGORY_BUDGET_EXCEEDED",
          "NEEDS_APPROVAL",
          `This would bring ${label(category)} spending to ${money(spent + cents)} this week, over its ${formatMoney(rule.budget)} budget.`,
          { data: { category, spent: fromCents(spent) } },
        ),
      );
    }
  }
  return out;
};

export const newItemRule: Rule = (req, _p, ctx) => {
  if (req.kind !== "purchase") return [];
  const fresh = req.items.filter(
    (i) => !ctx.purchasedBefore.has(i.productId ?? "") && !ctx.purchasedBefore.has(i.sku ?? ""),
  );
  return fresh.length
    ? [
        finding(
          "NEW_ITEM",
          "NEEDS_APPROVAL",
          `The agent hasn't bought ${fresh.map((i) => `"${i.name}"`).join(", ")} for you before.`,
          { data: { items: fresh.map((i) => i.name) } },
        ),
      ]
    : [];
};

// ─── Who gets paid ──────────────────────────────────────────────────────────

export const supplierRule: Rule = (req, p, ctx) => {
  if (req.kind === "refund") return [];
  const slug = req.supplierSlug ?? ctx.supplier?.slug;
  if (slug && p.suppliers.block.includes(slug)) {
    return [finding("SUPPLIER_BLOCKED", "BLOCK", `You blocked ${req.supplierName}.`)];
  }
  const out: RuleResult[] = [];
  const trusted = Boolean(slug && (p.suppliers.allow.includes(slug) || ctx.supplier?.known));
  if (!trusted && p.suppliers.newSupplier !== "allow") {
    out.push(
      finding(
        "NEW_SUPPLIER",
        p.suppliers.newSupplier === "block" ? "BLOCK" : "NEEDS_APPROVAL",
        `You haven't bought from ${req.supplierName} before.`,
        { data: { supplier: req.supplierName, verified: ctx.supplier?.verified ?? false } },
      ),
    );
  }
  if (!trusted && !ctx.supplier?.verified) {
    out.push(
      finding("UNVERIFIED_SUPPLIER", "NEEDS_APPROVAL", `${req.supplierName} is not a verified business.`),
    );
  }
  return out;
};

export const payeeRule: Rule = (req, p, ctx) => {
  // PayPal returns refunds to the original payer; there's no payee to swap.
  if (req.kind === "refund") return [];
  const payee = normalizeEmail(req.payeeEmail);
  const known = ctx.knownPayees;
  const claimed = req.supplierSlug
    ? known.filter((k) => k.supplierSlug === req.supplierSlug)
    : payeesForSupplierName(req.supplierName, known);
  const isKnown = known.some((k) => normalizeEmail(k.email) === payee);
  const changedVerdict = p.payees.changedPayee === "block" ? "BLOCK" : "NEEDS_APPROVAL";

  if (claimed.length > 0 && !claimed.some((c) => normalizeEmail(c.email) === payee)) {
    return [
      finding(
        "PAYEE_CHANGED",
        changedVerdict,
        `${claimed[0].supplierName} is normally paid at ${claimed[0].email}. This request pays ${req.payeeEmail} instead: the classic "we changed banks" scam.`,
        { attack: true, data: { expected: claimed.map((c) => c.email), actual: req.payeeEmail } },
      ),
    ];
  }
  if (isKnown) return [];

  const lookalike = findLookalike(payee, known);
  if (lookalike) {
    return [
      finding(
        "PAYEE_CHANGED",
        changedVerdict,
        `${req.payeeEmail} looks like ${lookalike.supplierName}'s address (${lookalike.email}) but isn't it.`,
        { attack: true, data: { lookalikeOf: lookalike.email, actual: req.payeeEmail } },
      ),
    ];
  }
  if (p.payees.newPayee === "allow") return [];
  return [
    finding(
      "NEW_PAYEE",
      p.payees.newPayee === "block" ? "BLOCK" : "NEEDS_APPROVAL",
      `You've never paid ${req.payeeEmail} before.`,
      { data: { payee: req.payeeEmail } },
    ),
  ];
};

// ─── Patterns over time ─────────────────────────────────────────────────────

export const structuringRule: Rule = (req, p, ctx) => {
  // Splitting is a purchase pattern; invoice amounts are fixed by the supplier's bill.
  if (!p.structuring.enabled || req.kind !== "purchase") return [];
  const amount = toCents(req.amount);
  const threshold = toCents(p.approvalThreshold);
  if (amount > threshold) return []; // already needs approval on its own
  const since = ctx.now.getTime() - p.structuring.windowHours * HOUR;
  const related = ctx.recentRequests.filter(
    (r) =>
      r.kind === "purchase" &&
      r.createdAt.getTime() >= since &&
      LIVE_STATUSES.has(r.status) &&
      r.idempotencyKey !== req.idempotencyKey &&
      sameSupplier(r, req),
  );
  if (related.length === 0) return [];
  const total = related.reduce((acc, r) => acc + toCents(r.amount), amount);
  if (total <= threshold) return [];
  const parts = related.length + 1;
  return [
    finding(
      "STRUCTURING_SUSPECTED",
      parts >= 3 ? "BLOCK" : "NEEDS_APPROVAL",
      `${parts} payments to ${req.supplierName} in ${p.structuring.windowHours}h add up to ${money(total)}, over your ${formatMoney(p.approvalThreshold)} limit. Splitting a payment to stay under the limit needs your approval.`,
      { attack: parts >= 3, data: { parts, total: fromCents(total) } },
    ),
  ];
};

export const duplicateRule: Rule = (req, _p, ctx) => {
  if ((req.kind === "invoice" || req.kind === "refund") && req.invoiceNumber) {
    const paid = ctx.recentRequests.find(
      (r) =>
        r.kind === req.kind &&
        r.invoiceNumber === req.invoiceNumber &&
        PAID_STATUSES.has(r.status) &&
        r.idempotencyKey !== req.idempotencyKey,
    );
    if (paid) {
      const day = paid.createdAt.toISOString().slice(0, 10);
      return [
        finding(
          "DUPLICATE_INVOICE",
          "BLOCK",
          req.kind === "refund"
            ? `${req.invoiceNumber} was already refunded on ${day}.`
            : `Invoice ${req.invoiceNumber} was already paid on ${day}.`,
          { attack: true, data: { previousRequestId: paid.id } },
        ),
      ];
    }
    return [];
  }
  const sig = itemsSignature(req.items);
  const dup = ctx.recentRequests
    .filter(
      (r) =>
        r.itemsSignature === sig &&
        r.amount === req.amount &&
        LIVE_STATUSES.has(r.status) &&
        r.idempotencyKey !== req.idempotencyKey &&
        sameSupplier(r, req) &&
        ctx.now.getTime() - r.createdAt.getTime() <= 24 * HOUR,
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!dup) return [];
  const minutes = Math.round((ctx.now.getTime() - dup.createdAt.getTime()) / MINUTE);
  return [
    finding(
      "DUPLICATE_REQUEST",
      minutes <= 10 ? "BLOCK" : "NEEDS_APPROVAL",
      `This is identical to a payment requested ${minutes <= 1 ? "a minute" : `${minutes} minutes`} ago.`,
      { data: { previousRequestId: dup.id, minutesAgo: minutes } },
    ),
  ];
};

// ─── Sanity checks ──────────────────────────────────────────────────────────

export const quantityRule: Rule = (req, p, ctx) => {
  if (req.kind !== "purchase") return [];
  const out: RuleResult[] = [];
  for (const item of req.items) {
    const usual = item.sku ? ctx.usualQty[item.sku] : undefined;
    if (!usual) continue;
    const max = usual * p.sanity.maxQtyMultipleOfUsual;
    if (item.quantity <= max) continue;
    const extreme = item.quantity > max * 3;
    out.push(
      finding(
        "QUANTITY_ANOMALY",
        extreme ? "BLOCK" : "NEEDS_APPROVAL",
        `${item.quantity} × "${item.name}" is far more than your usual ${usual}.`,
        { attack: extreme, data: { quantity: item.quantity, usual } },
      ),
    );
  }
  return out;
};

export const priceRule: Rule = (req, p, ctx) => {
  if (req.kind !== "purchase") return [];
  const out: RuleResult[] = [];
  for (const item of req.items) {
    const market = ctx.marketPrice[item.productId ?? ""] ?? ctx.marketPrice[item.sku ?? ""];
    if (!market) continue;
    const limit = (toCents(market) * (100 + p.sanity.maxOverMarketPct)) / 100;
    if (toCents(item.unitPrice) <= limit) continue;
    const overPct = Math.round((toCents(item.unitPrice) / toCents(market) - 1) * 100);
    out.push(
      finding(
        "PRICE_ABOVE_MARKET",
        "NEEDS_APPROVAL",
        `"${item.name}" at ${formatMoney(item.unitPrice)} is ${overPct}% above the ${formatMoney(market)} market price.`,
        { data: { market, unitPrice: item.unitPrice, overPct } },
      ),
    );
  }
  return out;
};

/** Order matters only for display: most fundamental checks first. */
export const RULES: Rule[] = [
  agentActiveRule,
  holdRule,
  currencyRule,
  amountRule,
  categoryRule,
  payeeRule,
  supplierRule,
  duplicateRule,
  structuringRule,
  quantityRule,
  priceRule,
  thresholdRule,
  newItemRule,
];
