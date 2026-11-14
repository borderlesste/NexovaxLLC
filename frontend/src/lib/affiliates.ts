import { post } from './api';

const KEY = 'nx.ref';
const MAX_AGE = 90 * 86400_000;

/** Public link an affiliate shares (store page or product page). */
export const affiliateUrl = (path: string, code: string) =>
  `${typeof window !== 'undefined' ? window.location.origin : ''}${path}${path.includes('?') ? '&' : '?'}ref=${code}`;

type Stored = { code: string; at: number }[];
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

/** Remembers a ?ref= code from the URL until the visitor is signed in. */
export function rememberRef() {
  if (typeof window === 'undefined') return;
  const code = new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase();
  if (!code || !/^[A-Z0-9]{6,16}$/.test(code)) return;
  write([...read().filter((x) => x.code !== code), { code, at: Date.now() }]);
}

/** Sends remembered codes for the signed-in buyer (last link wins per store). */
export async function flushRefs() {
  const codes = read().map((x) => x.code);
  if (!codes.length) return;
  try {
    await post('/affiliates/track', { codes });
    write([]);
  } catch {
    /* keep them for the next attempt */
  }
}
