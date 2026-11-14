'use client';
import { useState } from 'react';
import { Ban, Check, CreditCard, Undo2, X, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, post } from '@/lib/api';
import { t } from '@/lib/i18n';
import { fmtDateTime, money } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/misc';
import { Field, Input, Select, Textarea } from '@/components/ui/input';

type Role = 'customer' | 'seller' | 'admin';

export const CANCEL_REASON_LABELS: Record<string, string> = {
  CHANGED_MIND: 'Ya no lo quiero',
  ORDERED_BY_MISTAKE: 'Lo compré por error',
  FOUND_BETTER_PRICE: 'Encontré un mejor precio',
  DELIVERY_TOO_SLOW: 'La entrega tarda demasiado',
  WRONG_ADDRESS: 'Me equivoqué de dirección',
  OUT_OF_STOCK: 'Sin stock',
  CANNOT_SHIP_TO_ADDRESS: 'No puedo enviar a esa dirección',
  PRICING_ERROR: 'Error en el precio publicado',
  CUSTOMER_REQUEST: 'A pedido del cliente',
  FRAUD_SUSPECTED: 'Sospecha de fraude',
  SELLER_UNRESPONSIVE: 'La tienda no despacha',
  OTHER: 'Otro motivo',
};
const REASONS: Record<Role, string[]> = {
  customer: ['CHANGED_MIND', 'ORDERED_BY_MISTAKE', 'FOUND_BETTER_PRICE', 'DELIVERY_TOO_SLOW', 'WRONG_ADDRESS', 'OTHER'],
  seller: ['OUT_OF_STOCK', 'CANNOT_SHIP_TO_ADDRESS', 'PRICING_ERROR', 'CUSTOMER_REQUEST', 'OTHER'],
  admin: ['CUSTOMER_REQUEST', 'FRAUD_SUSPECTED', 'SELLER_UNRESPONSIVE', 'OUT_OF_STOCK', 'OTHER'],
};

/** "Cancel purchase" for one store's part of an order (customer, seller or support/admin). */
export function CancelPurchaseDialog({ role, order, so, onClose, onDone }: { role: Role; order: any; so: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const instant = role !== 'customer' || !so.cancelNeedsApproval;
  const submit = async () => {
    setBusy(true);
    try {
      const body = { reasonCode: reason, note: note.trim() || undefined };
      if (role === 'customer') await post(`/orders/${order.id}/cancellations`, { sellerOrderId: so.id, ...body });
      else if (role === 'seller') await post(`/seller/seller-orders/${so.id}/cancel`, body);
      else await post(`/admin/seller-orders/${so.id}/cancel`, body);
      toast.success(instant ? t('Compra cancelada.') : t('Solicitud enviada a la tienda.'));
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const many = order.sellerOrders.length > 1;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('Cancelar compra')}
      description={many ? t('Se cancela solo la parte de {store} en este pedido.', { store: so.seller.name }) : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Volver')}</Button><Button variant="dangerSolid" loading={busy} disabled={!reason || (reason === 'OTHER' && !note.trim())} onClick={submit} data-cancel-submit>{instant ? t('Cancelar compra') : t('Enviar solicitud')}</Button></>}>
      <div className="space-y-4" data-cancel-dialog>
        <div className="rounded-xl bg-surface p-3 text-sm">
          {role === 'customer'
            ? instant
              ? t('La tienda aún no prepara tu compra: se cancela de inmediato y te devolvemos {amount} (productos, impuestos y envío) al mismo medio de pago.', { amount: money(so.totals.total, order.currency) })
              : t('La tienda ya está preparando tu compra: le enviaremos tu solicitud y, si la acepta, te devolvemos {amount} al mismo medio de pago.', { amount: money(so.totals.total, order.currency) })
            : role === 'seller'
              ? t('El cliente recibe el reembolso completo ({amount}), el stock vuelve a tu inventario y el ingreso pendiente de esta venta se anula.', { amount: money(so.totals.total, order.currency) })
              : t('El stock vuelve a la tienda y el cliente recibe el reembolso completo ({amount}). Si eres administrador, el reembolso se emite ahora.', { amount: money(so.totals.total, order.currency) })}
        </div>
        <Field label={t('Motivo')} required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)} data-cancel-reason>
            <option value="">{t('Elige un motivo')}</option>
            {REASONS[role].map((r) => <option key={r} value={r}>{t(CANCEL_REASON_LABELS[r])}</option>)}
          </Select>
        </Field>
        <Field label={reason === 'OTHER' ? t('Detalle') : t('Comentario (opcional)')} required={reason === 'OTHER'}>
          <Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-cancel-note />
        </Field>
      </div>
    </Dialog>
  );
}

