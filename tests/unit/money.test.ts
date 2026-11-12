import { describe, expect, it } from "vitest";
import { fromCents, multiplyAmount, normalizeAmount, sumAmounts, toCents } from "@/lib/money";

describe("money", () => {
  it("parses decimal strings exactly", () => {
    expect(toCents("84.00")).toBe(8400);
    expect(toCents("0.1")).toBe(10);
    expect(toCents("23.5")).toBe(2350);
    expect(toCents("-12.34")).toBe(-1234);
    expect(toCents("1000000")).toBe(100000000);
  });

  it("rejects malformed amounts", () => {
    for (const bad of ["", "1.234", "abc", "1,00", "$5"]) expect(() => toCents(bad)).toThrow();
    expect(() => toCents(Number.NaN)).toThrow();
  });

  it("formats cents", () => {
    expect(fromCents(8400)).toBe("84.00");
    expect(fromCents(5)).toBe("0.05");
    expect(fromCents(-1234)).toBe("-12.34");
    expect(() => fromCents(1.5)).toThrow();
  });

  it("avoids floating point drift", () => {
    expect(sumAmounts(["0.10", "0.20"])).toBe("0.30");
    expect(multiplyAmount("23.50", 6)).toBe("141.00");
    expect(normalizeAmount(19.999)).toBe("20.00");
  });
});
