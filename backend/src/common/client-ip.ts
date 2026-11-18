import { AsyncLocalStorage } from 'node:async_hooks';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { config } from '../config';

/**
 * Real end-user IP, used for rate limiting (our throttler and Supabase Auth).
 *
 * The browser reaches the API through the Next.js /api proxy, so the socket address is
 * the web server's. The web middleware forwards the visitor's IP in `x-nx-client-ip`
 * together with a shared secret (`x-nx-proxy-secret`); any other forwarded header is
 * ignored, because a client could forge it.
 */
export const PROXY_SECRET_HEADER = 'x-nx-proxy-secret';
export const CLIENT_IP_HEADER = 'x-nx-client-ip';

export interface ClientIp {
  ip: string;
  /** True when the IP is the visitor's (signed by our web proxy, or a public socket address). */
  trusted: boolean;
}

const requestContext = new AsyncLocalStorage<ClientIp>();
export const currentClientIp = () => requestContext.getStore();

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function isPrivate(ip: string) {
  const v = ip.replace(/^::ffff:/, '');
  return (
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(v) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v) ||
    v === '::1' || v === '::' || /^f[cd][0-9a-f]{2}:/i.test(v) || /^fe[89ab][0-9a-f]:/i.test(v)
  );
}

export function resolveClientIp(req: any): ClientIp {
  const header = (name: string) => {
    const v = req.headers?.[name];
    return (Array.isArray(v) ? v[0] : v)?.trim() as string | undefined;
  };
  const secret = config.proxySharedSecret;
  const sent = header(PROXY_SECRET_HEADER);
  if (secret && sent && sameSecret(sent, secret)) {
    const ip = header(CLIENT_IP_HEADER)?.replace(/^::ffff:/, '');
    if (ip && isIP(ip)) return { ip, trusted: true };
  }
  const socket = String(req.socket?.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
  return { ip: socket, trusted: isIP(socket) > 0 && !isPrivate(socket) };
}

/** Express middleware: resolves the client IP once per request and keeps it for the request's lifetime. */
export function clientIpMiddleware(req: any, _res: unknown, next: () => void) {
  const c = resolveClientIp(req);
  req.clientIp = c.ip;
  requestContext.run(c, next);
}

/** Throttler keyed by the visitor's IP instead of the web proxy's (which every visitor shares). */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.clientIp ?? resolveClientIp(req).ip;
  }
}
