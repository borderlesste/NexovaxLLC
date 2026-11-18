/**
 * Bounded pagination. OFFSET makes PostgreSQL walk every skipped row, so a request like
 * `?page=1000000` would be an expensive query anyone can repeat: pages are capped
 * (MAX_PAGE) and non-numeric input falls back to the first page instead of a 500.
 */
export const MAX_PAGE = 200;

const int = (v: unknown) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : NaN;
};

export function clampPage(v: unknown): number {
  const n = int(v);
  return Number.isNaN(n) ? 1 : Math.min(Math.max(n, 1), MAX_PAGE);
}

export function clampPageSize(v: unknown, fallback: number, max: number): number {
  const n = int(v);
  return Number.isNaN(n) ? fallback : Math.min(Math.max(n, 1), max);
}
