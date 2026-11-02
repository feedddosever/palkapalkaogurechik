import { describe, expect, it } from "vitest";
import { parseSize, toKind } from "@/server/catalog/units";

describe("pack size parsing", () => {
  it.each([
    ["Espresso Roast Whole Bean Coffee, 5 lb Bag", { kind: "lb", qty: 5 }],
    ["Single Origin Espresso, Whole Bean, 5 Pound", { kind: "lb", qty: 5 }],
    ["Organic Espresso Blend Coffee Beans 5lb", { kind: "lb", qty: 5 }],
    ["Classic Espresso Beans, 80 oz", { kind: "floz", qty: 80 }],
    ["Barista Oat Milk, 32 fl oz (Pack of 6)", { kind: "floz", qty: 192 }],
    ["Barista Series Oat Beverage, 6 x 32 fl oz", { kind: "floz", qty: 192 }],
    ["Original Barista Oat Milk 32 oz, Case of 6", { kind: "floz", qty: 192 }],
    ["Barista Oat Milk, case of 6 × 32 oz", { kind: "floz", qty: 192 }],
    ["Barista Oat Milk, 32 oz, 12 Pack", { kind: "floz", qty: 384 }],
    ["12 oz Compostable Hot Cups, 1000 ct", { kind: "count", qty: 1000 }],
    ["Paper Hot Coffee Cups 12 oz, 1,000 Count", { kind: "count", qty: 1000 }],
    ["1-Ply Recycled Napkins, Case of 4000 ct", { kind: "count", qty: 4000 }],
    ["Food Contact Sanitizer Concentrate, 1 Gallon, 4 Pack", { kind: "gal", qty: 4 }],
    ["No-Rinse Food Surface Sanitizer, 4 x 1 gal", { kind: "gal", qty: 4 }],
    ["Food-safe sanitizer concentrate, 4 × 1 gal", { kind: "gal", qty: 4 }],
    ["Food-Safe Sanitizing Concentrate, 4 Gallons", { kind: "gal", qty: 4 }],
  ])("%s", (title, expected) => {
    expect(parseSize(title)).toEqual(expected);
  });

  it("returns null when no size is stated", () => {
    expect(parseSize("BulkBarn Digital Gift Card")).toBeNull();
  });

  it("converts ounces of coffee to pounds, refuses nonsense conversions", () => {
    expect(toKind({ kind: "floz", qty: 80 }, "lb")).toBe(5);
    expect(toKind({ kind: "count", qty: 1000 }, "lb")).toBeNull();
    expect(toKind({ kind: "gal", qty: 4 }, "gal")).toBe(4);
  });
});
