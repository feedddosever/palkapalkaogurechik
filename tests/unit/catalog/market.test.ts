import { describe, expect, it } from "vitest";
import { FixtureChannel3 } from "@/server/catalog/channel3";
import { MARKET_SPECS, priceSignal, quoteMarket, specFor } from "@/server/catalog/market";

const c3 = new FixtureChannel3();
const spec = (sku: string) => MARKET_SPECS.find((s) => s.sku === sku)!;

describe("market quotes from Channel3", () => {
  it("espresso: median of comparable 5 lb bags; the 12 oz bag is excluded", async () => {
    const q = (await quoteMarket(c3, spec("BEANS-ESP")))!;
    expect(q).toMatchObject({
      median: "44.70",
      min: "39.99",
      max: "49.99",
      sampleSize: 6,
      source: "channel3-fixture",
    });
    expect(q.comparables.some((c) => c.title.includes("12 oz"))).toBe(false);
  });

  it("oat milk: a 12-pack is normalized to our 6-pack size", async () => {
    const q = (await quoteMarket(c3, spec("OAT-BARISTA")))!;
    expect(q.sampleSize).toBe(6);
    expect(q.comparables.find((c) => c.title.includes("12 Pack"))?.normalizedPrice).toBe("29.70");
    expect(q.median).toBe("25.25");
  });

  it("every café supply has a market quote", async () => {
    for (const s of MARKET_SPECS) expect(await quoteMarket(c3, s), s.sku).not.toBeNull();
  });

  it("needs at least three comparables", async () => {
    expect(
      await quoteMarket(c3, {
        sku: "X",
        query: "digital gift card 100",
        size: { kind: "count", qty: 1 },
        category: "gift_cards",
      }),
    ).toBeNull();
  });

  it("finds the spec by SKU, or by category and pack size", () => {
    expect(specFor({ sku: "CUP-12", category: "packaging", title: "" })?.sku).toBe("CUP-12");
    expect(
      specFor({ category: "dairy_alt", title: "Oat milk barista style, 6 × 32 oz (wholesale)" })?.sku,
    ).toBe("OAT-BARISTA");
    expect(specFor({ category: "gift_cards", title: "BulkBarn Digital Gift Card, $100" })).toBeUndefined();
  });

  it("classifies prices against the median", () => {
    expect(priceSignal("42.00", "44.70")).toEqual({ deltaPct: -6, signal: "below_market" });
    expect(priceSignal("17.90", "25.25")).toEqual({ deltaPct: -29.1, signal: "suspiciously_cheap" });
    expect(priceSignal("25.00", "25.25").signal).toBe("fair");
    expect(priceSignal("40.00", "25.25").signal).toBe("above_market");
  });
});
