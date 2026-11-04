import { describe, expect, it } from "vitest";
import { evaluateRules } from "@/server/guard/evaluate";
import { LEVELS } from "@/server/guard/levels";
import type { AutonomyLevel } from "@/server/guard/types";
import { ctx, policy, purchase, STORY, SUPPLIERS } from "./fixtures";

const at = (level: AutonomyLevel, extra = {}) =>
  ctx({ agent: { status: "active", autonomyLevel: level }, ...extra });

describe("autonomy levels", () => {
  it("defines five levels", () => {
    expect(Object.keys(LEVELS)).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("L0 asks about everything, even the usual order", () => {
    const ev = evaluateRules(STORY.espresso(), policy(), at(0));
    expect(ev.verdict).toBe("NEEDS_APPROVAL");
    expect(ev.results.map((r) => r.code)).toEqual(["LEVEL_REQUIRES_APPROVAL"]);
  });

  it("L1 asks about items never bought before; L2 waives that", () => {
    const decaf = purchase("northside", "billing@northside-roasters.example", [["decaf", 1]]);
    expect(evaluateRules(decaf, policy(), at(1)).verdict).toBe("NEEDS_APPROVAL");
    const l2 = evaluateRules(decaf, policy(), at(2));
    expect(l2.verdict).toBe("ALLOW");
    expect(l2.waived.map((r) => r.code)).toEqual(["NEW_ITEM"]);
    expect(l2.waived[0].data?.waivedBecause).toMatch(/L2/);
  });

  it("L3 lets a verified new supplier through; an unverified one still needs approval", () => {
    const sanitizer = purchase("brightclean", "orders@brightclean.example", [["sanitizer", 1]]);
    const l2 = evaluateRules(sanitizer, policy(), at(2, { supplier: SUPPLIERS.brightclean }));
    expect(l2.verdict).toBe("NEEDS_APPROVAL");
    const l3 = evaluateRules(sanitizer, policy(), at(3, { supplier: SUPPLIERS.brightclean }));
    expect(l3.verdict).toBe("ALLOW");
    expect(l3.waived.map((r) => r.code).sort()).toEqual(["NEW_ITEM", "NEW_PAYEE", "NEW_SUPPLIER"]);

    const bbOat = purchase("bulkbarn", "sales@bulkbarn-wholesale.example", [["bbOat", 6]]);
    const ev = evaluateRules(bbOat, policy(), at(3, { supplier: SUPPLIERS.bulkbarn }));
    expect(ev.verdict).toBe("NEEDS_APPROVAL");
    expect(ev.results.map((r) => r.code)).toEqual(
      expect.arrayContaining(["NEW_SUPPLIER", "UNVERIFIED_SUPPLIER"]),
    );
  });

  it("L4 may exceed the approval limit inside the hold", () => {
    const ev = evaluateRules(STORY.oat(), policy(), at(4, { supplier: SUPPLIERS.oat }));
    expect(ev.verdict).toBe("ALLOW");
    expect(ev.waived.map((r) => r.code)).toEqual(["OVER_APPROVAL_THRESHOLD"]);
  });

  it("no level ever waives a BLOCK", () => {
    for (const level of [0, 1, 2, 3, 4] as const) {
      expect(
        evaluateRules(STORY.giftCards(), policy(), at(level, { supplier: SUPPLIERS.bulkbarn })).verdict,
      ).toBe("BLOCK");
      expect(evaluateRules(STORY.becInvoice(), policy(), at(level, { supplier: null })).verdict).toBe(
        "BLOCK",
      );
    }
  });
});
