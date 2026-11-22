import { NextResponse, type NextRequest } from 'next/server';
import { isIP } from 'node:net';
import { buildCsp } from '@/lib/csp';

/**
 * Forwards the visitor's real IP to the NestJS API (proxied under /api) so rate limits
 * apply per visitor, in the API and in Supabase Auth, instead of to this web server.
 *
 * - The visitor IP is read only from the header your edge sets (CLIENT_IP_HEADER):
 *   `cf-connecting-ip` behind Cloudflare, `x-real-ip` on Vercel or behind nginx.
 *   Any value a browser sends itself is discarded, so it can't be forged.
 * - The API trusts it only together with PROXY_SHARED_SECRET (same value on both servers).
 */
export const config = {
  // API calls (visitor IP) and pages (current path for the canonical link); not static files.
  matcher: ['/api/:path*', '/((?!_next/|favicon|icon|apple-icon|.*\\.(?:png|jpg|jpeg|webp|svg|ico|txt|xml|webmanifest)$).*)'],
  runtime: 'nodejs',
};

const FORWARD_SECRET = 'x-nx-proxy-secret';
const FORWARD_IP = 'x-nx-client-ip';

function visitorIp(req: NextRequest): string | null {
  const name = (process.env.CLIENT_IP_HEADER ?? (process.env.VERCEL ? 'x-real-ip' : '')).trim().toLowerCase();
  if (!name) return null;
  const raw = req.headers.get(name);
  // x-forwarded-for: the edge appends the address it saw; with one trusted edge, that's the last entry.
  const value = name === 'x-forwarded-for' ? raw?.split(',').pop() : raw;
  const ip = value?.trim().replace(/^::ffff:/, '');
  return ip && isIP(ip) ? ip : null;
}

/**
 * Country the edge estimated from the visitor's IP (NX-GEO-001), forwarded to the API to suggest a
 * delivery destination. Read only from the header your edge sets (GEO_COUNTRY_HEADER):
 * `x-vercel-ip-country` on Vercel (default there), `cf-ipcountry` behind Cloudflare. Only the
 * two-letter code travels; the API trusts it only with PROXY_SHARED_SECRET.
 */
const FORWARD_COUNTRY = 'x-nx-ip-country';

function visitorCountry(req: NextRequest): string | null {
  const name = (process.env.GEO_COUNTRY_HEADER ?? (process.env.VERCEL ? 'x-vercel-ip-country' : '')).trim().toLowerCase();
  if (!name) return null;
  const v = req.headers.get(name)?.trim().toUpperCase();
  return v && /^[A-Z]{2}$/.test(v) ? v : null;
}

const PATHNAME = 'x-nx-pathname';

export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  if (!req.nextUrl.pathname.startsWith('/api/')) {
    headers.set(PATHNAME, req.nextUrl.pathname);
    // A fresh nonce per page: Next.js reads it from the request's CSP header and puts it on its scripts.
    const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
    const csp = buildCsp(nonce);
    headers.set('x-nonce', nonce);
    headers.set('Content-Security-Policy', csp);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set('Content-Security-Policy', csp);
    return res;
  }
  headers.delete(FORWARD_SECRET);
  headers.delete(FORWARD_IP);
  headers.delete(FORWARD_COUNTRY);
  const secret = process.env.PROXY_SHARED_SECRET?.trim();
  const ip = visitorIp(req);
  const country = visitorCountry(req);
  if (secret && (ip || country)) headers.set(FORWARD_SECRET, secret);
  if (secret && ip) headers.set(FORWARD_IP, ip);
  if (secret && country) headers.set(FORWARD_COUNTRY, country);
  return NextResponse.next({ request: { headers } });
}
