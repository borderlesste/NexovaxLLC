/**
 * Google Merchant Center product feed, served on the site's own domain (the URL to register in
 * Merchant Center → Products → Feeds). Built by the API from Admin → Configuración → Google.
 */
export const revalidate = 900;

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

export async function GET() {
  try {
    const res = await fetch(`${API}/api/feeds/google-merchant.xml`, { next: { revalidate: 900 }, signal: AbortSignal.timeout(60_000) });
    if (res.status === 404) return new Response('Feed desactivado.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (!res.ok) return new Response('Feed no disponible.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '600' } });
    return new Response(await res.text(), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=900, s-maxage=900' } });
  } catch {
    return new Response('Feed no disponible.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '600' } });
  }
}
