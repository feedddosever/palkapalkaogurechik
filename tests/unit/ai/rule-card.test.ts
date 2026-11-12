import { describe, expect, it } from "vitest";
import { diffPolicies, ruleCardFromPolicy } from "@/server/guard/rule-card";
import { DEFAULT_POLICY } from "@/server/seed/defaults";

describe("rule card & policy diff", () => {
  it("renders supplier names and category limits", () => {
    const card = ruleCardFromPolicy(
      { ...DEFAULT_POLICY, categories: [{ name: "coffee", budget: 250, perItemMax: 60 }] },
      {
        "northside-roasters": "Northside Roasters",
        "oat-and-co": "Oat & Co",
        papergoods: "PaperGoods Supply",
      },
    );
    expect(card.auto[1]).toBe("Buy coffee (up to $250/week, ≤ $60 per item)");
    expect(card.auto[2]).toBe("From Northside Roasters, Oat & Co and PaperGoods Supply");
    expect(card.never.at(-1)).toBe("Spend more than the $500 PayPal hold");
  });

  it("describes what changed between policy versions", () => {
    const after = {
      ...DEFAULT_POLICY,
      approvalThreshold: 150,
      categories: [...DEFAULT_POLICY.categories, { name: "tea" as const }],
      suppliers: { ...DEFAULT_POLICY.suppliers, allow: [...DEFAULT_POLICY.suppliers.allow, "brightclean"] },
      payees: { ...DEFAULT_POLICY.payees, newPayee: "allow" as const },
    };
    expect(diffPolicies(DEFAULT_POLICY, after)).toEqual([
      "Approval limit: $120 → $150",
      "Added category: tea",
      "Trusted supplier added: brightclean",
      "New payees: approve → allow",
    ]);
    expect(diffPolicies(DEFAULT_POLICY, DEFAULT_POLICY)).toEqual([]);
  });
});
