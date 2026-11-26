import 'server-only';
import { cookies, headers } from 'next/headers';
import { hasTranslation, isLocale, Locale, LOCALE_COOKIE, translate } from './core';
import { DICTS } from './dicts';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * Marketplace default language ("Idioma predeterminado") and whether a first visit may follow the browser
 * language ("Idioma del navegador"), both from Admin → Configuración → General, cached a minute.
 */
async function marketplaceLanguage(): Promise<{ locale: Locale; browserLanguage: boolean }> {
  try {
    const r = await fetch(`${API}/api/config/public`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(5000) });
    const c = r.ok ? await r.json() : null;
    return { locale: isLocale(c?.locale) ? c.locale : 'es', browserLanguage: c?.browserLanguage !== false };
  } catch {
    return { locale: 'es', browserLanguage: false };
  }
}

/** Search engines and link-preview bots always get the marketplace default, so indexed pages don't vary. */
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse|headless|bingpreview|mediapartners|adsbot/i;

/**
 * Best supported language in an Accept-Language header (RFC 9110): entries in order of their q weight,
 * each matched by its primary subtag (es-DO → es, fr-CA → fr, ht-HT → ht). Null when none is supported.
 */
export function pickAcceptLanguage(header: string): Locale | null {
  const ranked = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(p)?.[1]).find(Boolean);
      return { lang: tag.trim().toLowerCase().split('-')[0], q: q == null ? 1 : Number(q), i };
    })
    .filter((x) => x.lang && x.q > 0 && !Number.isNaN(x.q))
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const x of ranked) if (isLocale(x.lang)) return x.lang;
  return null;
}

/**
 * Request locale: the visitor's explicit choice (cookie, also set from their account preference after
 * sign-in) → on a first visit, their browser language when it is supported and the admin allows it →
 * the marketplace default. Detection never writes the cookie: only the language selector does.
 */
export async function getServerLocale(): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(c)) return c;
  const m = await marketplaceLanguage();
  if (!m.browserLanguage) return m.locale;
  const h = await headers();
  if (BOT.test(h.get('user-agent') ?? '')) return m.locale;
  return pickAcceptLanguage(h.get('accept-language') ?? '') ?? m.locale;
}

export async function getT() {
  const l = await getServerLocale();
  return (es: string, vars?: Record<string, string | number | null | undefined>) => translate(l, es, vars, DICTS[l]);
}

/** Server-side check: does the request language have its own translation of this text? */
export async function getHas() {
  const l = await getServerLocale();
  return (es: string) => hasTranslation(l, es, DICTS[l]);
}
