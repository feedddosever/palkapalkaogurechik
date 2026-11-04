import { maxVerdict, SEVERITY, type Verdict } from "./types";

export type LayerName = "rules" | "scanner" | "judge";

export type LayerOutcome = {
  layer: LayerName;
  verdict: Verdict;
  codes: string[];
  reasons: string[];
  attack?: boolean;
};

export type CombinedDecision = {
  verdict: Verdict;
  attack: boolean;
  layers: LayerOutcome[];
  /** Layers whose verdict determined the outcome. */
  decidedBy: LayerName[];
};

/**
 * Combines the deterministic rules with the AI layers.
 *
 * Invariant ("AI can tighten, never loosen"): the final verdict is the MAXIMUM severity across
 * layers, so an AI layer that says ALLOW can never lower a rules verdict. Prompt injection that
 * fools the judge therefore cannot unlock a payment the rules stopped.
 */
export function combineLayers(rules: LayerOutcome, ai: LayerOutcome[] = []): CombinedDecision {
  if (rules.layer !== "rules") throw new Error("The first layer must be the deterministic rules");
  const layers = [rules, ...ai];
  const verdict = maxVerdict(...layers.map((l) => l.verdict));
  const decidedBy =
    verdict === "ALLOW" ? [] : layers.filter((l) => l.verdict === verdict).map((l) => l.layer);
  const attack = layers.some((l) => l.attack && SEVERITY[l.verdict] > 0);
  return { verdict, attack, layers, decidedBy };
}
