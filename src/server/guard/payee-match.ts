/**
 * Payee identity helpers for business-email-compromise (BEC) detection.
 *
 * The classic BEC: an email that *claims* to be a known supplier asks to be paid at a new
 * address, often on a lookalike domain ("northside-billing-secure.example" vs
 * "northside-roasters.example"). These checks are deterministic: no AI needed.
 */

const NAME_STOPWORDS = new Set(["the", "inc", "llc", "ltd", "co", "company", "corp", "and"]);

/** Words that say nothing about *who* a domain belongs to. */
const GENERIC_DOMAIN_TOKENS = new Set([
  "billing",
  "payments",
  "payment",
  "pay",
  "accounts",
  "account",
  "ar",
  "invoice",
  "invoices",
  "secure",
  "verify",
  "support",
  "mail",
  "email",
  "online",
  "portal",
  "team",
  "official",
  "example",
  "com",
  "net",
  "org",
  "co",
  "io",
  "www",
]);

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !NAME_STOPWORDS.has(w))
    .join(" ");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : normalizeEmail(email.slice(at + 1));
}

/** Tokens that identify the owner of a domain, e.g. "northside-roasters.example" → ["northside","roasters"]. */
export function distinctiveTokens(domain: string): string[] {
  return domain.split(/[.\-_]+/).filter((t) => t.length >= 3 && !GENERIC_DOMAIN_TOKENS.has(t));
}

export type KnownPayee = { email: string; supplierSlug?: string; supplierName: string };

/** Known payees whose supplier name matches the claimed sender/supplier name. */
export function payeesForSupplierName(name: string, known: KnownPayee[]): KnownPayee[] {
  const target = normalizeName(name);
  if (!target) return [];
  return known.filter((p) => normalizeName(p.supplierName) === target);
}

/**
 * If `email` is NOT a known payee but its domain shares a distinctive token with a known payee's
 * domain, return that payee: the new address is impersonating a supplier we already pay.
 */
export function findLookalike(email: string, known: KnownPayee[]): KnownPayee | null {
  const e = normalizeEmail(email);
  if (known.some((p) => normalizeEmail(p.email) === e)) return null;
  const domain = domainOf(e);
  const tokens = new Set(distinctiveTokens(domain));
  if (tokens.size === 0) return null;
  for (const p of known) {
    const knownDomain = domainOf(p.email);
    if (knownDomain === domain) continue;
    if (distinctiveTokens(knownDomain).some((t) => tokens.has(t))) return p;
  }
  return null;
}
