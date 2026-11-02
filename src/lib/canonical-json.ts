/**
 * Canonical JSON in the spirit of RFC 8785 (JCS): object keys sorted by UTF-16 code units,
 * no whitespace, ECMAScript number/string serialization, `undefined` members dropped.
 * The same value always serializes to the same bytes, which is what hashing and signing need.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot encode non-finite numbers");
      return JSON.stringify(value);
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value))
        return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
      if (value instanceof Date) return JSON.stringify(value.toISOString());
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
    }
    default:
      throw new Error(`Canonical JSON cannot encode ${typeof value}`);
  }
}
