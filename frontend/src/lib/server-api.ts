import 'server-only';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** Server-side fetch for public catalog data (SSR). */
export async function serverGet<T = any>(path: string, revalidate = 30): Promise<T | null> {
  try {
    const res = await fetch(`${API}/api${path}`, { next: { revalidate } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
