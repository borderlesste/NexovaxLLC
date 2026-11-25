'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { fmtDateTime, money } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Textarea } from '@/components/ui/input';
import { Dialog, Empty, PageLoader } from '@/components/ui/misc';
import { FlashCountdown } from '@/components/shop/flash-countdown';

const STATE: Record<string, [string, 'green' | 'amber' | 'gray' | 'red' | 'blue']> = {
  LIVE: ['En curso', 'green'], SCHEDULED: ['Programada', 'blue'], ENDED: ['Terminada', 'gray'], CANCELLED: ['Cancelada por la tienda', 'gray'], REMOVED: ['Retirada', 'red'],
};

/** Admin → Configuración → Portada: every store's flash deals; the team can take one down (the store is told why). */
export function FlashDealsAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-flash-deals'], queryFn: () => get<any[]>('/admin/flash-deals') });
  const [target, setTarget] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await post(`/admin/flash-deals/${target.id}/remove`, { reason });
      toast.success(t('Oferta retirada. Avisamos a la tienda.'));
      setTarget(null);
      qc.invalidateQueries({ queryKey: ['admin-flash-deals'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-admin-flash-deals>
      <CardHeader icon={<Zap />} title={t('Ofertas relámpago de las tiendas')} subtitle={t('Las crea cada tienda. Retira una si su precio es engañoso o incumple las políticas: el producto vuelve a su precio normal y la tienda recibe el motivo.')} />
      {q.isLoading ? <PageLoader /> : !q.data?.length ? (
        <Empty icon={<Zap />} title={t('No hay ofertas relámpago')} description={t('Aparecerán aquí cuando las tiendas las creen.')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted"><tr><th className="px-5 py-2.5">{t('Producto')}</th><th>{t('Tienda')}</th><th>{t('Descuento')}</th><th>{t('Vigencia')}</th><th>{t('Estado')}</th><th /></tr></thead>
            <tbody className="divide-y divide-line">
              {q.data.map((d) => (
                <tr key={d.id}>
                  <td className="px-5 py-3"><Link href={`/producto/${d.slug}`} className="block max-w-64 truncate font-semibold hover:underline">{d.title}</Link>
                    <span className="text-xs">{d.flashPrice && <b>{money(d.flashPrice)}</b>} {d.regularPrice && <span className="text-muted line-through">{money(d.regularPrice)}</span>}</span></td>
                  <td className="text-xs">{d.seller.name}</td>
                  <td className="font-semibold">-{d.discountPercent} %</td>
                  <td className="text-xs text-muted">{fmtDateTime(d.startsAt)} → {fmtDateTime(d.endsAt)}{d.state === 'LIVE' && <span className="mt-1 block"><FlashCountdown endsAt={d.endsAt} compact /></span>}</td>
                  <td><Badge tone={STATE[d.state]?.[1] ?? 'gray'}>{t(STATE[d.state]?.[0] ?? d.state)}</Badge>{d.removalReason && <span className="mt-1 block max-w-56 text-xs text-muted">{d.removalReason}</span>}</td>
                  <td className="pr-5 text-right">{(d.state === 'LIVE' || d.state === 'SCHEDULED') && <Button size="sm" variant="secondary" className="text-red-600" onClick={() => { setTarget(d); setReason(''); }}>{t('Retirar')}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {target && (
        <Dialog open onOpenChange={(o) => !o && setTarget(null)} title={t('Retirar oferta relámpago')} description={t('{a} de {b}. El producto vuelve a su precio normal al instante.', { a: target.title, b: target.seller.name })}
          footer={<><Button variant="secondary" onClick={() => setTarget(null)}>{t('Cancelar')}</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={remove}>{t('Retirar oferta')}</Button></>}>
          <Field label={t('Motivo para la tienda')} required><Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </Dialog>
      )}
    </Card>
  );
}
