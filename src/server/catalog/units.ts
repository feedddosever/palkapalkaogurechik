/**
 * Pack-size parsing for market price comparison. Listings describe size in free text
 * ("Barista Oat Milk, 32 fl oz (Pack of 6)", "5 lb bag", "1,000 ct"); comparing prices fairly
 * means normalizing to the same unit first.
 */

export type SizeKind = "lb" | "floz" | "count" | "gal";
export type Size = { kind: SizeKind; qty: number };

const num = (s: string) => Number(s.replace(/,/g, ""));

/** Pack multiplier: "6 pack", "pack of 6", "6-pk", "case of 6", "6 x 32 oz", "4 × 1 gal". */
function packCount(t: string): number {
  const m =
    /(\d+)\s*[x×]\s*\d/.exec(t) ??
    /(?:pack|case|box)\s+of\s+(\d+)/.exec(t) ??
    /(\d+)\s*-?\s*(?:pack|pk)\b/.exec(t);
  return m ? num(m[1]) : 1;
}

export function parseSize(title: string): Size | null {
  const t = title.toLowerCase().replace(/fluid ounces?/g, "fl oz");

  const gal = /(\d+(?:\.\d+)?)\s*(?:gal|gallons?)\b/.exec(t);
  if (gal) return { kind: "gal", qty: num(gal[1]) * packCount(t) };

  const lb = /(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)\b/.exec(t);
  if (lb) return { kind: "lb", qty: num(lb[1]) * packCount(t) };

  const flOz = /(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz|oz)\b/.exec(t);
  const count = /(\d[\d,]*)\s*(?:ct|count|pcs|pieces|sleeves?)\b/.exec(t);

  if (count && (!flOz || /cups?|lids?|napkins?|sleeves?/.test(t)))
    return { kind: "count", qty: num(count[1]) };
  if (flOz) return { kind: "floz", qty: num(flOz[1]) * packCount(t) };
  return null;
}

/** Converts a parsed size into the target kind when it makes sense (oz of coffee → lb). */
export function toKind(size: Size, kind: SizeKind): number | null {
  if (size.kind === kind) return size.qty;
  if (kind === "lb" && size.kind === "floz") return size.qty / 16; // net weight in oz
  return null;
}
