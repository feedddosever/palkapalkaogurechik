import { describe, expect, it } from "vitest";
import { canonicalJson, policyHash, PolicySchema } from "@/server/guard/policy";
import { DEFAULT_POLICY } from "@/server/seed/defaults";

describe("policy", () => {
  it("the default (Dana's) policy is valid", () => {
    expect(PolicySchema.parse(DEFAULT_POLICY)).toEqual(DEFAULT_POLICY);
  });

  it("forbids the classic cash-out categories", () => {
    expect(DEFAULT_POLICY.forbidden).toEqual(
      expect.arrayContaining(["gift_cards", "prepaid_cards", "crypto", "money_transfer"]),
    );
  });

  it("canonical JSON is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 0, f: 1 }], d: 2 }, b: 1 }),
    );
  });

  it("policy hash is stable and changes when any rule changes", () => {
    const h = policyHash(DEFAULT_POLICY);
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(policyHash(structuredClone(DEFAULT_POLICY))).toBe(h);
    expect(policyHash({ ...DEFAULT_POLICY, approvalThreshold: 121 })).not.toBe(h);
  });
});
