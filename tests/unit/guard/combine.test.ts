import { describe, expect, it } from "vitest";
import { combineLayers, type LayerOutcome } from "@/server/guard/combine";
import { SEVERITY, type Verdict } from "@/server/guard/types";

const V: Verdict[] = ["ALLOW", "NEEDS_APPROVAL", "BLOCK"];
const layer = (l: LayerOutcome["layer"], verdict: Verdict, attack = false): LayerOutcome => ({
  layer: l,
  verdict,
  codes: [],
  reasons: [],
  attack,
});

describe("combineLayers: AI can tighten, never loosen", () => {
  it("never returns a verdict below the rules verdict, for every combination", () => {
    for (const r of V)
      for (const s of V)
        for (const j of V) {
          const out = combineLayers(layer("rules", r), [layer("scanner", s), layer("judge", j)]);
          expect(SEVERITY[out.verdict]).toBeGreaterThanOrEqual(SEVERITY[r]);
          expect(SEVERITY[out.verdict]).toBe(Math.max(SEVERITY[r], SEVERITY[s], SEVERITY[j]));
        }
  });

  it("an AI 'ALLOW' cannot unlock a rules BLOCK", () => {
    const out = combineLayers(layer("rules", "BLOCK"), [layer("judge", "ALLOW")]);
    expect(out.verdict).toBe("BLOCK");
    expect(out.decidedBy).toEqual(["rules"]);
  });

  it("the AI judge can escalate what the rules allowed", () => {
    const out = combineLayers(layer("rules", "ALLOW"), [
      layer("scanner", "NEEDS_APPROVAL"),
      layer("judge", "BLOCK", true),
    ]);
    expect(out.verdict).toBe("BLOCK");
    expect(out.decidedBy).toEqual(["judge"]);
    expect(out.attack).toBe(true);
  });

  it("reports every layer that agreed on the final verdict; none when allowed", () => {
    expect(combineLayers(layer("rules", "BLOCK"), [layer("judge", "BLOCK")]).decidedBy).toEqual([
      "rules",
      "judge",
    ]);
    expect(combineLayers(layer("rules", "ALLOW"), [layer("judge", "ALLOW")]).decidedBy).toEqual([]);
  });

  it("attack flags on allowing layers don't count", () => {
    expect(combineLayers(layer("rules", "ALLOW"), [layer("judge", "ALLOW", true)]).attack).toBe(false);
  });

  it("requires the deterministic rules as the first layer", () => {
    expect(() => combineLayers(layer("judge", "ALLOW"))).toThrow(/rules/);
  });
});
