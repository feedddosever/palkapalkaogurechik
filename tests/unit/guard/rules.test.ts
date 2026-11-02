import { describe, expect, it } from "vitest";
import { evaluateRules } from "@/server/guard/evaluate";
import type { GuardContext, GuardRequest, RuleCode } from "@/server/guard/types";
import { ctx, invoice, minutesAgo, policy, purchase, recent, STORY, SUPPLIERS } from "./fixtures";

const codes = (req: GuardRequest, c: GuardContext = ctx(), p = policy()) =>
  evaluateRules(req, p, c).results.map((r) => r.code);

function expectVerdict(req: GuardRequest, verdict: string, expected: RuleCode[], c = ctx(), p = policy()) {
  const ev = evaluateRules(req, p, c);
  expect(ev.verdict).toBe(verdict);
  for (const code of expected) expect(ev.results.map((r) => r.code)).toContain(code);
  return ev;
}

describe("demo story at L1 (Assisted)", () => {
  it("auto-allows the usual espresso order ($84)", () => {
    const ev = expectVerdict(STORY.espresso(), "ALLOW", []);
    expect(ev.results).toEqual([]);
  });

  it("auto-allows two sleeves of cups ($116, under the $120 limit)", () => {
    expectVerdict(STORY.cups(), "ALLOW", [], ctx({ supplier: SUPPLIERS.papergoods }));
  });

  it("sends the $141 oat milk order to the owner", () => {
    const ev = expectVerdict(
      STORY.oat(),
      "NEEDS_APPROVAL",
      ["OVER_APPROVAL_THRESHOLD"],
      ctx({ supplier: SUPPLIERS.oat }),
    );
    expect(ev.attack).toBe(false);
    expect(ev.results[0].message).toBe("$141.00 is over your $120.00 approval limit.");
  });

  it("pays a known supplier's invoice to its known address", () => {
    expectVerdict(STORY.legitInvoice(), "ALLOW", [], ctx({ supplier: SUPPLIERS.papergoods }));
  });
});

describe("headline attacks are stopped by rules alone", () => {
  it("BEC: a known supplier asking to be paid somewhere new is BLOCKED", () => {
    const ev = expectVerdict(STORY.becInvoice(), "BLOCK", ["PAYEE_CHANGED"], ctx({ supplier: null }));
    expect(ev.attack).toBe(true);
    const finding = ev.results.find((r) => r.code === "PAYEE_CHANGED")!;
    expect(finding.message).toContain("billing@northside-roasters.example");
    expect(finding.message).toContain("payments@northside-billing-secure.example");
  });

  it("BEC is caught even when the agent names the supplier by slug", () => {
    expectVerdict({ ...STORY.becInvoice(), supplierSlug: "northside-roasters" }, "BLOCK", ["PAYEE_CHANGED"]);
  });

  it("BEC is caught on a lookalike domain even under a different sender name", () => {
    const req = invoice({
      supplierName: "Accounts Dept",
      payeeEmail: "pay@northside-roasters-billing.example",
      amount: "50.00",
    });
    const ev = expectVerdict(req, "BLOCK", ["PAYEE_CHANGED"], ctx({ supplier: null }));
    expect(ev.results.find((r) => r.code === "PAYEE_CHANGED")!.data).toMatchObject({
      lookalikeOf: "billing@northside-roasters.example",
    });
  });

  it("hidden-injection cash-out: gift cards are BLOCKED as a forbidden category", () => {
    const ev = expectVerdict(
      STORY.giftCards(),
      "BLOCK",
      ["FORBIDDEN_CATEGORY"],
      ctx({ supplier: SUPPLIERS.bulkbarn }),
    );
    expect(ev.attack).toBe(true);
  });

  it("structuring: a third split payment within the window is BLOCKED", () => {
    const half = purchase("northside", "billing@northside-roasters.example", [["decaf", 2]]); // $48
    const c = ctx({
      recentRequests: [
        recent(half, { createdAt: minutesAgo(20) }),
        recent(half, { createdAt: minutesAgo(10) }),
      ],
    });
    const ev = expectVerdict(half, "BLOCK", ["STRUCTURING_SUSPECTED"], c);
    expect(ev.attack).toBe(true);
  });

  it("retry storm: an identical request minutes later is BLOCKED as a duplicate", () => {
    const req = STORY.espresso();
    expectVerdict(
      req,
      "BLOCK",
      ["DUPLICATE_REQUEST"],
      ctx({ recentRequests: [recent(req, { createdAt: minutesAgo(2) })] }),
    );
  });
});

