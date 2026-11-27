/**
 * Removes secrets from Sentry events: query strings and fragments (recovery `token_hash`, webhook
 * tokens, codes) are dropped from the request URL and every breadcrumb URL; sensitive headers too.
 */
const stripUrl = (u: unknown) => (typeof u === 'string' ? u.replace(/[?#].*$/, '') : u);

export function scrubSentryEvent<T extends Record<string, any>>(event: T): T {
  const e: any = event;
  if (e.user) delete e.user.ip_address;
  if (e.request) {
    e.request.url = stripUrl(e.request.url);
    delete e.request.query_string;
    delete e.request.cookies;
    delete e.request.data;
    if (e.request.headers)
      for (const h of Object.keys(e.request.headers))
        if (/cookie|authorization|token|secret|forwarded|real-ip|client-ip|connecting-ip|referer/i.test(h)) delete e.request.headers[h];
  }
  for (const b of e.breadcrumbs?.values ?? e.breadcrumbs ?? []) {
    if (b?.data) for (const k of ['url', 'from', 'to']) if (k in b.data) b.data[k] = stripUrl(b.data[k]);
  }
  if (e.transaction) e.transaction = stripUrl(e.transaction);
  return event;
}
