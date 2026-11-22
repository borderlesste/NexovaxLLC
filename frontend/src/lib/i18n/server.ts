import 'server-only';
import { cookies, headers } from 'next/headers';
import { hasTranslation, isLocale, Locale, LOCALE_COOKIE, translate } from './core';
import { DICTS } from './dicts';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** Marketplace default language ("Idioma predeterminado" in Configuración), cached a minute. */
async function marketplaceLocale(): Promise<Locale> {
  try {
    const r = await fetch(`${API}/api/config/public`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(5000) });
    const l = r.ok ? (await r.json())?.locale : null;
    return isLocale(l) ? l : 'es';
  } catch {
    return 'es';
  }
}

/** Request locale: the visitor's choice (cookie) → their browser language if we have it → the marketplace default. */
export async function getServerLocale(): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(c)) return c;
  const al = (await headers()).get('accept-language') ?? '';
  const first = /^\s*([a-z]{2})/i.exec(al)?.[1]?.toLowerCase();
  if (isLocale(first)) return first;
  return marketplaceLocale();
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
