'use client';
import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, put } from './api';
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
