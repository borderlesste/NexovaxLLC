'use client';
import { analyticsAllowed } from './consent';

/**
 * Google Analytics 4 (Admin → Configuración → Google). gtag.js is loaded only after the visitor
 * accepts analytics cookies, with Consent Mode: analytics granted, advertising always denied
 * (no ad cookies, no ad personalization). Events fired before it loads are queued and sent once
 * it is ready; without consent or with GA4 off they are dropped.
 */
export type GaItem = { item_id: string; item_name: string; price?: number; quantity?: number; item_brand?: string; item_category?: string; item_variant?: string; affiliation?: string };

type Gtag = (...args: any[]) => void;
declare global {
  interface Window { dataLayer?: any[]; gtag?: Gtag }
}

let measurementId: string | null = null;
let ready = false;
let configured: boolean | null = null; // null: config not known yet
const pending: Array<[string, Record<string, any>]> = [];

/** Standard gtag shim: gtag.js reads the arguments objects pushed to dataLayer. */
const gtag: Gtag = function () {
  window.dataLayer = window.dataLayer || [];
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
};

function load(id: string) {
  if (ready && measurementId === id) return;
  measurementId = id;
  window.gtag = gtag;
  gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  gtag('js', new Date());
  gtag('config', id, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
  if (!document.querySelector(`script[data-ga4="${id}"]`)) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    s.dataset.ga4 = id;
    document.head.appendChild(s);
  }
  ready = true;
  while (pending.length) {
    const [name, params] = pending.shift()!;
    gtag('event', name, params);
  }
}

/** Removes the GA cookies of this site (after the visitor withdraws consent). */
function clearCookies() {
  try {
    const host = location.hostname;
    const domains = ['', host, '.' + host, '.' + host.split('.').slice(-2).join('.')];
    for (const c of document.cookie.split(';')) {
      const name = c.split('=')[0].trim();
      if (name === '_ga' || name.startsWith('_ga_') || name === '_gid') for (const d of domains) document.cookie = `${name}=; Max-Age=0; Path=/${d ? `; Domain=${d}` : ''}`;
    }
  } catch {
    /* ignore */
  }
}

/** Applies the public config and the current consent: loads, keeps or stops GA4. */
export function syncGa(id: string | null | undefined) {
  configured = !!id;
  if (!id) {
    pending.length = 0;
    return;
  }
  if (analyticsAllowed()) load(id);
  else {
    pending.length = 0;
    if (ready) {
      gtag('consent', 'update', { analytics_storage: 'denied' });
      ready = false;
    }
    clearCookies();
  }
}

/** Sends a GA4 event (queued until gtag.js is ready). */
export function gaEvent(name: string, params: Record<string, any>) {
  if (typeof window === 'undefined' || configured === false || !analyticsAllowed()) return;
  if (ready) gtag('event', name, params);
  else if (pending.length < 50) pending.push([name, params]);
}

const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
const total = (items: GaItem[]) => Math.round(items.reduce((a, i) => a + (i.price ?? 0) * (i.quantity ?? 1), 0) * 100) / 100;

export const ga = {
  viewItem(currency: string, item: GaItem) {
    gaEvent('view_item', { currency, value: item.price ?? 0, items: [item] });
  },
  addToCart(currency: string, item: GaItem) {
    gaEvent('add_to_cart', { currency, value: total([item]), items: [item] });
  },
  beginCheckout(currency: string, items: GaItem[], value?: number) {
    gaEvent('begin_checkout', { currency, value: value ?? total(items), items });
  },
  /** Sent once per order and browser. */
  purchase(transactionId: string, currency: string, value: number, items: GaItem[] = []) {
    const key = `nx.ga.tx.${transactionId}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {
      /* storage unavailable: send it anyway */
    }
    gaEvent('purchase', { transaction_id: transactionId, currency, value, items });
  },
  num,
};
