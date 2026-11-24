'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, Empty, ErrorBox, PageLoader } from '@/components/ui/misc';
import { del, errorMessage, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { preorderLabels, type PreorderReservation } from '@/lib/preorders';
import { fmtDateTime } from '@/lib/utils';

export default function ReservationsPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const labels = preorderLabels();
  const [selected, setSelected] = useState<PreorderReservation | null>(null);
  const q = useQuery({
    queryKey: ['my-preorders', session?.user.id],
    queryFn: () => get<{ items: PreorderReservation[] }>('/me/preorders'),
    enabled: !!session,
  });
  const cancel = useMutation({
    mutationFn: (reservation: PreorderReservation) => del(`/me/preorders/${reservation.id}`),
    onSuccess: (_, item) => {
      setSelected(null);
      return Promise.all([
        qc.invalidateQueries({ queryKey: ['my-preorders'] }),
        qc.invalidateQueries({ queryKey: ['product-preorders', item.productId] }),
      ]);
    },
  });

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-extrabold">{labels.account}</h1>
      {q.isPending && <PageLoader />}
      {q.isError && <ErrorBox message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.data?.items.length === 0 && (
        <div className="card"><Empty icon={<CalendarDays />} title={labels.empty}
          action={<Button asChild><Link href="/catalogo">{t('Explorar productos')}</Link></Button>} /></div>
      )}
      {!!q.data?.items.length && (
        <ul className="card divide-y divide-line">
          {q.data.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link className="break-words font-semibold hover:text-brand-700" href={`/producto/${item.productSlug}`}>{item.productTitle}</Link>
                <p className="text-sm text-muted">
                  {[item.variantTitle, `${t('Cantidad')} ${item.quantity}`, fmtDateTime(item.arrivalAt)].filter(Boolean).join(' · ')}
                </p>
              </div>
              <Badge tone={item.status === 'RESERVED' || item.status === 'IN_STOCK' ? 'green' : 'gray'}>{labels[item.status]}</Badge>
              {item.status === 'RESERVED' && <Button size="sm" variant="ghost" onClick={() => { cancel.reset(); setSelected(item); }}>{labels.cancel}</Button>}
              {item.status === 'IN_STOCK' && (
                <Button size="sm" variant="secondary" asChild><Link href={`/producto/${item.productSlug}`}>{t('Ver producto')}</Link></Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open && !cancel.isPending) setSelected(null); }} title={labels.cancel}
        description={labels.cancelHint}
        footer={<>
          <Button variant="secondary" disabled={cancel.isPending} onClick={() => setSelected(null)}>{t('Volver')}</Button>
          <Button variant="danger" loading={cancel.isPending} onClick={() => { if (selected) cancel.mutate(selected); }}>{labels.cancel}</Button>
        </>}>
        {cancel.isError && <ErrorBox message={errorMessage(cancel.error)} />}
      </Dialog>
    </div>
  );
}
