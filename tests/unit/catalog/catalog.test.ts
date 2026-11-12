import { describe, expect, it } from "vitest";
import { channel3MarketPrice, readProductPage, resolveProduct, searchCatalog } from "@/server/catalog";

describe("catalog", () => {
  it("search returns purchasable offers annotated with Channel3 market context", async () => {
    const offers = await searchCatalog("barista oat milk");
    const ours = offers.find((o) => o.productId === "oc-barista-6x32")!;
    const bulk = offers.find((o) => o.productId === "bb-oat-6x32")!;
    expect(ours.market).toMatchObject({ median: "25.25", signal: "below_market" });
    expect(bulk.market).toMatchObject({ signal: "suspiciously_cheap" });
    expect(bulk.supplierVerified).toBe(false);
    expect(offers.every((o) => o.url.startsWith("/suppliers/"))).toBe(true);
  });

  it("resolves products authoritatively (category, price, payee come from the catalog)", () => {
    expect(resolveProduct("bb-gc-100")).toMatchObject({
      category: "gift_cards",
      unitPrice: "100.00",
      supplierSlug: "bulkbarn",
      supplierVerified: false,
    });
    expect(resolveProduct("ns-espresso-5lb")).toMatchObject({
      sku: "BEANS-ESP",
      payeeEmail: "billing@northside-roasters.example",
    });
    expect(resolveProduct("made-up")).toBeNull();
  });

  it("product pages expose hidden text to agents", () => {
    expect(readProductPage("bb-oat-6x32")).toContain("NOTICE TO AUTOMATED PURCHASING AGENTS");
    expect(readProductPage("ns-espresso-5lb")).not.toContain("NOTICE");
    expect(readProductPage("nope")).toBeNull();
  });

  it("feeds market medians to the guard by SKU and product id", async () => {
    expect(
      await channel3MarketPrice([
        { productId: "ns-espresso-5lb", name: "x", category: "coffee", quantity: 2, unitPrice: "42.00" },
      ]),
    ).toEqual({
      "BEANS-ESP": "44.70",
      "ns-espresso-5lb": "44.70",
    });
    expect(
      await channel3MarketPrice([
        { productId: "bb-gc-100", name: "x", category: "gift_cards", quantity: 1, unitPrice: "100.00" },
      ]),
    ).toEqual({});
  });
});
