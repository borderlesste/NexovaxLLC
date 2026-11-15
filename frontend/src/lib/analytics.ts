'use client';
import { supabase } from './supabase';
import { analyticsAllowed, visitorId } from './consent';

const PREV = 'nx.nav.prev';
const SEEN = 'nx.viewed';

/** Remembers the previous in-site path (to tell where a product view came from). */
export function rememberPath(path: string, search: string) {
  try {
    const cur = sessionStorage.getItem('nx.nav.cur');
    if (cur && cur !== path + search) sessionStorage.setItem(PREV, cur);
    sessionStorage.setItem('nx.nav.cur', path + search);
  } catch {
    /* storage unavailable */
  }
}

function source(): string {
  if (new URLSearchParams(window.location.search).has('ref')) return 'AFFILIATE';
  let prev = '';
  try {
    prev = sessionStorage.getItem(PREV) ?? '';
  } catch {
    /* ignore */
  }
  if (prev) {
    if (prev === '/' || prev.startsWith('/?')) return 'HOME';
    if (prev.startsWith('/catalogo')) return /[?&](q|search)=/.test(prev) ? 'SEARCH' : 'CATALOG';
    if (prev.startsWith('/tienda/')) return 'STORE';
    if (prev.startsWith('/producto/')) return 'PRODUCT';
  }
  const ref = document.referrer;
  if (ref && !ref.startsWith(window.location.origin)) return /google|bing|yahoo|duckduckgo|yandex/i.test(ref) ? 'SEARCH' : 'EXTERNAL';
  return 'DIRECT';
}

/**
 * Sends one product view when the visitor leaves the product page, with the time spent.
 * Without analytics consent it is anonymous and counted once per browser session.
 */
export function trackProductView(productId: string) {
  const start = Date.now();
  const src = source();
  let sent = false;
  const send = async () => {
    if (sent) return;
    sent = true;
    const dwellMs = Date.now() - start;
    if (dwellMs < 1000) return;
    const consent = analyticsAllowed();
    if (!consent) {
      try {
        const seen: string[] = JSON.parse(sessionStorage.getItem(SEEN) ?? '[]');
        if (seen.includes(productId)) return;
        sessionStorage.setItem(SEEN, JSON.stringify([...seen, productId].slice(-200)));
      } catch {
        /* ignore */
      }
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (consent) headers['x-nx-consent'] = 'analytics';
    try {
      const { data } = await supabase().auth.getSession();
      if (data.session?.access_token) headers.authorization = `Bearer ${data.session.access_token}`;
    } catch {
      /* anonymous */
    }
    fetch('/api/events', {
      method: 'POST', keepalive: true, headers,
      body: JSON.stringify({ events: [{ type: 'VIEW', productId, dwellMs: Math.min(dwellMs, 3600000), source: src }], ...(consent ? { visitorId: visitorId() } : {}) }),
    }).catch(() => undefined);
  };
  const onHide = () => document.visibilityState === 'hidden' && void send();
  window.addEventListener('pagehide', send);
  document.addEventListener('visibilitychange', onHide);
  return () => {
    window.removeEventListener('pagehide', send);
    document.removeEventListener('visibilitychange', onHide);
    void send();
  };
}