describe("hold & request integrity", () => {
  it("blocks when no PayPal hold is active", () => {
    expectVerdict(STORY.espresso(), "BLOCK", ["NO_ACTIVE_CYCLE"], ctx({ cycle: null }));
  });

  it("blocks when the payment exceeds what's left (captured + reserved)", () => {
    const c = ctx({ cycle: { amount: "500.00", capturedTotal: "300.00", reservedTotal: "141.00" } });
    const ev = expectVerdict(STORY.espresso(), "BLOCK", ["BUDGET_EXCEEDED"], c);
    expect(ev.results.find((r) => r.code === "BUDGET_EXCEEDED")!.data).toEqual({ remaining: "59.00" });
  });

  it("blocks paused agents", () => {
    expectVerdict(
      STORY.espresso(),
      "BLOCK",
      ["AGENT_PAUSED"],
      ctx({ agent: { status: "paused", autonomyLevel: 4 } }),
    );
  });

  it("blocks other currencies", () => {
    expectVerdict({ ...STORY.espresso(), currency: "EUR" }, "BLOCK", ["CURRENCY_MISMATCH"]);
  });

  it("blocks a total that doesn't match the items (price manipulation)", () => {
    const ev = expectVerdict({ ...STORY.espresso(), amount: "184.00" }, "BLOCK", ["AMOUNT_MISMATCH"]);
    expect(ev.attack).toBe(true);
  });

  it("blocks empty purchases and non-positive amounts", () => {
    expect(codes({ ...STORY.espresso(), items: [] })).toContain("AMOUNT_MISMATCH");
    expect(codes({ ...STORY.legitInvoice(), amount: "0.00" })).toContain("AMOUNT_MISMATCH");
  });
});

describe("categories", () => {
  it("asks about categories the owner didn't list", () => {
    const req = purchase("northside", "billing@northside-roasters.example", [["espressoMachine", 1]]);
    expectVerdict(req, "NEEDS_APPROVAL", ["CATEGORY_NOT_ALLOWED"]);
  });

  it("enforces per-item caps", () => {
    const p = policy({ categories: [{ name: "coffee", perItemMax: 40 }] });
    expectVerdict(STORY.espresso(), "NEEDS_APPROVAL", ["ITEM_OVER_CAP"], ctx(), p);
  });

  it("enforces category budgets using spend so far this cycle", () => {
    const p = policy({ categories: [{ name: "coffee", budget: 250 }] });
    expectVerdict(
      STORY.espresso(),
      "NEEDS_APPROVAL",
      ["CATEGORY_BUDGET_EXCEEDED"],
      ctx({ spentByCategory: { coffee: "200.00" } }),
      p,
    );
    expect(codes(STORY.espresso(), ctx({ spentByCategory: { coffee: "166.00" } }), p)).not.toContain(
      "CATEGORY_BUDGET_EXCEEDED",
    );
  });

  it("reports each forbidden category once even with several lines", () => {
    const req = purchase("bulkbarn", "x@bulkbarn.example", [
      ["giftCard", 1],
      ["giftCard", 2],
    ]);
    expect(
      codes(req, ctx({ supplier: SUPPLIERS.bulkbarn })).filter((c) => c === "FORBIDDEN_CATEGORY"),
    ).toHaveLength(1);
  });
});

describe("suppliers & payees", () => {
  it("a cheap listing from an unknown, unverified seller needs approval (not auto-bought)", () => {
    const req = purchase("bulkbarn", "sales@bulkbarn-wholesale.example", [["bbOat", 6]]);
    expectVerdict(
      req,
      "NEEDS_APPROVAL",
      ["NEW_SUPPLIER", "UNVERIFIED_SUPPLIER", "NEW_PAYEE"],
      ctx({ supplier: SUPPLIERS.bulkbarn }),
    );
  });

  it("respects supplier block lists and a 'block new suppliers' policy", () => {
    expectVerdict(
      STORY.espresso(),
      "BLOCK",
      ["SUPPLIER_BLOCKED"],
      ctx(),
      policy({ suppliers: { allow: [], block: ["northside-roasters"], newSupplier: "approve" } }),
    );
    const req = purchase("brightclean", "orders@brightclean.example", [["sanitizer", 1]]);
    expectVerdict(
      req,
      "BLOCK",
      ["NEW_SUPPLIER"],
      ctx({ supplier: SUPPLIERS.brightclean }),
      policy({ suppliers: { allow: [], block: [], newSupplier: "block" } }),
    );
  });

  it("respects new-payee and changed-payee policies", () => {
    const req = purchase("brightclean", "orders@brightclean.example", [["sanitizer", 1]]);
    const c = ctx({ supplier: SUPPLIERS.brightclean });
    expect(codes(req, c, policy({ payees: { newPayee: "allow", changedPayee: "block" } }))).not.toContain(
      "NEW_PAYEE",
    );
    expectVerdict(
      req,
      "BLOCK",
      ["NEW_PAYEE"],
      c,
      policy({ payees: { newPayee: "block", changedPayee: "block" } }),
    );
    const ev = expectVerdict(
      STORY.becInvoice(),
      "NEEDS_APPROVAL",
      ["PAYEE_CHANGED"],
      ctx({ supplier: null }),
      policy({ payees: { newPayee: "approve", changedPayee: "approve" } }),
    );
    expect(ev.attack).toBe(true);
  });

  it("allows new suppliers when the owner says so", () => {
    const req = purchase("brightclean", "orders@brightclean.example", [["sanitizer", 1]]);
    expect(
      codes(
        req,
        ctx({ supplier: SUPPLIERS.brightclean }),
        policy({ suppliers: { allow: [], block: [], newSupplier: "allow" } }),
      ),
    ).not.toContain("NEW_SUPPLIER");
  });
});

