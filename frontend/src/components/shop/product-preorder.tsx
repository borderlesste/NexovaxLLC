'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { useRequireAuth } from '@/components/shop/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { preorderLabels, type PreorderOffer, type PreorderReservation } from '@/lib/preorders';
import { fmtDateTime } from '@/lib/utils';

export function useProductPreorders(productId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['product-preorders', productId],
    queryFn: () => get<{ items: PreorderOffer[] }>(`/products/${productId}/preorders`),
    enabled,
    staleTime: 15_000,
    retry: false,
  });
}

export function ProductPreorder({ offer, productId, sellerId }: { offer: PreorderOffer; productId: string; sellerId: string }) {
  const { session, me } = useAuth();
  const isSeller = me?.sellers.some((seller) => seller.id === sellerId) === true;
  const requireAuth = useRequireAuth();
  const qc = useQueryClient();
  const labels = preorderLabels();
  const [claim, setClaim] = useState<string | null>(null);
  const mine = useQuery({
    queryKey: ['my-preorders', session?.user.id],
    queryFn: () => get<{ items: PreorderReservation[] }>('/me/preorders'),
    enabled: !!session && !isSeller,
    staleTime: 15_000,
  });
  const reserved = mine.data?.items.find((item) => item.offerId === offer.offerId && item.status === 'RESERVED');
  const limit = offer.remaining + (reserved?.quantity ?? 0);
  const quantity = Number(claim ?? reserved?.quantity ?? 1);
  const reserve = useMutation({
    mutationFn: (units: number) => post<PreorderReservation>('/me/preorders', { offerId: offer.offerId, quantity: units }),
    onSuccess: () => {
      setClaim(null);
      toast.success(labels.reservedSuccess);
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['my-preorders'] }),
      qc.invalidateQueries({ queryKey: ['product-preorders', productId] }),
    ]),
  });
  return (
    <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4" aria-label={labels.title}>
      <p className="flex items-center gap-2 text-sm font-bold"><CalendarDays className="size-4 shrink-0" />{labels.title}</p>
      <p className="text-sm">{labels.arrival} <strong>{fmtDateTime(offer.arrivalAt)}</strong></p>
      <p className="text-xs text-muted">{labels.paymentHint}</p>
      {reserved && (
        <p className="text-sm">
          {labels.reserved} <strong>{reserved.quantity}</strong>{' · '}
          <Link className="font-semibold text-brand-700 underline" href="/cuenta/reservas">{labels.account}</Link>
        </p>
      )}
      {offer.remaining > 0 ? <p className="text-xs text-muted">{labels.remaining} {offer.remaining}</p> : (
        <p className="text-sm font-semibold">{labels.full}</p>
      )}
      {!isSeller && limit > 0 && (
        <form className="flex flex-wrap items-end gap-2 pt-1" onSubmit={(event) => {
          event.preventDefault();
          if (requireAuth() && Number.isInteger(quantity) && quantity >= 1 && quantity <= limit) reserve.mutate(quantity);
        }}>
          <label className="block w-24 space-y-1 text-xs font-semibold">
            <span>{t('Cantidad')}</span>
            <Input type="number" min={1} max={limit} step={1} required value={claim ?? quantity}
              onChange={(event) => setClaim(event.target.value)} disabled={reserve.isPending} />
          </label>
          <Button type="submit" loading={reserve.isPending} disabled={!!session && mine.isPending}>
            {reserved ? labels.change : labels.reserve}
          </Button>
        </form>
      )}
    </section>
  );
}
