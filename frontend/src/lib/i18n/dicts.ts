import { createHash } from 'node:crypto';
import { en } from './en';
import { frDict } from './fr';
import { htDict } from './ht';
import type { Dict, Locale } from './core';

/** Fallback order per language (Spanish is the source and needs none). */
const CHAIN: Record<Exclude<Locale, 'es'>, Record<string, string>[]> = { en: [en], fr: [frDict, en], ht: [htDict, frDict, en] };

function build(chain: Record<string, string>[]): Dict {
  const [own, ...rest] = chain;
  const extra: Record<string, string> = {};
  for (const d of rest) for (const [k, v] of Object.entries(d)) if (own[k] === undefined && extra[k] === undefined) extra[k] = v;
  return { own, extra };
}

/** Every language's dictionary. Server only: the browser gets just its own through /i18n/<locale>.<version>.js. */
export const DICTS: Record<Locale, Dict> = { es: { own: {}, extra: {} }, en: build(CHAIN.en), fr: build(CHAIN.fr), ht: build(CHAIN.ht) };

/** Content hash per language, so the browser can cache each file for a year and refetch only when it changes. */
export const DICT_VERSION: Record<Locale, string> = Object.fromEntries(
  (Object.keys(DICTS) as Locale[]).map((l) => [l, createHash('sha256').update(JSON.stringify(DICTS[l])).digest('hex').slice(0, 12)]),
) as Record<Locale, string>;

export const dictScriptPath = (l: Locale) => `/i18n/${l}.${DICT_VERSION[l]}.js`;

// Client components rendered on the server read the dictionaries from here (see index.ts).
(globalThis as { __NX_I18N_ALL?: Record<Locale, Dict> }).__NX_I18N_ALL = DICTS;
