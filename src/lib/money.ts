/**
 * Money helpers. Amounts travel as decimal strings ("84.00"), the same shape PayPal uses,
 * and all arithmetic happens in integer cents to avoid floating point drift.
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

export function toCents(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${value}`);
    return Math.round(value * 100);
  }
  const m = DECIMAL.exec(value.trim());
  if (!m) throw new Error(`Invalid amount: "${value}"`);
  const [, sign, whole, frac = ""] = m;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return sign ? -cents : cents;
}

export function fromCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error(`Cents must be an integer: ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Normalizes any amount to a 2-decimal string. */
export function normalizeAmount(value: string | number): string {
  return fromCents(toCents(value));
}

export function sumAmounts(values: (string | number)[]): string {
  return fromCents(values.reduce<number>((acc, v) => acc + toCents(v), 0));
}

export function multiplyAmount(unitPrice: string | number, quantity: number): string {
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`Invalid quantity: ${quantity}`);
  return fromCents(toCents(unitPrice) * quantity);
}
