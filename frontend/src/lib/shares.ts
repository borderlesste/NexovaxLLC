import { post } from './api';

const KEY = 'nx.share';
const SEEN = 'nx.share.seen';
const MAX_AGE = 30 * 86400_000;

/** Public URL of a shared product link (optionally with the store affiliate code). */
export const shareUrl = (slug: string, code?: string | null, ref?: string | null) => {
  const qs = new URLSearchParams();
  if (code) qs.set('s', code);
  if (ref) qs.set('ref', ref);
  const q = qs.toString();
  return `${typeof window !== 'undefined' ? window.location.origin : ''}/producto/${slug}${q ? `?${q}` : ''}`;
};

type Stored = { code: string; slug?: string; at: number }[];
const read = (): Stored => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.code === 'string' && Date.now() - x.at < MAX_AGE) : [];
  } catch {
    return [];
  }
};
const write = (v: Stored) => {
  try {
    if (v.length) localStorage.setItem(KEY, JSON.stringify(v.slice(-10)));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
};

/** Captures a ?s= shared-link code: counts the visit once per browser session and keeps it until sign-in. */
export function rememberShare() {
  if (typeof window === 'undefined') return;
  const code = new URLSearchParams(window.location.search).get('s')?.trim().toUpperCase();
  if (!code || !/^[A-Z0-9]{6,16}$/.test(code)) return;
  // A code only counts on the product page it was made for (the API checks the pair).
  const slug = /^\/producto\/([a-z0-9-]{1,200})\/?$/.exec(window.location.pathname)?.[1];
  if (!slug) return;
  write([...read().filter((x) => x.code !== code), { code, slug, at: Date.now() }]);
  try {
    const seen: string[] = JSON.parse(sessionStorage.getItem(SEEN) ?? '[]');
    if (seen.includes(code)) return;
    sessionStorage.setItem(SEEN, JSON.stringify([...seen, code].slice(-20)));
  } catch {
    /* storage unavailable: count anyway */
  }
  void post('/shares/visit', { code }).catch(() => undefined);
}

/** Tells the API that the signed-in buyer arrived through the remembered shared links. */
export async function flushShares() {
  const codes = read().filter((x) => x.slug).map((x) => `${x.code}@${x.slug}`);
  if (!codes.length) return;
  try {
    await post('/shares/track', { codes });
    write([]);
  } catch {
    /* keep them for the next attempt */
  }
}
