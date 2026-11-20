'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw, Scale, Send, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { fmtDateTime, money } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/input';
import { Dialog, Empty, PageLoader } from '@/components/ui/misc';
import { t } from '@/lib/i18n';
import { DisputeResponseDialog } from '@/components/admin/dispute-response';
import { PartialRefundDialog } from '@/components/admin/partial-refund';

const KIND: Record<string, string> = { DISPUTE: 'Disputa', EXTERNAL_REFUND: 'Reembolso hecho fuera de NEXOVAX', PROVIDER_REVERSAL: 'Reversión del procesador' };
const OUTCOME: Record<string, string> = { WON: 'Disputa ganada', LOST: 'Disputa perdida', INQUIRY_CLOSED: 'Consulta cerrada sin cargo', ORDER_CANCELLED: 'Registrado como cancelación', REFUND_BOOKED: 'Reembolso descontado a la tienda', REVIEWED: 'Revisado' };
const DISPUTE: Record<string, string> = { INQUIRY_OPEN: 'Consulta abierta', INQUIRY_CLOSED: 'Consulta cerrada', OPEN: 'Abierta: hay que responder', UNDER_REVIEW: 'En revisión del banco / PayPal', WON: 'Ganada', LOST: 'Perdida' };

/** Admin: disputes and refunds made outside NEXOVAX. Each open one holds the store's payout for that order. */
export default function PaymentIncidentsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'OPEN' | 'ALL'>('OPEN');
  const q = useQuery({ queryKey: ['payment-incidents', status], queryFn: () => get<any[]>(`/admin/payment-incidents?status=${status}`) });
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<any>(null);
  const [respond, setRespond] = useState<string | null>(null);
  const [partial, setPartial] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const refresh = () => { q.refetch(); qc.invalidateQueries({ queryKey: ['payment-incidents-count'] }); };
  const act = async (id: string, path: string, ok: string, body?: unknown) => {
    setBusy(`${id}:${path}`);
    try { await post(`/admin/payment-incidents/${id}/${path}`, body); toast.success(t(ok)); refresh(); return true; }
    catch (e) { toast.error(errorMessage(e)); return false; } finally { setBusy(null); }
  };
  const cancelOrder = (i: any) => {
    if (!window.confirm(t('¿Registrar el reembolso de {a} como cancelación del pedido {b}? Se cancela el pedido, vuelve el stock y se anula la ganancia de la tienda. No se devuelve dinero otra vez.', { a: money(i.amount, i.currency), b: i.orderNumber }))) return;
    act(i.id, 'cancel-order', 'Pedido cancelado y reembolso registrado.');
  };
  return (
    <div>
      <PageHeader title={t('Disputas y reembolsos')} description={t('Disputas de clientes con su banco o PayPal, y reembolsos hechos directamente en Stripe o PayPal. Mientras una incidencia está abierta, el pago a la tienda de ese pedido queda retenido.')}
        actions={<div className="flex gap-2">{(['OPEN', 'ALL'] as const).map((s) => <Button key={s} size="sm" variant={status === s ? 'primary' : 'outline'} onClick={() => setStatus(s)}>{t(s === 'OPEN' ? 'Abiertas' : 'Todas')}</Button>)}</div>} />
      {q.isLoading ? <PageLoader /> : !q.data?.length ? (
        <div className="card"><Empty icon={<Scale />} title={t(status === 'OPEN' ? 'No hay incidencias abiertas' : 'Aún no hay incidencias')} description={t('Aquí aparecerán las disputas y los reembolsos hechos fuera de NEXOVAX que lleguen por los webhooks de Stripe y PayPal.')} /></div>
      ) : (
        <div className="space-y-4" data-incidents>
          {q.data.map((i) => (
            <div key={i.id} className="card p-5" data-incident={i.kind} data-incident-status={i.status}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 font-bold">
                    {i.status === 'OPEN' ? <AlertTriangle className="size-5 text-amber-500" /> : i.outcome === 'LOST' ? <XCircle className="size-5 text-red-500" /> : <CheckCircle2 className="size-5 text-emerald-500" />}
                    {t(KIND[i.kind] ?? i.kind)} · {i.provider === 'PAYPAL' ? 'PayPal' : 'Stripe'}{i.environment === 'TEST' && <span className="rounded bg-surface px-1.5 text-xs font-medium text-muted">{t('prueba')}</span>}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {t('Pedido')} <Link className="font-semibold text-brand-700 hover:underline" href={`/admin/pedidos/${i.orderId}`}>{i.orderNumber}</Link> · {i.stores} · {fmtDateTime(i.createdAt)}
                  </p>
                </div>
                <p className="text-right"><span className="block text-xl font-extrabold">{money(i.amount, i.currency)}</span>
                  {i.kind === 'DISPUTE' && Number(i.held) > 0 && i.status === 'OPEN' && <span className="text-xs text-muted">{t('Retenido por el procesador: {a}', { a: money(i.held, i.currency) })}</span>}</p>
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {i.kind === 'DISPUTE' && <div><dt className="inline text-muted">{t('Estado')}: </dt><dd className="inline font-medium">{t(DISPUTE[i.disputeStatus] ?? i.disputeStatus)}</dd></div>}
                {i.reason && <div><dt className="inline text-muted">{t('Motivo')}: </dt><dd className="inline font-medium">{i.reason.replace(/_/g, ' ')}</dd></div>}
                {i.dueBy && i.status === 'OPEN' && <div><dt className="inline text-muted">{t('Responder antes del')}: </dt><dd className="inline font-semibold text-amber-700">{fmtDateTime(i.dueBy)}</dd></div>}
                <div><dt className="inline text-muted">{t('Referencia del procesador')}: </dt><dd className="inline font-mono text-xs">{i.externalId}</dd></div>
                {i.providerStatus && i.kind === 'DISPUTE' && <div><dt className="inline text-muted">{t('Detalle')}: </dt><dd className="inline text-xs">{i.providerStatus}</dd></div>}
              </dl>
              {i.lastError && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{t('No se pudo contabilizar automáticamente')}: <span className="font-mono text-xs">{i.lastError}</span></p>}
              {i.status === 'OPEN' && i.kind === 'DISPUTE' && !i.lastError && (
                <p className="mt-3 rounded-xl bg-surface p-3 text-sm text-muted">{t('Responde la disputa en el panel de {p} con la prueba de entrega (seguimiento, fotos, mensajes). NEXOVAX registra el resultado sola cuando {p} la cierra.', { p: i.provider === 'PAYPAL' ? 'PayPal' : 'Stripe' })}</p>
              )}
              {i.status === 'OPEN' && i.kind !== 'DISPUTE' && (
                <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{i.canCancelOrder
                  ? t('Se devolvió todo el pedido desde {p}. Si el pedido aún no salió, regístralo como cancelación: se cancela, vuelve el stock y se anula la ganancia de la tienda, sin devolver el dinero otra vez.', { p: i.provider === 'PAYPAL' ? 'PayPal' : 'Stripe' })
                  : t('Es un reembolso parcial o el pedido ya avanzó. Regístralo contra las unidades que cubrió para descontarlo a la tienda; si fue un descuento libre, acuérdalo con la tienda y márcalo como revisado.')}</p>
              )}
              {i.status === 'RESOLVED' && i.kind === 'DISPUTE' && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setRespond(i.id)}>{t('Ver respuesta enviada')}</Button>}
              {i.status === 'RESOLVED' && (
                <p className="mt-3 text-sm"><span className="font-semibold">{t(OUTCOME[i.outcome] ?? i.outcome)}</span>{i.note && i.outcome === 'REVIEWED' ? ` · ${i.note}` : ''}<span className="text-muted"> · {fmtDateTime(i.resolvedAt)}{i.resolvedBy ? ` · ${i.resolvedBy}` : ''}</span></p>
              )}
              {i.status === 'OPEN' && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {i.kind === 'DISPUTE' && <Button size="sm" onClick={() => setRespond(i.id)} data-dispute-respond><Send /> {t('Responder disputa')}</Button>}
                  {i.kind === 'DISPUTE' && i.lastError && <Button size="sm" loading={busy === `${i.id}:retry`} onClick={() => act(i.id, 'retry', 'Resultado de la disputa contabilizado.')}><RefreshCw /> {t('Reintentar')}</Button>}
                  {i.kind !== 'DISPUTE' && i.canCancelOrder && <Button size="sm" loading={busy === `${i.id}:cancel-order`} onClick={() => cancelOrder(i)} data-incident-cancel><Undo2 /> {t('Registrar como cancelación')}</Button>}
                  {i.kind !== 'DISPUTE' && !i.canCancelOrder && <Button size="sm" onClick={() => setPartial(i.id)} data-incident-partial><Undo2 /> {t('Registrar reembolso parcial')}</Button>}
                  {i.kind !== 'DISPUTE' && <Button size="sm" variant="outline" onClick={() => { setReview(i); setNote(''); }} data-incident-review><CheckCircle2 /> {t('Marcar como revisado')}</Button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {partial && <PartialRefundDialog incidentId={partial} onClose={() => setPartial(null)} onDone={refresh} />}
      {respond && <DisputeResponseDialog incidentId={respond} onClose={() => setRespond(null)} onDone={refresh} />}
      {review && (
        <Dialog open onOpenChange={(o) => !o && setReview(null)} title={t('Marcar como revisado')} description={`${t(KIND[review.kind])} · ${money(review.amount, review.currency)} · ${review.orderNumber}`}
          footer={<><Button variant="secondary" onClick={() => setReview(null)}>{t('Cancelar')}</Button><Button loading={busy === `${review.id}:review`} disabled={note.trim().length < 5} onClick={async () => { if (await act(review.id, 'review', 'Incidencia cerrada.', { note: note.trim() })) setReview(null); }}>{t('Cerrar incidencia')}</Button></>}>
          <p className="mb-3 text-sm text-muted">{t('Al cerrarla se libera la retención del pago a la tienda. NEXOVAX no mueve dinero: deja constancia de cómo se resolvió.')}</p>
          <Field label={t('Cómo se resolvió')} required><Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Ej.: reembolso parcial por un artículo dañado, descontado a la tienda en el payout de diciembre.')} /></Field>
        </Dialog>
      )}
    </div>
  );
}
