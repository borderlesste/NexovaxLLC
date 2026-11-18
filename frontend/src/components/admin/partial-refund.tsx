'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { money } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, PageLoader } from '@/components/ui/misc';

/**
 * Admin: a partial refund was made at Stripe/PayPal. Pick the delivered units it covered; NEXOVAX
 * books it as a refund without return (the store's share and the commission are reversed).
 */
export function PartialRefundDialog({ incidentId, onClose, onDone }: { incidentId: string; onClose: () => void; onDone: () => void }) {
  const q = useQuery({ queryKey: ['partial-options', incidentId], queryFn: () => get<any>(`/admin/payment-incidents/${incidentId}/partial-options`) });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const d = q.data;
  useEffect(() => { if (d?.suggestion) setQty(d.suggestion); }, [d?.suggestion]);
  const est = (d?.items ?? []).reduce((n: number, it: any) => n + Math.round(Number(it.unitAmount) * 100) * (qty[it.orderItemId] ?? 0), 0) / 100;
  const target = Number(d?.amount ?? 0);
  const matches = Math.abs(est - target) < 0.005;
  const book = async () => {
    setBusy(true);
    try {
      await post(`/admin/payment-incidents/${incidentId}/book-partial`, { items: Object.entries(qty).map(([orderItemId, quantity]) => ({ orderItemId, quantity })) });
      toast.success(t('Reembolso registrado y descontado a la tienda.'));
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={t('Registrar reembolso parcial')}
      description={d ? t('El procesador reembolsó {a}. Indica qué unidades entregadas cubrió.', { a: money(d.amount, d.currency) }) : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Cancelar')}</Button><Button loading={busy} disabled={!matches} onClick={book} data-partial-book><CheckCircle2 /> {t('Registrar y descontar a la tienda')}</Button></>}>
      {!d ? <PageLoader /> : !d.items.length ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{t('No hay unidades entregadas pendientes de reembolso en este pedido. Resuélvelo con la tienda y márcalo como revisado.')}</p>
      ) : (
        <div className="space-y-4" data-partial-dialog>
          {d.suggestion
            ? <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><Wand2 className="size-4" /> {t('NEXOVAX encontró las unidades que suman exactamente el reembolso; revisa la selección.')}</p>
            : <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{t('Ninguna combinación de unidades suma exactamente el reembolso (precio + impuestos por unidad). Si fue un descuento libre, márcalo como revisado y acuérdalo con la tienda.')}</p>}
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2">{t('Producto')}</th><th>{t('Por unidad')}</th><th>{t('Disponibles')}</th><th className="w-24">{t('Unidades')}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {d.items.map((it: any) => (
                <tr key={it.orderItemId} data-partial-item>
                  <td className="py-2"><b className="line-clamp-1">{it.title}</b><span className="text-xs text-muted">{it.store}</span></td>
                  <td>{money(it.unitAmount, d.currency)}</td>
                  <td>{it.available}</td>
                  <td><Input type="number" min={0} max={it.available} value={qty[it.orderItemId] ?? 0} onChange={(e) => setQty({ ...qty, [it.orderItemId]: Math.max(0, Math.min(it.available, Math.floor(Number(e.target.value) || 0))) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between rounded-xl bg-surface p-3 text-sm">
            <span>{t('Seleccionado')}: <b>{money(est, d.currency)}</b> · {t('Reembolsado por el procesador')}: <b>{money(d.amount, d.currency)}</b></span>
            {matches ? <span className="font-semibold text-emerald-700">{t('Coincide')}</span> : <span className="font-semibold text-amber-700">{t('No coincide')}</span>}
          </div>
          <p className="text-xs text-muted">{t('Se registra como reembolso sin devolución con la referencia del procesador: no se devuelve dinero otra vez, el monto se descuenta de la ganancia de la tienda y se revierte la comisión.')}</p>
        </div>
      )}
    </Dialog>
  );
}