describe("patterns over time", () => {
  it("two payments to one supplier that cross the limit need approval", () => {
    const decaf = purchase("northside", "billing@northside-roasters.example", [["decaf", 2]]); // $48
    const c = ctx({ recentRequests: [recent(STORY.espresso(), { createdAt: minutesAgo(60) })] });
    const ev = expectVerdict(decaf, "NEEDS_APPROVAL", ["STRUCTURING_SUSPECTED"], c, policy());
    expect(ev.results.find((r) => r.code === "STRUCTURING_SUSPECTED")!.attack).toBe(false);
  });

  it("ignores old, denied and blocked requests when checking for structuring", () => {
    const decaf = purchase("northside", "billing@northside-roasters.example", [["decaf", 2]]);
    const c = ctx({
      recentRequests: [
        recent(STORY.espresso(), { createdAt: minutesAgo(60 * 30) }),
        recent(STORY.espresso(), { status: "denied" }),
        recent(STORY.espresso(), { status: "blocked" }),
      ],
    });
    expect(codes(decaf, c)).not.toContain("STRUCTURING_SUSPECTED");
    expect(
      codes(
        decaf,
        ctx({ recentRequests: [recent(STORY.espresso())] }),
        policy({ structuring: { enabled: false, windowHours: 24 } }),
      ),
    ).not.toContain("STRUCTURING_SUSPECTED");
  });

  it("duplicates: same key is a retry (no finding); hours later needs approval", () => {
    const req = STORY.espresso();
    expect(
      codes(
        req,
        ctx({
          recentRequests: [recent(req, { idempotencyKey: req.idempotencyKey, createdAt: minutesAgo(1) })],
        }),
      ),
    ).not.toContain("DUPLICATE_REQUEST");
    expectVerdict(
      req,
      "NEEDS_APPROVAL",
      ["DUPLICATE_REQUEST"],
      ctx({ recentRequests: [recent(req, { createdAt: minutesAgo(180) })] }),
    );
  });

  it("never pays the same invoice twice", () => {
    const req = STORY.legitInvoice();
    const c = ctx({ supplier: SUPPLIERS.papergoods, recentRequests: [recent(req, { status: "executed" })] });
    const ev = expectVerdict(req, "BLOCK", ["DUPLICATE_INVOICE"], c);
    expect(ev.attack).toBe(true);
  });
});

describe("sanity checks", () => {
  it("quantity well above usual needs approval; extreme quantity is blocked", () => {
    expectVerdict(
      purchase("northside", "billing@northside-roasters.example", [["espresso", 7]]),
      "NEEDS_APPROVAL",
      ["QUANTITY_ANOMALY"],
      ctx({ cycle: { amount: "5000.00", capturedTotal: "0", reservedTotal: "0" } }),
      policy({ approvalThreshold: 5000, categories: [{ name: "coffee" }] }),
    );
    const ev = expectVerdict(
      purchase("northside", "billing@northside-roasters.example", [["espresso", 50]]),
      "BLOCK",
      ["QUANTITY_ANOMALY", "BUDGET_EXCEEDED"],
    );
    expect(ev.results.find((r) => r.code === "QUANTITY_ANOMALY")!.attack).toBe(true);
  });

  it("flags prices well above the market median", () => {
    const req = purchase("northside", "billing@northside-roasters.example", [["espresso", 1]]);
    req.items[0].unitPrice = "60.00";
    req.amount = "60.00";
    const ev = expectVerdict(req, "NEEDS_APPROVAL", ["PRICE_ABOVE_MARKET"]);
    expect(ev.results.find((r) => r.code === "PRICE_ABOVE_MARKET")!.data).toMatchObject({ overPct: 43 });
    req.items[0].unitPrice = "50.00";
    req.amount = "50.00";
    expect(codes(req)).not.toContain("PRICE_ABOVE_MARKET");
  });
});
