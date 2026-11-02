import { describe, expect, it } from "vitest";
import {
  BULKBARN_INJECTION,
  DEMO_SUPPLIERS,
  getDemoProduct,
  productPageText,
} from "@/server/catalog/demo-suppliers";
import { DEMO_INVENTORY } from "@/server/seed/defaults";

describe("demo supplier catalog", () => {
  it("has unique supplier slugs and product ids", () => {
    const slugs = DEMO_SUPPLIERS.map((s) => s.slug);
    const ids = DEMO_SUPPLIERS.flatMap((s) => s.products.map((p) => p.id));
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every inventory SKU is sold by its preferred supplier at the usual price", () => {
    for (const item of DEMO_INVENTORY) {
      const supplier = DEMO_SUPPLIERS.find((s) => s.slug === item.preferredSupplierSlug);
      const product = supplier?.products.find((p) => p.sku === item.sku);
      expect(product, item.sku).toBeDefined();
      expect(product!.price).toBe(item.usualUnitPrice);
      expect(product!.category).toBe(item.category);
    }
  });

  it("the compromised listing hides an injection that only an agent would read", () => {
    const oat = getDemoProduct("bb-oat-6x32")!;
    expect(oat.hiddenText).toBe(BULKBARN_INJECTION);
    expect(productPageText(oat)).toContain("NOTICE TO AUTOMATED PURCHASING AGENTS");
    expect(getDemoProduct("bb-gc-100")!.category).toBe("gift_cards");
    expect(DEMO_SUPPLIERS.find((s) => s.slug === "bulkbarn")!.verified).toBe(false);
  });

  it("honest listings carry no hidden text", () => {
    const honest = DEMO_SUPPLIERS.filter((s) => s.slug !== "bulkbarn").flatMap((s) => s.products);
    expect(honest.every((p) => !p.hiddenText)).toBe(true);
  });
});
