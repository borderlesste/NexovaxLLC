import { NextResponse, type NextRequest } from 'next/server';
import { isIP } from 'node:net';

/**
 * Forwards the visitor's real IP to the NestJS API (proxied under /api) so rate limits
 * apply per visitor, in the API and in Supabase Auth, instead of to this web server.
 *
 * - The visitor IP is read only from the header your edge sets (CLIENT_IP_HEADER):
 *   `cf-connecting-ip` behind Cloudflare, `x-real-ip` on Vercel or behind nginx.
 *   Any value a browser sends itself is discarded, so it can't be forged.
 * - The API trusts it only together with PROXY_SHARED_SECRET (same value on both servers).
 */
export const config = { matcher: '/api/:path*', runtime: 'nodejs' };

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

export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.delete(FORWARD_SECRET);
  headers.delete(FORWARD_IP);
  const secret = process.env.PROXY_SHARED_SECRET?.trim();
  const ip = visitorIp(req);
  if (secret && ip) {
    headers.set(FORWARD_SECRET, secret);
    headers.set(FORWARD_IP, ip);
  }
  return NextResponse.next({ request: { headers } });
}
