/**
 * Exact money arithmetic in minor units (centavos) using BigInt.
 * PostgreSQL NUMERIC values arrive as strings and are converted without floats.
 */
export type Minor = bigint;

export function toMinor(v: string | number | null | undefined, decimals = 2): Minor {
  if (v === null || v === undefined || v === '') return 0n;
  const s = typeof v === 'number' ? v.toFixed(decimals + 2) : String(v).trim();
  const neg = s.startsWith('-');
  const [intPart, fracRaw = ''] = (neg ? s.slice(1) : s).split('.');
  const frac = (fracRaw + '0'.repeat(decimals + 1)).slice(0, decimals + 1);
  let minor = BigInt(intPart || '0') * 10n ** BigInt(decimals) + BigInt(frac.slice(0, decimals) || '0');
  // half-up on the next digit
  if (Number(frac[decimals] ?? '0') >= 5) minor += 1n;
  return neg ? -minor : minor;
}

export function fromMinor(m: Minor, decimals = 2): string {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const base = 10n ** BigInt(decimals);
  const int = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0');
  return `${neg ? '-' : ''}${int}.${frac}`;
}

/** rate is a decimal string like "0.10"; returns ROUND_HALF_UP(amount * rate). */
export function applyRate(amount: Minor, rate: string | number): Minor {
  const r = String(rate);
  const [i, f = ''] = r.split('.');
  const scale = 10n ** BigInt(f.length);
  const rateScaled = BigInt(i || '0') * scale + BigInt(f || '0');
  const num = amount * rateScaled;
  const q = num / scale;
  const rem = num % scale;
  return rem * 2n >= scale ? q + 1n : q;
}

/** Splits `total` across `weights` proportionally (largest remainder), exact sum. */
export function allocate(total: Minor, weights: Minor[]): Minor[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return weights.map((_, i) => (i === 0 ? total : 0n));
  const base = weights.map((w) => (total * w) / sum);
  let rest = total - base.reduce((a, b) => a + b, 0n);
  const order = weights
    .map((w, i) => ({ i, rem: (total * w) % sum }))
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  for (const o of order) {
    if (rest <= 0n) break;
    base[o.i] += 1n;
    rest -= 1n;
  }
  return base;
}

export const money = (v: string | number | null | undefined) => fromMinor(toMinor(v));
