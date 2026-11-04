import { describe, expect, it } from "vitest";
import {
  distinctiveTokens,
  domainOf,
  findLookalike,
  normalizeName,
  payeesForSupplierName,
} from "@/server/guard/payee-match";
import { KNOWN_PAYEES } from "./fixtures";

describe("payee matching", () => {
  it("normalizes business names", () => {
    expect(normalizeName("Oat & Co")).toBe(normalizeName("oat and co."));
    expect(normalizeName("The Northside Roasters, LLC")).toBe("northside roasters");
  });

  it("extracts identifying domain tokens", () => {
    expect(domainOf("Billing@Northside-Roasters.example")).toBe("northside-roasters.example");
    expect(distinctiveTokens("northside-billing-secure.example")).toEqual(["northside"]);
    expect(distinctiveTokens("payments.example")).toEqual([]);
  });

  it("finds a supplier's known payees by the claimed name", () => {
    expect(payeesForSupplierName("northside roasters", KNOWN_PAYEES).map((p) => p.email)).toEqual([
      "billing@northside-roasters.example",
    ]);
    expect(payeesForSupplierName("", KNOWN_PAYEES)).toEqual([]);
  });

  it("detects lookalike domains but not known or unrelated payees", () => {
    expect(findLookalike("payments@northside-billing-secure.example", KNOWN_PAYEES)?.supplierName).toBe(
      "Northside Roasters",
    );
    expect(findLookalike("billing@northside-roasters.example", KNOWN_PAYEES)).toBeNull();
    expect(findLookalike("orders@brightclean.example", KNOWN_PAYEES)).toBeNull();
    expect(findLookalike("someone@payments.example", KNOWN_PAYEES)).toBeNull();
    expect(findLookalike("no-at-sign", KNOWN_PAYEES)).toBeNull();
  });
});
