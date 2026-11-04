import { env, features } from "@/server/env";
import type { MarketPriceProvider } from "@/server/guard/context";
import type { LeashCategory } from "@/server/guard/policy";
import { FixtureChannel3, LiveChannel3, type Channel3Client } from "./channel3";
import { DEMO_SUPPLIERS, getDemoProduct, getDemoSupplier, productPageText } from "./demo-suppliers";
import { priceSignal, quoteMarket, specFor, type MarketQuote, type PriceSignal } from "./market";

export { toLeashCategory } from "./categories";
export type { MarketQuote, PriceSignal } from "./market";

const globalForCatalog = globalThis as unknown as {
  __leashChannel3?: Channel3Client;
  __leashQuotes?: Map<string, Promise<MarketQuote | null>>;
};

export function getChannel3(): Channel3Client {
  globalForCatalog.__leashChannel3 ??= features.channel3Live
    ? new LiveChannel3(env.CHANNEL3_API_KEY!)
    : new FixtureChannel3();
  return globalForCatalog.__leashChannel3;
}

export function setChannel3ForTesting(client: Channel3Client | undefined): void {
  globalForCatalog.__leashChannel3 = client;
  globalForCatalog.__leashQuotes = undefined;
}

/** Market quote for a product (memoized per process; Channel3 credits are precious). */
export function marketQuoteFor(product: {
  sku?: string;
  category: string;
  title: string;
}): Promise<MarketQuote | null> {
  const spec = specFor(product);
  if (!spec) return Promise.resolve(null);
  const quotes = (globalForCatalog.__leashQuotes ??= new Map());
  let q = quotes.get(spec.sku);
  if (!q) {
    q = quoteMarket(getChannel3(), spec).catch(() => null);
    quotes.set(spec.sku, q);
  }
  return q;
}

/** What Leash knows about a product, from the catalog, never from the agent. */
export type ResolvedProduct = {
  productId: string;
  name: string;
  sku?: string;
  category: LeashCategory;
  unit: string;
  unitPrice: string;
  supplierSlug: string;
  supplierName: string;
  supplierVerified: boolean;
  payeeEmail: string;
  url: string;
};

/**
 * Authoritative product lookup. The guard uses this, not the agent's description, for category,
 * price, supplier and payee, so a hijacked agent can't relabel gift cards as "coffee".
 */
export function resolveProduct(productId: string): ResolvedProduct | null {
  const p = getDemoProduct(productId);
  if (!p) return null;
  const s = getDemoSupplier(p.supplierSlug)!;
  return {
    productId: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    unit: p.unit,
    unitPrice: p.price,
    supplierSlug: s.slug,
    supplierName: s.name,
    supplierVerified: s.verified,
    payeeEmail: s.payeeEmail,
    url: `/suppliers/${s.slug}/${p.id}`,
  };
}

export type Offer = ResolvedProduct & {
  description: string;
  market: {
    median: string;
    deltaPct: number;
    signal: PriceSignal;
    sampleSize: number;
    source: string;
  } | null;
};

/** Search the purchasable supplier catalog, each offer annotated with Channel3 market context. */
export async function searchCatalog(query: string, { limit = 8 } = {}): Promise<Offer[]> {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1);
  const scored = DEMO_SUPPLIERS.flatMap((s) =>
    s.products.map((p) => {
      const hay = `${p.name} ${p.description} ${p.category.replace(/_/g, " ")} ${s.name}`.toLowerCase();
      const score = words.filter((w) => hay.includes(w)).length;
      return { p, score };
    }),
  )
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.p.price) - Number(b.p.price))
    .slice(0, limit);

  return Promise.all(
    scored.map(async ({ p }) => {
      const resolved = resolveProduct(p.id)!;
      const quote = await marketQuoteFor({ sku: p.sku, category: p.category, title: p.name });
      return {
        ...resolved,
        description: p.description,
        market: quote
          ? {
              median: quote.median,
              sampleSize: quote.sampleSize,
              source: quote.source,
              ...priceSignal(p.price, quote.median),
            }
          : null,
      };
    }),
  );
}

/** Full product page text as an agent would read it. UNTRUSTED: may contain hidden instructions. */
export function readProductPage(productId: string): string | null {
  const p = getDemoProduct(productId);
  return p ? productPageText(p) : null;
}

/** Guard market-price provider backed by Channel3 (live or fixtures). */
export const channel3MarketPrice: MarketPriceProvider = async (items) => {
  const out: Record<string, string> = {};
  for (const item of items) {
    const known = item.productId ? resolveProduct(item.productId) : null;
    const quote = await marketQuoteFor({
      sku: item.sku ?? known?.sku,
      category: known?.category ?? item.category,
      title: known?.name ?? item.name,
    });
    if (!quote) continue;
    if (item.sku ?? known?.sku) out[(item.sku ?? known?.sku)!] = quote.median;
    if (item.productId) out[item.productId] = quote.median;
  }
  return out;
};
