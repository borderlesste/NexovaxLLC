'use client';
import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

const hasCookie = () => typeof document !== 'undefined' && document.cookie.split('; ').some((c) => c.startsWith(`${DELIVERY_COOKIE}=`));

/**
 * Browsing destination (NX-GEO-001): explicit choice > account preference > IP country > default,
 * resolved by the API. It guides browsing only; checkout validates the confirmed address.
 */
export function useDelivery() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery<DeliveryContext>({ queryKey: ['geo-context', me?.id ?? null], queryFn: () => get('/geo/context'), staleTime: 10 * 60_000 });

  // On sign-in, an explicit choice made before logging in becomes the account's preference
  // when the account has none (the current explicit choice wins).
  const synced = useRef<string | null>(null);
  useEffect(() => {
    const ctx = q.data;
    if (!me || !ctx || synced.current === me.id) return;
    synced.current = me.id;
    if (ctx.source === 'manual' && hasCookie() && me.deliveryCountry !== ctx.deliveryCountry && !me.deliveryCountry)
      put('/me/delivery-country', { country: ctx.deliveryCountry }).catch(() => undefined);
  }, [me, q.data]);

  const setCountry = useCallback(
    async (code: string) => {
      const cc = code.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(cc)) return;
      const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; secure' : '';
      document.cookie = `${DELIVERY_COOKIE}=${cc}; path=/; max-age=31536000; samesite=lax${secure}`;
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
 * (up to 100 products), so a catalog page costs one call instead of one per product.
 */
const pending = new Map<string, { ids: Set<string>; waiters: Map<string, ((a: Availability | null) => void)[]>; timer: ReturnType<typeof setTimeout> }>();
function loadAvailability(country: string, id: string): Promise<Availability | null> {
  return new Promise((resolve) => {
    let b = pending.get(country);
    if (!b) {
      b = {
        ids: new Set(),
        waiters: new Map(),
        timer: setTimeout(async () => {
          pending.delete(country);
          const batch = b!;
          const all = [...batch.ids];
          for (let i = 0; i < all.length; i += 100) {
            const chunk = all.slice(i, i + 100);
            let items: Record<string, Availability> = {};
            try {
              items = (await post<{ items: Record<string, Availability> }>('/geo/availability', { country, productIds: chunk })).items ?? {};
            } catch {
              /* unknown: show nothing rather than a wrong state */
            }
            for (const pid of chunk) for (const w of batch.waiters.get(pid) ?? []) w(items[pid] ?? null);
          }
        }, 25),
      };
      pending.set(country, b);
    }
    b.ids.add(id);
    b.waiters.set(id, [...(b.waiters.get(id) ?? []), resolve]);
  });
}

/** Availability of one product for the current browsing destination (null while unknown). */
export function useAvailability(productId?: string | null) {
  const { context } = useDelivery();
  const country = context?.deliveryCountry;
  const q = useQuery({
    queryKey: ['availability', country, productId],
    queryFn: () => loadAvailability(country!, productId!),
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
    case 'NO_SHIPPING_OPTION': return { title: tr('No disponible para envío a {c}', { c }), detail: tr('No hay opciones de envío a este destino por ahora.') };
    case 'NO_ORIGIN': return { title: tr('Envío a {c} por confirmar', { c }), detail: tr('La tienda aún no indica desde dónde despacha.') };
    default: return { title: tr('Envío a {c} por confirmar', { c }), detail: tr('Indica tu dirección al pagar para confirmar el envío y su costo.') };
  }
}
