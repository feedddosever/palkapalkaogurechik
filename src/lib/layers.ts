/** How a guard layer's verdict is shown: honest about layers that didn't run. */
export type LayerLike = { layer: string; verdict: string; codes?: string[] };

export function layerChip(l: LayerLike): { label: string; tone: "allow" | "review" | "block" | "neutral" } {
  const off = (l.codes ?? []).some((c) => c.endsWith("_OFFLINE") || c.endsWith("_DISABLED"));
  if (off) return { label: `${l.layer}: offline`, tone: "neutral" };
  if (l.verdict === "BLOCK") return { label: `${l.layer}: block`, tone: "block" };
  if (l.verdict === "NEEDS_APPROVAL") return { label: `${l.layer}: ask`, tone: "review" };
  return { label: `${l.layer}: allow`, tone: "allow" };
}

export const LAYER_ORDER = ["rules", "scanner", "judge"];

export function orderLayers<T extends { layer: string }>(layers: T[]): T[] {
  return [...layers].sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer));
}
