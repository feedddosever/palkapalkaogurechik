import { formatMoney } from "@/lib/format";
import { HIGH_RISK_CATEGORIES, type Policy } from "./policy";

/**
 * The Rule Card is rendered from the COMPILED policy, never from model prose, so what the
 * owner reads is exactly what the guard enforces.
 */
export type RuleCard = { auto: string[]; ask: string[]; never: string[] };

const LABELS: Record<string, string> = {
  coffee: "coffee",
  tea: "tea",
  dairy: "dairy",
  dairy_alt: "plant milks",
  bakery: "bakery",
  packaging: "cups, lids & packaging",
  cleaning: "cleaning supplies",
  equipment: "equipment",
  office: "office supplies",
  gift_cards: "gift cards",
  prepaid_cards: "prepaid cards",
  crypto: "crypto",
  money_transfer: "money transfers",
  other: "other items",
};

export const categoryLabel = (c: string) => LABELS[c] ?? c.replace(/_/g, " ");

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function ruleCardFromPolicy(p: Policy, supplierNames: Record<string, string> = {}): RuleCard {
  const per = p.cycle.period === "weekly" ? "week" : "month";
  const name = (slug: string) => supplierNames[slug] ?? slug;
  const cats = p.categories.map((c) => {
    const parts = [categoryLabel(c.name)];
    if (c.budget !== undefined) parts.push(`up to ${formatMoney(c.budget, { whole: true })}/${per}`);
    if (c.perItemMax !== undefined) parts.push(`≤ ${formatMoney(c.perItemMax, { whole: true })} per item`);
    return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(", ")})` : parts[0];
  });

  const auto = [
    `Spend up to ${formatMoney(p.cycle.amount, { whole: true })} a ${per}, held in PayPal`,
    cats.length ? `Buy ${list(cats)}` : "Buy nothing without asking (no categories set)",
    p.suppliers.allow.length
      ? `From ${list(p.suppliers.allow.map(name))}`
      : "From suppliers you've used before",
    "Pay invoices to suppliers' known PayPal addresses",
  ];

  const ask = [`Any single payment over ${formatMoney(p.approvalThreshold, { whole: true })}`];
  if (p.suppliers.newSupplier === "approve") ask.push("Anything from a supplier you haven't used before");
  if (p.payees.newPayee === "approve") ask.push("Paying a PayPal address you've never paid");
  if (p.payees.changedPayee === "approve") ask.push("A known supplier asking to be paid somewhere new");
  ask.push("Items outside the categories above");
  ask.push(`More than ${p.sanity.maxQtyMultipleOfUsual}× the usual quantity`);
  ask.push(`Prices more than ${p.sanity.maxOverMarketPct}% above the market price`);
  if (p.structuring.enabled) {
    ask.push(
      `Split payments to one supplier adding up to more than ${formatMoney(p.approvalThreshold, { whole: true })} within ${p.structuring.windowHours}h`,
    );
  }

  const never = [`Buy ${list(p.forbidden.map(categoryLabel))}`];
  if (p.payees.changedPayee === "block") never.push("Pay a known supplier at new payment details");
  if (p.payees.newPayee === "block") never.push("Pay a PayPal address you've never paid");
  if (p.suppliers.newSupplier === "block") never.push("Buy from a supplier you haven't used before");
  for (const slug of p.suppliers.block) never.push(`Buy from ${name(slug)}`);
  never.push(`Spend more than the ${formatMoney(p.cycle.amount, { whole: true })} PayPal hold`);

  return { auto, ask, never };
}

/** Plain-English list of what changed between two policies (for rule edits and audit). */
export function diffPolicies(before: Policy, after: Policy): string[] {
  const out: string[] = [];
  const money = (n: number) => formatMoney(n, { whole: true });
  if (before.cycle.amount !== after.cycle.amount || before.cycle.period !== after.cycle.period) {
    out.push(
      `Budget: ${money(before.cycle.amount)}/${before.cycle.period} → ${money(after.cycle.amount)}/${after.cycle.period}`,
    );
  }
  if (before.approvalThreshold !== after.approvalThreshold) {
    out.push(`Approval limit: ${money(before.approvalThreshold)} → ${money(after.approvalThreshold)}`);
  }
  const bc = new Map(before.categories.map((c) => [c.name, c]));
  const ac = new Map(after.categories.map((c) => [c.name, c]));
  for (const [n] of ac) if (!bc.has(n)) out.push(`Added category: ${categoryLabel(n)}`);
  for (const [n] of bc) if (!ac.has(n)) out.push(`Removed category: ${categoryLabel(n)}`);
  for (const [n, a] of ac) {
    const b = bc.get(n);
    if (b && (b.budget !== a.budget || b.perItemMax !== a.perItemMax))
      out.push(`Changed limits for ${categoryLabel(n)}`);
  }
  for (const s of after.suppliers.allow)
    if (!before.suppliers.allow.includes(s)) out.push(`Trusted supplier added: ${s}`);
  for (const s of before.suppliers.allow)
    if (!after.suppliers.allow.includes(s)) out.push(`Trusted supplier removed: ${s}`);
  for (const s of after.suppliers.block)
    if (!before.suppliers.block.includes(s)) out.push(`Supplier blocked: ${s}`);
  if (before.suppliers.newSupplier !== after.suppliers.newSupplier)
    out.push(`New suppliers: ${before.suppliers.newSupplier} → ${after.suppliers.newSupplier}`);
  if (before.payees.newPayee !== after.payees.newPayee)
    out.push(`New payees: ${before.payees.newPayee} → ${after.payees.newPayee}`);
  if (before.payees.changedPayee !== after.payees.changedPayee)
    out.push(`Changed payment details: ${before.payees.changedPayee} → ${after.payees.changedPayee}`);
  const added = after.forbidden.filter((c) => !before.forbidden.includes(c));
  const removed = before.forbidden.filter((c) => !after.forbidden.includes(c));
  if (added.length) out.push(`Never buy: added ${list(added.map(categoryLabel))}`);
  if (removed.length) out.push(`Never buy: removed ${list(removed.map(categoryLabel))}`);
  if (JSON.stringify(before.sanity) !== JSON.stringify(after.sanity))
    out.push("Changed quantity/price sanity limits");
  if (JSON.stringify(before.structuring) !== JSON.stringify(after.structuring))
    out.push("Changed split-payment detection");
  return out;
}

/** Safety floors applied to every compiled policy, whatever the model returned. */
export function applySafetyFloors(
  p: Policy,
  knownSupplierSlugs: string[],
): { policy: Policy; notes: string[] } {
  const notes: string[] = [];
  const forbidden = [...new Set([...p.forbidden, ...HIGH_RISK_CATEGORIES])];
  if (forbidden.length !== p.forbidden.length)
    notes.push("Gift cards, prepaid cards, crypto and money transfers are always blocked.");
  const categories = p.categories.filter((c) => !HIGH_RISK_CATEGORIES.includes(c.name));
  if (categories.length !== p.categories.length)
    notes.push("Removed high-risk categories from the allowed list.");
  const allow = p.suppliers.allow.filter((s) => knownSupplierSlugs.includes(s));
  if (allow.length !== p.suppliers.allow.length)
    notes.push("Ignored suppliers that aren't in your supplier list.");
  const block = p.suppliers.block.filter((s) => knownSupplierSlugs.includes(s));
  const approvalThreshold = Math.min(p.approvalThreshold, p.cycle.amount);
  if (approvalThreshold !== p.approvalThreshold) notes.push("Approval limit capped at the budget.");
  return {
    policy: { ...p, forbidden, categories, approvalThreshold, suppliers: { ...p.suppliers, allow, block } },
    notes,
  };
}
