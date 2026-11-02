import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/canonical-json";

describe("canonical JSON", () => {
  it("sorts keys at every level and drops undefined members", () => {
    expect(canonicalJson({ b: 1, a: { z: [3, { y: undefined, x: true }], c: null } })).toBe(
      '{"a":{"c":null,"z":[3,{"x":true}]},"b":1}',
    );
  });
  it("uses ECMAScript number and string serialization", () => {
    expect(canonicalJson([1e21, 0.1, -0, 'é\n"q"'])).toBe('[1e+21,0.1,0,"é\\n\\"q\\""]');
  });
  it("encodes dates as ISO strings and undefined array entries as null", () => {
    expect(canonicalJson([new Date("2026-11-05T12:00:00Z"), undefined])).toBe(
      '["2026-11-05T12:00:00.000Z",null]',
    );
  });
  it("rejects values JSON can't represent faithfully", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Infinity)).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
  });
});
