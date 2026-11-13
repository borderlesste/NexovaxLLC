'use client';
import { intlLocale, isLocale, Locale, LOCALE_COOKIE, translate } from './core';

export type { Locale } from './core';
export { LOCALES, isLocale } from './core';

/**
 * Current UI language and marketplace currency for client rendering.
 * Set once by <Providers> from the server-resolved values; changing the
 * language stores a cookie (and the user's preference) and reloads.
 */
let current: Locale = 'es';
let currency = 'USD';

export function configureI18n(locale: Locale, defaultCurrency: string) {
  current = locale;
  currency = defaultCurrency || 'USD';
}

export const getLocale = () => current;
export const getCurrency = () => currency;
export const getIntlLocale = () => intlLocale(current);

/** Translates a Spanish UI string to the current language. */
export function t(es: string, vars?: Record<string, string | number | null | undefined>) {
  return translate(current, es, vars);
}

export async function switchLocale(next: Locale, persist?: (l: Locale) => Promise<unknown>) {
  if (!isLocale(next)) return;
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  try {
    await persist?.(next);
  } catch {
    /* preference is also kept in the cookie */
  }
  window.location.reload();
}

/** Localized country name for an ISO 3166-1 alpha-2 code. */
export function countryName(code?: string | null) {
  if (!code) return '';
  try {
    return new Intl.DisplayNames([current], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
