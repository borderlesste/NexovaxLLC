import 'server-only';
import { cookies, headers } from 'next/headers';
import { isLocale, Locale, LOCALE_COOKIE, translate } from './core';

/** Request locale: cookie → Accept-Language → Spanish. */
export async function getServerLocale(): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(c)) return c;
  const al = (await headers()).get('accept-language') ?? '';
  return /^en\b/i.test(al) ? 'en' : 'es';
}

export async function getT() {
  const l = await getServerLocale();
  return (es: string, vars?: Record<string, string | number | null | undefined>) => translate(l, es, vars);
}
