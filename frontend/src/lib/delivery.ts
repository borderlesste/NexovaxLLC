'use client';
import { useCallback, useEffect } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, put } from './api';
import { useAuth } from './auth';

/** Functional cookie with the visitor's explicit destination (independent of nx_locale). */
export const DELIVERY_COOKIE = 'nx_delivery_country';

export interface DeliveryContext {
  detectedCountry: string | null;
  deliveryCountry: string;
  source: 'manual' | 'account' | 'ip' | 'default';
  isApproximate: boolean;
  /** Destinations offered by the marketplace; empty = every country. */
  countries: string[];
  showSelector: boolean;
}

/** Set when the visitor picks a destination while signed out: that choice is pushed to the account on sign-in. */
const PENDING_KEY = 'nx_delivery_pending';

const cookieCountry = () => {
  if (typeof document === 'undefined') return null;
  const v = document.cookie.split('; ').find((c) => c.startsWith(`${DELIVERY_COOKIE}=`))?.split('=')[1];
  return v && /^[A-Z]{2}$/.test(v) ? v : null;
};
const writeCookie = (cc: string) => {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${DELIVERY_COOKIE}=${cc}; path=/; max-age=31536000; samesite=lax${secure}`;
};
const pendingFlag = {
  get: () => { try { return localStorage.getItem(PENDING_KEY) === '1'; } catch { return false; } },
  set: (on: boolean) => { try { if (on) localStorage.setItem(PENDING_KEY, '1'); else localStorage.removeItem(PENDING_KEY); } catch { /* storage blocked */ } },
};

let syncedFor: string | null = null;

/**
 * Browsing destination (NX-GEO-001): explicit choice > account preference > IP country > default,
 * resolved by the API. It guides browsing only; checkout validates the confirmed address.
 */
export function useDelivery() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery<DeliveryContext>({ queryKey: ['geo-context', me?.id ?? null], queryFn: () => get('/geo/context'), staleTime: 10 * 60_000 });

  // On sign-in the browser and the account end up with the same destination (NX-GEO-001):
  // - a choice made while signed out is the most recent explicit choice: it becomes the account's;
  // - otherwise the account's preference (possibly changed on another device) replaces this browser's cookie.
  // Once per account and page load (many components use this hook).
  useEffect(() => {
    if (!me || !q.data || syncedFor === me.id) return;
    syncedFor = me.id;
    const browser = cookieCountry();
    const account = me.deliveryCountry ?? null;
    if (browser && pendingFlag.get()) {
      pendingFlag.set(false);
      if (browser !== account)
        put('/me/delivery-country', { country: browser })
          .then(() => qc.invalidateQueries({ queryKey: ['me'] }))
          .catch(() => undefined);
    } else if (account && browser && browser !== account) {
      writeCookie(account);
      qc.invalidateQueries({ queryKey: ['geo-context'] });
    }
  }, [me, q.data, qc]);

  const setCountry = useCallback(
    async (code: string) => {
      const cc = code.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(cc)) return;
      writeCookie(cc);
      pendingFlag.set(!me);
      if (me) await put('/me/delivery-country', { country: cc }).catch(() => undefined);
      await qc.invalidateQueries({ queryKey: ['geo-context'] });
      if (me) qc.invalidateQueries({ queryKey: ['me'] });
    },
    [me, qc],
  );

  return { context: q.data, loading: q.isLoading, setCountry };
}

// ------------------------------------------------------------------ availability by destination

export type AvailabilityStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'UNCONFIRMED';
export interface Availability {
  status: AvailabilityStatus;
  reason: string;
  /** Country the store ships from. */
  shipsFrom: string | null;
}

/**
 * Batches the availability lookups of every card on screen into one request per destination
 * (up to 100 products and 100 variants), so a catalog page costs one call instead of one per product.
 * With a variant, the answer is the variant's (it ships from the warehouse that stocks it).
 */
type Batch = { ids: Set<string>; vids: Set<string>; waiters: Map<string, ((a: Availability | null) => void)[]>; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, Batch>();
async function flush(country: string, batch: Batch) {
  const ids = [...batch.ids];
  const vids = [...batch.vids];
  for (let i = 0; i < Math.max(ids.length, vids.length); i += 100) {
    const chunk = ids.slice(i, i + 100);
    const vchunk = vids.slice(i, i + 100);
    let r: { items?: Record<string, Availability>; variants?: Record<string, Availability> } = {};
    try {
      r = await post('/geo/availability', { country, productIds: chunk, ...(vchunk.length ? { variantIds: vchunk } : {}) });
    } catch {
      /* unknown: show nothing rather than a wrong state */
    }
    for (const pid of chunk) for (const w of batch.waiters.get(`p:${pid}`) ?? []) w(r.items?.[pid] ?? null);
    for (const vid of vchunk) for (const w of batch.waiters.get(`v:${vid}`) ?? []) w(r.variants?.[vid] ?? null);
  }
}
function loadAvailability(country: string, id: string, variantId?: string | null): Promise<Availability | null> {
  return new Promise((resolve) => {
    let b = pending.get(country);
    if (!b) {
      const batch: Batch = {
        ids: new Set(),
        vids: new Set(),
        waiters: new Map(),
        timer: setTimeout(() => {
          pending.delete(country);
          void flush(country, batch);
        }, 25),
      };
      b = batch;
      pending.set(country, b);
    }
    const key = variantId ? `v:${variantId}` : `p:${id}`;
    if (variantId) b.vids.add(variantId);
    else b.ids.add(id);
    b.waiters.set(key, [...(b.waiters.get(key) ?? []), resolve]);
  });
}

/** Availability of one product (or of its selected variant) for the current browsing destination (null while unknown). */
export function useAvailability(productId?: string | null, variantId?: string | null) {
  const { context } = useDelivery();
  const country = context?.deliveryCountry;
  const q = useQuery({
    queryKey: ['availability', country, productId, variantId ?? null],
    queryFn: () => loadAvailability(country!, productId!, variantId),
    enabled: !!country && !!productId,
    staleTime: 5 * 60_000,
  });
  return { availability: q.data ?? null, country: country ?? null };
}

/** Buyer-facing text for an availability (NX-GEO-001 §4). `t` is passed to keep this file free of UI imports. */
export function availabilityText(a: Availability, country: string, tr: (es: string, v?: Record<string, string>) => string, name: (c: string) => string) {
  const c = name(country);
  const o = a.shipsFrom ? name(a.shipsFrom) : '';
  switch (a.reason) {
    case 'NO_SHIPPING_NEEDED': return { title: tr('No requiere envío'), detail: '' };
    case 'ROUTE_OK': return { title: tr('Disponible para envío a {c}', { c }), detail: o ? tr('Se despacha desde {o}.', { o }) : '' };
    case 'PICKUP_ONLY': return { title: tr('Disponible con retiro en tienda'), detail: o ? tr('Se retira en {o}.', { o }) : '' };
    case 'MARKETPLACE_NOT_SERVED': return { title: tr('No disponible para envío a {c}', { c }), detail: tr('El marketplace aún no hace envíos a este destino.') };
    case 'STORE_DOMESTIC_ONLY': return { title: tr('No disponible para envío a {c}', { c }), detail: o ? tr('Esta tienda solo envía dentro de {o}.', { o }) : tr('Esta tienda solo hace envíos nacionales.') };
    case 'STORE_EXCLUDED': return { title: tr('No disponible para envío a {c}', { c }), detail: tr('Esta tienda no envía a este destino.') };
    case 'PRODUCT_EXCLUDED': return { title: tr('No disponible para envío a {c}', { c }), detail: tr('Este producto no se envía a este destino.') };
    case 'FREE_SHIPPING_MINIMUM': return { title: tr('Envío a {c} por confirmar', { c }), detail: tr('El envío gratis depende del subtotal de esta tienda.') };
    case 'NO_SHIPPING_OPTION': return { title: tr('No disponible para envío a {c}', { c }), detail: tr('No hay opciones de envío a este destino por ahora.') };
    case 'NO_ORIGIN': return { title: tr('Envío a {c} por confirmar', { c }), detail: tr('La tienda aún no indica desde dónde despacha.') };
    default: return { title: tr('Envío a {c} por confirmar', { c }), detail: tr('Indica tu dirección al pagar para confirmar el envío y su costo.') };
  }
}

/**
 * Availability of several cart lines for the current destination; re-evaluated when the destination changes.
 * Lines are `{ productId, variantId }`; `byProduct` is keyed by variant id when one is given.
 */
export function useAvailabilityMany(lines: { productId: string; variantId?: string | null }[]) {
  const { context } = useDelivery();
  const country = context?.deliveryCountry;
  const seen = new Set<string>();
  const uniq = lines.filter((l) => {
    const k = l.variantId ?? l.productId;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const results = useQueries({
    queries: uniq.map((l) => ({
      queryKey: ['availability', country, l.productId, l.variantId ?? null],
      queryFn: () => loadAvailability(country!, l.productId, l.variantId),
      enabled: !!country,
      staleTime: 5 * 60_000,
    })),
  });
  const map = new Map<string, Availability>();
  results.forEach((r, i) => r.data && map.set(uniq[i].variantId ?? uniq[i].productId, r.data));
  return { country: country ?? null, isApproximate: !!context?.isApproximate, byProduct: map, loading: results.some((r) => r.isLoading) };
}
