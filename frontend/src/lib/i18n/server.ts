import 'server-only';
import { cookies, headers } from 'next/headers';
import { hasTranslation, isLocale, Locale, LOCALE_COOKIE, translate } from './core';

/** Request locale: cookie → Accept-Language → Spanish. */
export async function getServerLocale(): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(c)) return c;
  const al = (await headers()).get('accept-language') ?? '';
  return /^ht\b/i.test(al) ? 'ht' : /^fr\b/i.test(al) ? 'fr' : /^en\b/i.test(al) ? 'en' : 'es';
}

export async function getT() {
  const l = await getServerLocale();
  return (es: string, vars?: Record<string, string | number | null | undefined>) => translate(l, es, vars);
}

/** Server-side check: does the request language have its own translation of this text? */
export async function getHas() {
  const l = await getServerLocale();
  return (es: string) => hasTranslation(l, es);
}
