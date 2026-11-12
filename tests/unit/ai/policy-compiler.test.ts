import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/ai/client")>()),
  runStructured: vi.fn(),
}));

import { runStructured } from "@/server/ai/client";
import { compileOffline, compilePolicy, type SupplierRef } from "@/server/ai/policy-compiler";
import { DEFAULT_OWNER_TEXT, DEFAULT_POLICY } from "@/server/seed/defaults";

const SUPPLIERS: SupplierRef[] = [
  { slug: "northside-roasters", name: "Northside Roasters", known: true },
  { slug: "oat-and-co", name: "Oat & Co", known: true },
  { slug: "papergoods", name: "PaperGoods Supply", known: true },
  { slug: "brightclean", name: "BrightClean", known: false },
];

beforeEach(() => {
  vi.mocked(runStructured).mockReset();
});

describe("offline compiler", () => {
  it("compiles Dana's rules to the reference policy and a faithful rule card", () => {
    const r = compileOffline(DEFAULT_OWNER_TEXT, SUPPLIERS);
    expect(r.source).toBe("offline");
    expect(r.policy).toEqual(DEFAULT_POLICY);
    expect(r.ruleCard.auto[0]).toBe("Spend up to $500 a week, held in PayPal");
    expect(r.ruleCard.ask[0]).toBe("Any single payment over $120");
    expect(r.ruleCard.ask).toContain("Anything from a supplier you haven't used before");
    expect(r.ruleCard.never[0]).toBe("Buy gift cards, prepaid cards, crypto and money transfers");
    expect(r.ruleCard.never).toContain("Pay a known supplier at new payment details");
  });

  it("extracts budget, limit, categories and usual suppliers from other wording", () => {
    const r = compileOffline(
      "We can spend $300 per week on coffee and cups from our usual suppliers. Ask me about anything over $80.",
      SUPPLIERS,
    );
    expect(r.policy.cycle).toEqual({ amount: 300, currency: "USD", period: "weekly" });
    expect(r.policy.approvalThreshold).toBe(80);
    expect(r.policy.categories.map((c) => c.name)).toEqual(["coffee", "packaging"]);
    expect(r.policy.suppliers.allow).toEqual(["northside-roasters", "oat-and-co", "papergoods"]);
    expect(r.policy.forbidden).toEqual(expect.arrayContaining(["gift_cards", "crypto"]));
    expect(r.clarifications).toEqual([]);
  });

  it("asks about missing essentials and records assumptions", () => {
    const r = compileOffline("Keep us stocked please.", SUPPLIERS);
    expect(r.clarifications).toEqual(
      expect.arrayContaining([
        "How much may the agent spend each week?",
        "What kinds of things may the agent buy?",
      ]),
    );
    expect(r.assumptions.some((a) => a.includes("need your approval"))).toBe(true);
  });
});

describe("AI compiler", () => {
  it("uses the model's draft but enforces safety floors in code", async () => {
    vi.mocked(runStructured).mockResolvedValueOnce({
      data: {
        cycle: { amount: 400, period: "weekly" },
        approvalThreshold: 900,
        categories: [
          { name: "coffee", budget: 200, perItemMax: null },
          { name: "gift_cards", budget: null, perItemMax: null },
        ],
        suppliers: { allow: ["northside-roasters", "evil-co"], block: [], newSupplier: "approve" },
        payees: { newPayee: "approve", changedPayee: "block" },
        forbidden: [],
        sanity: { maxQtyMultipleOfUsual: 3, maxOverMarketPct: 25 },
        structuring: { enabled: true, windowHours: 24 },
        assumptions: ["Assumed weekly budget."],
        clarifications: ["a", "b", "c", "d"],
      },
      usage: {
        model: "m",
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        latencyMs: 1,
      },
    });
    const r = await compilePolicy("anything", SUPPLIERS, { ai: true });
    expect(r.source).toBe("ai");
    expect(r.policy.categories).toEqual([{ name: "coffee", budget: 200 }]);
    expect(r.policy.forbidden).toEqual(
      expect.arrayContaining(["gift_cards", "prepaid_cards", "crypto", "money_transfer"]),
    );
    expect(r.policy.suppliers.allow).toEqual(["northside-roasters"]);
    expect(r.policy.approvalThreshold).toBe(400);
    expect(r.clarifications).toHaveLength(3);
    expect(r.assumptions).toEqual(
      expect.arrayContaining([
        "Assumed weekly budget.",
        "Gift cards, prepaid cards, crypto and money transfers are always blocked.",
        "Ignored suppliers that aren't in your supplier list.",
        "Approval limit capped at the budget.",
      ]),
    );
    const call = vi.mocked(runStructured).mock.calls[0][0];
    expect(call.tier).toBe("smart");
    expect(call.user).toContain("northside-roasters | Northside Roasters | known");
  });

  it("never calls the model offline", async () => {
    await compilePolicy(DEFAULT_OWNER_TEXT, SUPPLIERS, { ai: false });
    expect(runStructured).not.toHaveBeenCalled();
  });
});
