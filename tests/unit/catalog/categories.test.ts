import { describe, expect, it } from "vitest";
import { toLeashCategory } from "@/server/catalog/categories";

const path = (...titles: string[]) => ({
  slug: titles.at(-1)!.toLowerCase().replace(/ /g, "-"),
  title: titles.at(-1)!,
  path: titles.map((t) => ({ slug: t.toLowerCase().replace(/ /g, "-"), title: t })),
});

describe("Channel3 category → Leash category", () => {
  it("uses the taxonomy path", () => {
    expect(
      toLeashCategory(path("Food, Beverages & Tobacco", "Beverages", "Coffee"), "Velvet Blend 5 lb"),
    ).toBe("coffee");
    expect(
      toLeashCategory(path("Food, Beverages & Tobacco", "Beverages", "Milk Substitutes"), "Barista"),
    ).toBe("dairy_alt");
    expect(
      toLeashCategory(path("Business & Industrial", "Food Service", "Disposable Cups"), "Hot Coffee Cups"),
    ).toBe("packaging");
    expect(toLeashCategory(path("Business & Industrial", "Cleaning Supplies", "Sanitizers"), "x")).toBe(
      "cleaning",
    );
  });

  it("high-risk categories win wherever they appear", () => {
    expect(
      toLeashCategory(
        path("Food, Beverages & Tobacco", "Beverages", "Coffee"),
        "Coffee Shop eGift Card, $100",
      ),
    ).toBe("gift_cards");
    expect(toLeashCategory(path("Arts & Entertainment", "Gift Giving", "Gift Cards"), "$100 card")).toBe(
      "gift_cards",
    );
    expect(toLeashCategory(null, "Reloadable prepaid Visa card")).toBe("prepaid_cards");
    expect(toLeashCategory(null, "Bitcoin voucher")).toBe("crypto");
    expect(toLeashCategory(null, "Money order, $500")).toBe("money_transfer");
  });

  it("falls back to the title, with packaging before coffee and plant milk before dairy", () => {
    expect(toLeashCategory(null, "12 oz Hot Coffee Cups, 1000 ct")).toBe("packaging");
    expect(toLeashCategory(null, "Barista Oat Milk, 6 pack")).toBe("dairy_alt");
    expect(toLeashCategory(null, "Whole milk, gallon")).toBe("dairy");
    expect(toLeashCategory(null, "Two-group espresso machine")).toBe("equipment");
    expect(toLeashCategory(null, "Something else entirely")).toBe("other");
  });
});
