import 'server-only';
import { getServerLocale } from './i18n/server';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** Server-side fetch for public catalog data (SSR), in the request language. */
export async function serverGet<T = any>(path: string, revalidate = 30): Promise<T | null> {
  try {
    const locale = await getServerLocale();
    const res = await fetch(`${API}/api${path}`, { next: { revalidate }, headers: { 'x-locale': locale } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
