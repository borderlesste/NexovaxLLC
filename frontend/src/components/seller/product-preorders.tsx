'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Dialog, ErrorBox } from '@/components/ui/misc';
import { del, errorMessage, get, put } from '@/lib/api';
import { t } from '@/lib/i18n';
import { preorderLabels, type SellerPreorderOffer } from '@/lib/preorders';
import { fmtDateTime } from '@/lib/utils';

const fiveDays = 5 * 24 * 60 * 60 * 1000;
const maxCapacity = 1_000_000;

interface Variant {
  id: string;
  sku: string;
  stock: number;
  optionValues?: Record<string, string>;
}

function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function SellerProductPreorders({ productId, variants }: { productId?: string; variants: Variant[] }) {
  const labels = preorderLabels();
  return (
    <Card>
      <CardHeader icon={<CalendarDays />} title={labels.title} />
      {productId ? <PreorderSettings productId={productId} variants={variants} /> : (
        <p className="px-5 pb-5 text-sm text-muted">{labels.draft}</p>
      )}
    </Card>
  );
}

function PreorderSettings({ productId, variants }: { productId: string; variants: Variant[] }) {
  const labels = preorderLabels();
  const [pick, setPick] = useState('');
  const query = useQuery({
    queryKey: ['seller-preorders', productId],
    queryFn: () => get<{ items: SellerPreorderOffer[] }>(`/seller/products/${productId}/preorders`),
  });
  const variant = variants.find((v) => v.id === pick) ?? variants.find((v) => v.stock <= 0) ?? variants[0];
  const offer = query.data?.items.find((item) => item.variantId === variant?.id);
  return (
    <div className="space-y-3 px-5 pb-5">
      <p className="text-sm text-muted">{labels.sellerHint}</p>
      {query.isPending && <p className="text-sm text-muted">{t('Cargando…')}</p>}
      {query.isError && <ErrorBox message={errorMessage(query.error)} onRetry={() => void query.refetch()} />}
      {query.isSuccess && variant && (
        <>
          {variants.length > 1 && (
            <label className="block space-y-1 text-sm font-semibold">
              <span>{t('Variante')}</span>
              <Select value={variant.id} onChange={(event) => setPick(event.target.value)}>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>{[v.sku, ...Object.values(v.optionValues ?? {})].join(' · ')}</option>
                ))}
              </Select>
            </label>
          )}
          <PreorderFields key={`${variant.id}:${offer?.offerId ?? ''}:${offer?.status ?? ''}`} productId={productId} variant={variant} offer={offer} />
        </>
      )}
    </div>
  );
}

function PreorderFields({ productId, variant, offer }: { productId: string; variant: Variant; offer?: SellerPreorderOffer }) {
  const labels = preorderLabels();
  const open = offer?.status === 'OPEN';
  const [arrival, setArrival] = useState(() => open ? localDateTime(new Date(offer.arrivalAt)) : '');
  const [capacity, setCapacity] = useState(() => open ? String(offer.capacity) : '');
  const [confirm, setConfirm] = useState(false);
  const qc = useQueryClient();
  const url = `/seller/products/${productId}/preorders/${variant.id}`;
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['seller-preorders', productId] }),
    qc.invalidateQueries({ queryKey: ['product-preorders', productId] }),
    qc.invalidateQueries({ queryKey: ['my-preorders'] }),
  ]);
  const save = useMutation({
    mutationFn: (values: { arrivalAt: string; capacity: number }) => put(url, values),
    onSuccess: () => toast.success(labels.saved),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });
  const close = useMutation({
    mutationFn: () => del(url),
    onSuccess: () => setConfirm(false),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });
  const now = Date.now();
  const deadline = open && offer.maxArrivalAt ? new Date(offer.maxArrivalAt) : new Date(now + fiveDays);
  const busy = save.isPending || close.isPending;
  return (
    <div className="space-y-3">
      {offer && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={open ? 'green' : 'gray'}>{labels[offer.status]}</Badge>
          <span className="text-muted">{fmtDateTime(offer.arrivalAt)} · {labels.reserved} {offer.reserved} / {offer.capacity}</span>
        </div>
      )}
      {variant.stock <= 0 && (
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          const timestamp = new Date(arrival).getTime();
          const units = Number(capacity);
          if (!Number.isFinite(timestamp) || timestamp <= Date.now() || timestamp > Date.now() + fiveDays) {
            toast.error(labels.invalidArrival);
            return;
          }
          if (!Number.isInteger(units) || units < 1 || units > maxCapacity) {
            toast.error(labels.invalidCapacity);
            return;
          }
          const arrivalAt = open && arrival === localDateTime(new Date(offer.arrivalAt)) ? offer.arrivalAt : new Date(timestamp).toISOString();
          save.mutate({ arrivalAt, capacity: units });
        }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm font-semibold">
              <span>{labels.arrival}</span>
              <Input type="datetime-local" required value={arrival} min={localDateTime(new Date(now))} max={localDateTime(deadline)}
                onChange={(event) => setArrival(event.target.value)} disabled={busy} />
            </label>
            <label className="block space-y-1 text-sm font-semibold">
              <span>{labels.capacity}</span>
              <Input type="number" required min={Math.max(1, open ? offer.reserved : 0)} max={maxCapacity} step={1} value={capacity}
                onChange={(event) => setCapacity(event.target.value)} disabled={busy} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" loading={save.isPending} disabled={busy}>{labels.save}</Button>
            {open && <Button type="button" variant="ghost" onClick={() => setConfirm(true)} disabled={busy}>{labels.close}</Button>}
          </div>
        </form>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm} title={labels.close} description={labels.closeHint}
        footer={<>
          <Button variant="secondary" onClick={() => setConfirm(false)} disabled={close.isPending}>{t('Volver')}</Button>
          <Button variant="danger" onClick={() => close.mutate()} loading={close.isPending}>{labels.close}</Button>
        </>}>
        {close.isError && <ErrorBox message={errorMessage(close.error)} />}
      </Dialog>
    </div>
  );
}
