import { DICTS, DICT_VERSION } from '@/lib/i18n/dicts';
import type { Locale } from '@/lib/i18n/core';

/**
 * The current language's UI strings as a tiny script (`self.__NX_I18N = {...}`), loaded by the root layout
 * before hydration. One file per language with its content hash in the name: built once, cached for a year.
 */
export const dynamic = 'force-static';
export const dynamicParams = false;

const LANGS: Locale[] = ['en', 'fr', 'ht'];

export function generateStaticParams() {
  return LANGS.map((l) => ({ file: `${l}.${DICT_VERSION[l]}.js` }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const l = LANGS.find((x) => file === `${x}.${DICT_VERSION[x]}.js`);
  if (!l) return new Response('Not found', { status: 404 });
  return new Response(`self.__NX_I18N=${JSON.stringify(DICTS[l])};`, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
