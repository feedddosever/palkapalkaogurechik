import type { LeashCategory } from "@/server/guard/policy";

/**
 * Maps Channel3's category taxonomy (path of slugs/titles, root first) plus the title to a Leash
 * category. The high-risk cash-out categories are checked FIRST so that "Coffee Shop Gift Card"
 * is a gift card, not coffee.
 */
const HIGH_RISK: [LeashCategory, RegExp][] = [
  ["gift_cards", /gift[\s-]?cards?|e-?gift|gift certificates?/],
  ["prepaid_cards", /prepaid (?:debit|visa|mastercard|card)|reloadable card/],
  ["crypto", /bitcoin|crypto(?:currency)?|\bbtc\b|ethereum/],
  ["money_transfer", /money (?:order|transfer)|wire transfer/],
];

/** Order matters: packaging before coffee ("hot coffee cups"), dairy_alt before dairy ("oat milk"). */
const RULES: [LeashCategory, RegExp][] = [
  ["packaging", /\bcups?\b|\blids?\b|napkins?|sleeves?|straws?|to-go|takeout|disposable|packaging/],
  [
    "dairy_alt",
    /oat milk|almond milk|soy milk|plant[\s-]based milk|milk (?:alternatives?|substitutes?)|non[\s-]dairy/,
  ],
  ["dairy", /\bmilk\b|cream|half and half|dairy/],
  ["equipment", /espresso machine|grinder|brewer|appliance|blender/],
  ["coffee", /coffee|espresso|cold brew/],
  ["tea", /\btea\b|matcha|chai/],
  ["cleaning", /sanitiz|disinfect|cleaner|cleaning|detergent|degreaser/],
  ["bakery", /pastr|croissant|bakery|muffin|bagel/],
  ["office", /printer|paper towels?|office/],
];

export type Channel3CategoryLike = {
  slug: string;
  title: string;
  path?: { slug: string; title: string }[];
} | null;

function pathText(category: Channel3CategoryLike): string {
  return [category?.title, category?.slug, ...(category?.path ?? []).flatMap((p) => [p.title, p.slug])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/-/g, " ");
}

/**
 * Maps Channel3's category (taxonomy path, root first) plus the product title to a Leash category.
 * 1. High-risk cash-out categories win if they appear ANYWHERE ("Coffee Shop Gift Card" is a gift card).
 * 2. Otherwise the merchant-independent taxonomy path decides.
 * 3. Otherwise the title decides.
 */
export function toLeashCategory(category: Channel3CategoryLike, title = ""): LeashCategory {
  const path = pathText(category);
  const t = title.toLowerCase();
  for (const [cat, re] of HIGH_RISK) if (re.test(path) || re.test(t)) return cat;
  for (const [cat, re] of RULES) if (path && re.test(path)) return cat;
  for (const [cat, re] of RULES) if (re.test(t)) return cat;
  return "other";
}
