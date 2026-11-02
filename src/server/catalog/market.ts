import { fromCents, toCents } from "@/lib/money";
import type { Channel3Client } from "./channel3";
import { parseSize, toKind, type Size } from "./units";

/**
 * Market price quotes from Channel3. For each item type we search Channel3, keep offers whose pack
 * size is comparable (0.5×–2× ours), normalize every price to OUR pack size, and take the median.
 */

export type MarketSpec = { sku: string; query: string; size: Size; category: string };

export const MARKET_SPECS: MarketSpec[] = [
  { sku: "BEANS-ESP", query: "espresso coffee beans 5 lb", size: { kind: "lb", qty: 5 }, category: "coffee" },
  { sku: "BEANS-DRIP", query: "drip coffee beans 5 lb", size: { kind: "lb", qty: 5 }, category: "coffee" },
  {
    sku: "OAT-BARISTA",
    query: "barista oat milk 32 oz 6 pack",
    size: { kind: "floz", qty: 192 },
    category: "dairy_alt",
  },
  {
    sku: "CUP-12",
    query: "12 oz compostable hot cups 1000 count",
    size: { kind: "count", qty: 1000 },
    category: "packaging",
  },
  {
    sku: "LID-12",
    query: "12 oz sip lids 1000 count",
    size: { kind: "count", qty: 1000 },
    category: "packaging",
  },
  {
    sku: "NAPKIN",
    query: "recycled napkins case 4000",
    size: { kind: "count", qty: 4000 },
    category: "packaging",
  },
  {
    sku: "SANITIZER",
    query: "food safe sanitizer concentrate gallon 4 pack",
    size: { kind: "gal", qty: 4 },
    category: "cleaning",
  },
];

export type Comparable = {
  title: string;
  domain: string;
  url: string;
  price: string;
  normalizedPrice: string;
};

export type MarketQuote = {
  sku: string;
  query: string;
  /** Median price for our pack size. */
  median: string;
  p25: string;
  min: string;
  max: string;
  sampleSize: number;
  source: "channel3" | "channel3-fixture";
  comparables: Comparable[];
};

const MIN_SAMPLE = 3;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

export async function quoteMarket(client: Channel3Client, spec: MarketSpec): Promise<MarketQuote | null> {
  const { products } = await client.search({ query: spec.query, limit: 30 });
  const comparables: (Comparable & { cents: number })[] = [];
  for (const p of products) {
    const size = parseSize(p.title);
    const qty = size ? toKind(size, spec.size.kind) : null;
    if (!qty || qty < spec.size.qty * 0.5 || qty > spec.size.qty * 2) continue;
    const offer = p.offers.find((o) => o.availability === "InStock" && o.price.currency === "USD");
    if (!offer) continue;
    const cents = Math.round((toCents(offer.price.price.toFixed(2)) * spec.size.qty) / qty);
    comparables.push({
      title: p.title,
      domain: offer.domain,
      url: offer.url,
      price: offer.price.price.toFixed(2),
      normalizedPrice: fromCents(cents),
      cents,
    });
  }
  if (comparables.length < MIN_SAMPLE) return null;
  const sorted = comparables.map((c) => c.cents).sort((a, b) => a - b);
  return {
    sku: spec.sku,
    query: spec.query,
    median: fromCents(percentile(sorted, 0.5)),
    p25: fromCents(percentile(sorted, 0.25)),
    min: fromCents(sorted[0]),
    max: fromCents(sorted[sorted.length - 1]),
    sampleSize: comparables.length,
    source: client.mode === "live" ? "channel3" : "channel3-fixture",
    comparables: comparables.map((c) => ({
      title: c.title,
      domain: c.domain,
      url: c.url,
      price: c.price,
      normalizedPrice: c.normalizedPrice,
    })),
  };
}

/** Finds the market spec for a product: by SKU, else by category + comparable pack size. */
export function specFor(product: { sku?: string; category: string; title: string }): MarketSpec | undefined {
  if (product.sku) {
    const bySku = MARKET_SPECS.find((s) => s.sku === product.sku);
    if (bySku) return bySku;
  }
  const size = parseSize(product.title);
  if (!size) return undefined;
  return MARKET_SPECS.find((s) => {
    if (s.category !== product.category) return false;
    const qty = toKind(size, s.size.kind);
    return qty !== null && qty >= s.size.qty * 0.5 && qty <= s.size.qty * 2;
  });
}

export type PriceSignal = "suspiciously_cheap" | "below_market" | "fair" | "above_market";

/** How a price compares with the market median (negative = cheaper). */
export function priceSignal(price: string, median: string): { deltaPct: number; signal: PriceSignal } {
  const deltaPct = Math.round((toCents(price) / toCents(median) - 1) * 1000) / 10;
  const signal: PriceSignal =
    deltaPct <= -25
      ? "suspiciously_cheap"
      : deltaPct < -2
        ? "below_market"
        : deltaPct <= 10
          ? "fair"
          : "above_market";
  return { deltaPct, signal };
}