/** Status of a cancellation and the actions each party has on it. */
export function CancellationPanel({ role, order, so, onChanged }: { role: Role; order: any; so: any; onChanged: () => void }) {
  const c = so.cancellation;
  const { can } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [reference, setReference] = useState('');
  if (!c || c.status === 'WITHDRAWN') return null;
  const base = role === 'seller' ? '/seller/cancellations' : '/admin/cancellations';
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      setRejecting(false);
      setRefunding(false);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const transfer = order.payment?.method === 'BANK_TRANSFER';
  const tone = c.status === 'REJECTED' ? 'border-red-200 bg-red-50/60' : c.status === 'REFUNDED' ? 'border-line bg-surface' : 'border-amber-200 bg-amber-50/60';
  const title = {
    REQUESTED: role === 'customer' ? t('Pediste cancelar esta compra') : t('El cliente pidió cancelar esta compra'),
    APPROVED: t('Compra cancelada: reembolso en proceso'),
    REFUNDED: t('Compra cancelada y reembolsada'),
    REJECTED: t('Solicitud de cancelación rechazada'),
  }[c.status as 'REQUESTED' | 'APPROVED' | 'REFUNDED' | 'REJECTED'];
  return (
    <div className={`mx-5 mt-4 rounded-xl border p-4 text-sm ${tone}`} data-cancellation={c.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-bold"><Ban className="size-4" /> {title} <span className="font-normal text-muted">· {c.number}</span></p>
          <p className="text-muted">{t('Motivo:')} {t(CANCEL_REASON_LABELS[c.reasonCode] ?? c.reasonCode)}{c.note ? ` — ${c.note}` : ''}</p>
          {c.status === 'REQUESTED' && role !== 'customer' && <p className="text-muted">{t('No prepares ni envíes esta compra hasta resolver la solicitud.')}</p>}
          {c.status === 'REQUESTED' && role === 'customer' && <p className="text-muted">{t('La tienda debe aceptarla porque ya estaba preparando tu compra.')}</p>}
          {c.status === 'APPROVED' && <p className="text-muted">{role === 'customer' ? t('Te devolveremos {amount} al mismo medio de pago.', { amount: money(c.amount, c.currency) }) : t('El stock volvió al inventario. El reembolso de {amount} lo emite un administrador.', { amount: money(c.amount, c.currency) })}</p>}
          {c.status === 'REFUNDED' && c.refund && <p className="text-muted">{t('Reembolso {n} de {amount} emitido el {date}.', { n: c.refund.number, amount: money(c.refund.amount, c.currency), date: fmtDateTime(c.refundedAt) })}</p>}
          {c.status === 'REJECTED' && <p className="text-muted">{t('Respuesta de la tienda:')} {c.decisionNote}</p>}
          {c.lastError && c.status === 'APPROVED' && <p className="text-red-700">{t('Último intento de reembolso:')} {c.lastError}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {c.status === 'REQUESTED' && role === 'customer' && (
            <Button size="sm" variant="outline" loading={busy === 'withdraw'} onClick={() => act('withdraw', () => post(`/orders/cancellations/${c.id}/withdraw`), t('Solicitud retirada.'))}><Undo2 /> {t('Retirar solicitud')}</Button>
          )}
          {c.status === 'REQUESTED' && (role === 'seller' || (role === 'admin' && can('orders.cancel'))) && (
            <>
              <Button size="sm" loading={busy === 'approve'} onClick={() => act('approve', () => post(`${base}/${c.id}/approve`, {}), t('Cancelación aceptada.'))} data-cancel-approve><Check /> {t('Aceptar cancelación')}</Button>
              <Button size="sm" variant="outline" onClick={() => setRejecting(true)} data-cancel-reject><X /> {t('Rechazar')}</Button>
            </>
          )}
          {c.status === 'APPROVED' && role === 'admin' && can('cancellations.refund') && (
            <Button size="sm" loading={busy === 'refund'} onClick={() => (transfer ? setRefunding(true) : act('refund', () => post(`/admin/cancellations/${c.id}/refund`, {}), t('Reembolso emitido.')))} data-cancel-refund><CreditCard /> {t('Reembolsar al cliente')}</Button>
          )}
        </div>
      </div>
      {rejecting && (
        <Dialog open onOpenChange={(o) => !o && setRejecting(false)} title={t('Rechazar cancelación')} description={t('El cliente verá tu respuesta. Solo rechaza si la compra ya va en camino.')}
          footer={<><Button variant="secondary" onClick={() => setRejecting(false)}>{t('Volver')}</Button><Button variant="dangerSolid" loading={busy === 'reject'} disabled={reason.trim().length < 5} onClick={() => act('reject', () => post(`${base}/${c.id}/reject`, { note: reason.trim() }), t('Solicitud rechazada.'))}><XCircle /> {t('Rechazar')}</Button></>}>
          <Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Ej.: el paquete ya fue entregado a la transportadora.')} data-cancel-reject-note />
        </Dialog>
      )}
      {refunding && (
        <Dialog open onOpenChange={(o) => !o && setRefunding(false)} title={t('Reembolsar cancelación')} description={t('Este pedido se pagó por transferencia: envía el dinero al cliente y registra la referencia.')}
          footer={<><Button variant="secondary" onClick={() => setRefunding(false)}>{t('Volver')}</Button><Button loading={busy === 'refund'} disabled={reference.trim().length < 3} onClick={() => act('refund', () => post(`/admin/cancellations/${c.id}/refund`, { manualReference: reference.trim() }), t('Reembolso registrado.'))}>{t('Registrar reembolso')}</Button></>}>
          <Field label={t('Referencia de la transferencia')} required><Input value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} /></Field>
        </Dialog>
      )}
    </div>
  );
}
