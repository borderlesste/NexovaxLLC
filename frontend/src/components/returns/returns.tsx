'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronRight, ClipboardCheck, CreditCard, Info, MapPin, PackageCheck, PackageOpen, RotateCcw, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { countryName, getLocale, t } from '@/lib/i18n';
import { cn, fmtDate, fmtDateTime, money } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Dialog, Empty, ErrorBox, PageLoader, Pagination, Segmented } from '@/components/ui/misc';
import { ProductImage } from '@/components/shop/product-card';
import { AttachmentList } from '@/components/attachments/attachments';
import type { Tone } from '@/lib/status';

export type ReturnRole = 'customer' | 'seller' | 'staff';
const API: Record<ReturnRole, string> = { customer: '/me/returns', seller: '/seller/returns', staff: '/admin/returns' };
export const RETURN_HREF: Record<ReturnRole, string> = { customer: '/cuenta/devoluciones', seller: '/vendedor/devoluciones', staff: '/admin/devoluciones' };

const TONE: Record<string, Tone> = {
  REQUESTED: 'amber', UNDER_REVIEW: 'amber', APPROVED: 'blue', AWAITING_SHIPMENT: 'blue', IN_TRANSIT: 'blue', RECEIVED: 'violet', INSPECTING: 'violet',
  REFUND_PENDING: 'amber', CLOSED: 'green', REJECTED: 'red', CANCELLED: 'gray',
};
export function ReturnStatus({ status, label }: { status: string; label: string }) {
  return <Badge tone={TONE[status] ?? 'gray'}>{t(label)}</Badge>;
}
const CONDITIONS = [['NEW', 'Nuevo, sin abrir'], ['OPENED', 'Abierto, en buen estado'], ['USED', 'Usado'], ['DAMAGED', 'Dañado']] as const;
const conditionLabel = (c?: string | null) => t(CONDITIONS.find(([v]) => v === c)?.[1] ?? '—');
const reasonLabel = (r: { label?: string; labelEn?: string | null }) => (getLocale() === 'en' && r.labelEn ? r.labelEn : t(r.label ?? ''));

const STEPS = [
  ['REQUESTED', 'Solicitada', RotateCcw],
  ['AWAITING_SHIPMENT', 'Aprobada', Check],
  ['IN_TRANSIT', 'Enviada', Truck],
  ['RECEIVED', 'Recibida', PackageCheck],
  ['REFUND_PENDING', 'Inspeccionada', ClipboardCheck],
  ['CLOSED', 'Reembolsada', CreditCard],
] as const;
const ORDER = ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'AWAITING_SHIPMENT', 'IN_TRANSIT', 'RECEIVED', 'INSPECTING', 'REFUND_PENDING', 'CLOSED'];

function Progress({ status }: { status: string }) {
  if (['REJECTED', 'CANCELLED'].includes(status)) return null;
  const idx = ORDER.indexOf(status);
  return (
    <ol className="grid grid-cols-3 gap-y-4 sm:grid-cols-6" data-return-progress>
      {STEPS.map(([code, label, Icon], i) => {
        const done = idx >= ORDER.indexOf(code);
        const current = !done && (i === 0 || idx >= ORDER.indexOf(STEPS[i - 1][0]));
        return (
          <li key={code} className="flex flex-col items-center text-center text-xs">
            <span className={cn('grid size-9 place-items-center rounded-full ring-4', done ? 'bg-brand-600 text-white ring-brand-100' : current ? 'bg-white text-brand-600 ring-brand-100' : 'bg-surface text-muted ring-transparent')}><Icon className="size-4" /></span>
            <span className={cn('mt-2 font-semibold', !done && 'text-muted')}>{t(label)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ------------------------------------------------------------------ list
export function ReturnsList({ role }: { role: ReturnRole }) {
  const [status, setStatus] = useState(role === 'customer' ? '' : 'ACTION');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['returns', role, status, page], queryFn: () => get(`${API[role]}?status=${status}&page=${page}`) });
  useEffect(() => setPage(1), [status]);
  const c = q.data?.counts;
  const tabs =
    role === 'customer'
      ? [{ value: '', label: t('Todas') }, { value: 'OPEN', label: t('En curso') }, { value: 'CLOSED', label: t('Reembolsadas') }, { value: 'REJECTED', label: t('Rechazadas') }]
      : [
          { value: 'ACTION', label: role === 'seller' ? t('Por atender') : t('Por reembolsar'), count: role === 'seller' ? (c ? c.to_review + c.in_transit + c.to_inspect : undefined) : c?.refund_pending },
          { value: 'REQUESTED', label: t('Por revisar'), count: c?.to_review },
          { value: 'IN_TRANSIT', label: t('En camino'), count: c?.in_transit },
          { value: 'RECEIVED', label: t('Por inspeccionar'), count: c?.to_inspect },
          { value: 'REFUND_PENDING', label: t('Reembolso pendiente'), count: c?.refund_pending },
          { value: 'CLOSED', label: t('Cerradas'), count: c?.closed },
          { value: '', label: t('Todas') },
        ];
  return (
    <Card className="overflow-hidden">
      <Segmented value={status} onChange={setStatus} options={tabs} className="px-3" />
      {q.isLoading ? <PageLoader /> : q.error ? <ErrorBox message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
        <Empty icon={<RotateCcw />} title={t('No hay devoluciones')} description={role === 'customer' ? t('Puedes solicitar una devolución desde el detalle de un pedido entregado.') : t('Aquí aparecerán las solicitudes de devolución de tus clientes.')} />
      ) : (
        <ul className="divide-y divide-line" data-returns-list>
          {q.data.items.map((r: any) => (
            <li key={r.id}>
              <Link href={`${RETURN_HREF[role]}/${r.id}`} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-surface sm:flex-nowrap">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-600"><RotateCcw className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{r.number} <span className="font-normal text-muted">· {t('Pedido')} {r.orderNumber}</span></p>
                  <p className="truncate text-sm text-muted">{r.products} · {r.units} {t('unid.')}{role !== 'customer' ? ` · ${r.customer}` : ` · ${r.store}`}</p>
                </div>
                <div className="text-right text-sm">
                  <ReturnStatus status={r.status} label={r.statusLabel} />
                  <p className="mt-1 text-xs text-muted">{fmtDate(r.requestedAt)}{Number(r.refunded) > 0 ? ` · ${t('Reembolsado')} ${money(r.refunded, r.currency)}` : ''}</p>
                </div>
                <ChevronRight className="hidden size-4 text-muted sm:block" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {q.data?.total > 20 && <div className="border-t border-line p-3"><Pagination page={page} pageSize={20} total={q.data.total} onPage={setPage} label="devoluciones" /></div>}
    </Card>
  );
}

// ------------------------------------------------------------------ detail
export function ReturnDetail({ role, id }: { role: ReturnRole; id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['return', role, id], queryFn: () => get(`${API[role]}/${id}`) });
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'approve' | 'reject' | 'ship' | 'inspect' | 'refund' | 'cancel'>(null);
  const d = q.data;
  const run = async (key: string, path: string, body: unknown, ok: string) => {
    setBusy(key);
    try {
      const r = await post(`${API[role]}/${id}/${path}`, body);
      qc.setQueryData(['return', role, id], r);
      qc.invalidateQueries({ queryKey: ['returns'] });
      setDialog(null);
      toast.success(t(ok));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (q.isLoading) return <PageLoader />;
  if (q.error || !d) return <ErrorBox message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const cur = d.currency;
  const orderHref = role === 'customer' ? `/cuenta/pedidos/${d.orderId}` : role === 'seller' ? `/vendedor/pedidos/${d.orderId}` : `/admin/pedidos/${d.orderId}`;
  const refund = d.refunds?.find((r: any) => r.status === 'COMPLETED');
  const reviewed = !['REQUESTED', 'UNDER_REVIEW'].includes(d.status);
  const inspected = ['REFUND_PENDING', 'CLOSED'].includes(d.status);
  // Units that would be refunded at this stage: requested → approved → accepted at inspection.
  const units = (i: any) => Number(inspected ? i.accepted : reviewed ? i.approved : i.requested) || 0;
  const estimate = d.items.reduce((s: number, i: any) => s + Number(i.unitPrice ?? 0) * units(i), 0);
  return (
    <div className="space-y-5" data-return={d.status}>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">{t('Devolución')}</p>
            <h2 className="text-2xl font-extrabold">{d.number}</h2>
            <p className="text-sm text-muted">{t('Pedido')} <Link href={orderHref} className="font-semibold text-brand-700 hover:underline">{d.orderNumber}</Link> · {d.store.name} · {t('Solicitada el {d}', { d: fmtDateTime(d.requestedAt) })}</p>
          </div>
          <ReturnStatus status={d.status} label={d.statusLabel} />
        </div>
        <div className="mt-6"><Progress status={d.status} /></div>
        {d.status === 'REJECTED' && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"><b>{t('Motivo del rechazo')}:</b> {d.rejection}</p>}
        {d.status === 'CANCELLED' && <p className="mt-4 rounded-lg bg-surface p-3 text-sm text-muted">{t('La solicitud fue cancelada.')}</p>}
        <Actions role={role} d={d} busy={busy} setDialog={setDialog} run={run} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title={t('Productos')} subtitle={t('{n} producto(s) en esta devolución', { n: d.items.length })} />
            <ul className="divide-y divide-line">
              {d.items.map((i: any) => (
                <li key={i.id} className="flex gap-4 p-5">
                  <ProductImage src={i.imageUrl} alt={i.title} className="size-16 shrink-0 rounded-lg bg-surface" />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-bold">{i.title}</p>
                    {i.variantTitle && <p className="text-muted">{i.variantTitle}</p>}
                    <p className="mt-1"><b>{t('Motivo')}:</b> {reasonLabel(i.reason)}</p>
                    {i.comment && <p className="text-muted">“{i.comment}”</p>}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span>{t('Solicitadas')}: <b className="text-ink">{i.requested}</b></span>
                      {reviewed && d.status !== 'REJECTED' && d.status !== 'CANCELLED' && <span>{t('Aprobadas')}: <b className="text-ink">{i.approved ?? 0}</b></span>}
                      {Number(i.received) > 0 && <span>{t('Recibidas')}: <b className="text-ink">{i.received}</b></span>}
                      {inspected && <span>{t('Aceptadas')}: <b className="text-ink">{i.accepted}</b></span>}
                      {Number(i.restock) > 0 && <span>{t('Repuestas al inventario')}: <b className="text-ink">{i.restock}</b></span>}
                      {i.condition && <span>{t('Estado')}: <b className="text-ink">{conditionLabel(i.condition)}</b></span>}
                    </div>
                  </div>
                  <p className="text-sm font-semibold">{money(i.unitPrice, cur)}</p>
                </li>
              ))}
            </ul>
          </Card>
          {(d.comment || d.evidence.length > 0) && (
            <Card className="p-5">
              <h3 className="font-bold">{t('Comentario y evidencias del cliente')}</h3>
              {d.comment && <p className="mt-2 whitespace-pre-line text-sm">{d.comment}</p>}
              <AttachmentList base={`/returns/${d.id}/evidence`} items={d.evidence.map((e: any) => ({ ...e, kind: 'IMAGE' }))} />
            </Card>
          )}
          {d.sellerComment && <Card className="p-5 text-sm"><h3 className="font-bold">{t('Nota de la tienda')}</h3><p className="mt-2 whitespace-pre-line">{d.sellerComment}</p></Card>}
        </div>

        <div className="space-y-5">
          {d.returnAddress && (
            <Card className="p-5 text-sm" data-return-address>
              <h3 className="flex items-center gap-2 font-bold"><MapPin className="size-4 text-brand-600" /> {t('Dirección para devolver')}</h3>
              <p className="mt-2 font-semibold">{d.returnAddress.name}</p>
              <p>{d.returnAddress.line1}{d.returnAddress.line2 ? `, ${d.returnAddress.line2}` : ''}</p>
              <p>{[d.returnAddress.city, d.returnAddress.region, d.returnAddress.postalCode].filter(Boolean).join(', ')}</p>
              <p>{countryName(d.returnAddress.countryCode)}{d.returnAddress.phone ? ` · ${d.returnAddress.phone}` : ''}</p>
              {role === 'customer' && <p className="mt-3 rounded-lg bg-brand-50 p-3 text-xs text-brand-800">{t('Empaca los productos con sus accesorios, envíalos con la transportadora de tu preferencia y registra la guía aquí.')}</p>}
            </Card>
          )}
          {d.returnShipment && (
            <Card className="p-5 text-sm">
              <h3 className="flex items-center gap-2 font-bold"><Truck className="size-4 text-brand-600" /> {t('Envío de la devolución')}</h3>
              <p className="mt-2">{d.returnShipment.carrier}{d.returnShipment.trackingNumber ? ` · ${t('Guía')} ${d.returnShipment.trackingNumber}` : ''}</p>
              <p className="text-xs text-muted">{fmtDateTime(d.returnShipment.shippedAt)}</p>
            </Card>
          )}
          <Card className="p-5 text-sm">
            <h3 className="flex items-center gap-2 font-bold"><CreditCard className="size-4 text-brand-600" /> {t('Reembolso')}</h3>
            {refund ? (
              <div className="mt-2 space-y-1" data-refund>
                <div className="flex justify-between"><span className="text-muted">{t('Productos')}</span><span>{money(refund.product, cur)}</span></div>
                {Number(refund.tax) > 0 && <div className="flex justify-between"><span className="text-muted">{t('Impuestos')}</span><span>{money(refund.tax, cur)}</span></div>}
                {Number(refund.shipping) > 0 && <div className="flex justify-between"><span className="text-muted">{t('Envío')}</span><span>{money(refund.shipping, cur)}</span></div>}
                <div className="flex justify-between border-t border-line pt-2 text-base font-extrabold"><span>{t('Total reembolsado')}</span><span>{money(refund.amount, cur)}</span></div>
                <p className="text-xs text-muted">{refund.number} · {fmtDateTime(refund.completedAt)} · {refund.provider === 'STRIPE' ? t('Tarjeta') : refund.provider === 'PAYPAL' ? 'PayPal' : t('Transferencia')}</p>
                {role === 'staff' && refund.providerRefundId && <p className="break-all text-xs text-muted">{t('Referencia del procesador')}: {refund.providerRefundId}</p>}
              </div>
            ) : ['REJECTED', 'CANCELLED'].includes(d.status) ? (
              <p className="mt-2 text-muted">{t('Sin reembolso.')}</p>
            ) : d.status === 'CLOSED' ? (
              <p className="mt-2 text-muted">{t('La inspección no aceptó unidades para reembolso.')}</p>
            ) : (
              <>
                <p className="mt-2">{t('Estimado')}: <b>{money(estimate, cur)}</b></p>
                <p className="mt-1 text-xs text-muted">{t('Se devuelve el precio de los productos aceptados y sus impuestos al mismo medio de pago. El envío original no se reembolsa.')}</p>
                {role === 'staff' && d.refunds?.some((r: any) => r.error) && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{t('Último intento fallido')}: {d.refunds.find((r: any) => r.error).error}</p>}
              </>
            )}
          </Card>
          {d.history?.length > 0 && (
            <Card className="p-5 text-sm">
              <h3 className="font-bold">{t('Historial')}</h3>
              <ol className="mt-3 space-y-3 border-l-2 border-line pl-4">
                {d.history.map((h: any, i: number) => (
                  <li key={i} className="relative"><span className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-brand-600" /><p className="font-semibold">{t(h.toLabel ?? h.to)}</p><p className="text-xs text-muted">{fmtDateTime(h.at)}</p></li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      </div>

      <ApproveDialog open={dialog === 'approve'} d={d} busy={busy === 'approve'} onClose={() => setDialog(null)} onSubmit={(b) => run('approve', 'approve', b, 'Devolución aprobada.')} />
      <RejectDialog open={dialog === 'reject'} busy={busy === 'reject'} onClose={() => setDialog(null)} onSubmit={(b) => run('reject', 'reject', b, 'Devolución rechazada.')} />
      <ShipDialog open={dialog === 'ship'} busy={busy === 'ship'} onClose={() => setDialog(null)} onSubmit={(b) => run('ship', 'shipped', b, 'Guía registrada. Avisamos a la tienda.')} />
      <InspectDialog open={dialog === 'inspect'} d={d} busy={busy === 'inspect'} onClose={() => setDialog(null)} onSubmit={(b) => run('inspect', 'inspect', b, 'Inspección registrada.')} />
      <RefundDialog open={dialog === 'refund'} d={d} estimate={estimate} busy={busy === 'refund'} onClose={() => setDialog(null)} onSubmit={(b) => run('refund', 'refund', b, 'Reembolso completado.')} />
      <Dialog open={dialog === 'cancel'} onOpenChange={(o) => !o && setDialog(null)} title={t('¿Cancelar la devolución?')} description={t('Podrás volver a solicitarla mientras siga dentro del plazo.')}
        footer={<><Button variant="outline" onClick={() => setDialog(null)}>{t('Volver')}</Button><Button variant="danger" loading={busy === 'cancel'} onClick={() => run('cancel', 'cancel', {}, 'Devolución cancelada.')}>{t('Sí, cancelar')}</Button></>}>
        <span />
      </Dialog>
    </div>
  );
}

function Actions({ role, d, busy, setDialog, run }: { role: ReturnRole; d: any; busy: string | null; setDialog: (v: any) => void; run: (k: string, p: string, b: unknown, ok: string) => void }) {
  const can = d.can ?? {};
  const buttons: React.ReactNode[] = [];
  if (can.ship) buttons.push(<Button key="ship" onClick={() => setDialog('ship')}><Truck /> {t('Ya envié el paquete')}</Button>);
  if (can.cancel) buttons.push(<Button key="cancel" variant="outline" onClick={() => setDialog('cancel')}><X /> {t('Cancelar solicitud')}</Button>);
  if (can.review) {
    buttons.push(<Button key="approve" onClick={() => setDialog('approve')}><Check /> {t('Aprobar devolución')}</Button>);
    buttons.push(<Button key="reject" variant="outline" onClick={() => setDialog('reject')}><X /> {t('Rechazar')}</Button>);
  }
  if (can.receive) buttons.push(<Button key="receive" loading={busy === 'receive'} onClick={() => run('receive', 'receive', {}, 'Devolución marcada como recibida.')}><PackageOpen /> {t('Marcar como recibida')}</Button>);
  if (can.inspect) buttons.push(<Button key="inspect" onClick={() => setDialog('inspect')}><ClipboardCheck /> {t('Registrar inspección')}</Button>);
  if (can.refund) buttons.push(<Button key="refund" onClick={() => setDialog('refund')}><CreditCard /> {t('Reembolsar al cliente')}</Button>);
  const hint =
    role === 'customer'
      ? { REQUESTED: 'La tienda revisará tu solicitud en un máximo de 2 días hábiles.', AWAITING_SHIPMENT: 'Envía el paquete a la dirección indicada y registra la guía.', IN_TRANSIT: 'La tienda confirmará cuando reciba el paquete.', RECEIVED: 'La tienda está revisando los productos.', REFUND_PENDING: 'Estamos procesando tu reembolso.' }[d.status as string]
      : role === 'seller'
        ? { REQUESTED: 'Revisa el motivo y las fotos antes de aprobar o rechazar.', AWAITING_SHIPMENT: 'Esperando que el cliente envíe el paquete.', IN_TRANSIT: 'Marca la devolución como recibida cuando llegue el paquete.', RECEIVED: 'Revisa los productos y registra cuántas unidades aceptas.', REFUND_PENDING: 'El equipo de finanzas reembolsará al cliente y descontará el monto de tu balance.' }[d.status as string]
        : { REFUND_PENDING: 'Al reembolsar se devuelve el dinero por el medio de pago original y se registra el asiento contable.' }[d.status as string];
  if (!buttons.length && !hint) return null;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
      {hint && <p className="flex flex-1 items-center gap-2 text-sm text-muted"><Info className="size-4 shrink-0 text-brand-600" /> {t(hint)}</p>}
      {buttons}
    </div>
  );
}

function ApproveDialog({ open, d, busy, onClose, onSubmit }: { open: boolean; d: any; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  useEffect(() => { if (open) setQty(Object.fromEntries(d.items.map((i: any) => [i.id, i.requested]))); }, [open, d]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('Aprobar devolución')} description={t('Puedes aprobar todas las unidades o solo una parte.')} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>{t('Cancelar')}</Button><Button loading={busy} onClick={() => onSubmit({ items: d.items.map((i: any) => ({ returnItemId: i.id, quantity: qty[i.id] ?? 0 })), comment: comment.trim() || undefined })}><Check /> {t('Aprobar')}</Button></>}>
      <div className="space-y-3">
        {d.items.map((i: any) => (
          <div key={i.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm">
            <span className="min-w-0"><b className="block truncate">{i.title}</b><span className="text-muted">{t('Solicitadas')}: {i.requested}</span></span>
            <Select value={String(qty[i.id] ?? i.requested)} onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })} className="w-24" aria-label={t('Unidades aprobadas')}>
              {Array.from({ length: i.requested + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </div>
        ))}
        <Field label={t('Nota para el cliente')} hint={t('(opcional)')}><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder={t('Ej. Incluye la factura dentro del paquete.')} /></Field>
      </div>
    </Dialog>
  );
}

function RejectDialog({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('Rechazar devolución')} description={t('El cliente verá este motivo y podrá abrir un reporte si no está de acuerdo.')}
      footer={<><Button variant="outline" onClick={onClose}>{t('Cancelar')}</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={() => onSubmit({ reason: reason.trim() })}>{t('Rechazar')}</Button></>}>
      <Field label={t('Motivo')} required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t('Ej. El producto muestra señales de uso que no corresponden a un defecto.')} /></Field>
    </Dialog>
  );
}

function ShipDialog({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('Registrar el envío de la devolución')} description={t('Indica con qué transportadora enviaste el paquete y el número de guía.')}
      footer={<><Button variant="outline" onClick={onClose}>{t('Cancelar')}</Button><Button loading={busy} disabled={carrier.trim().length < 2} onClick={() => onSubmit({ carrier: carrier.trim(), trackingNumber: tracking.trim() || undefined })}><Truck /> {t('Guardar')}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Transportadora')} required><Input rule="businessName" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder={t('Ej. USPS, DHL, FedEx')} maxLength={80} /></Field>
        <Field label={t('Número de guía')} hint={t('(recomendado)')}><Input rule="trackingNumber" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Ej. 9400111899223" /></Field>
      </div>
    </Dialog>
  );
}

function InspectDialog({ open, d, busy, onClose, onSubmit }: { open: boolean; d: any; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const items = useMemo(() => d.items.filter((i: any) => Number(i.received) > 0), [d]);
  const [rows, setRows] = useState<Record<string, { accepted: number; restock: number; condition: string }>>({});
  const [notes, setNotes] = useState('');
  useEffect(() => { if (open) setRows(Object.fromEntries(items.map((i: any) => [i.id, { accepted: i.received, restock: i.received, condition: 'OPENED' }]))); }, [open, items]);
  const set = (id: string, k: 'accepted' | 'restock' | 'condition', v: any) =>
    setRows((r) => {
      const n = { ...r[id], [k]: v };
      if (k === 'accepted' && n.restock > v) n.restock = v;
      if (k === 'condition' && v === 'DAMAGED') n.restock = 0;
      return { ...r, [id]: n };
    });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('Inspección de la devolución')} description={t('Las unidades aceptadas se reembolsan al cliente; las repuestas vuelven a tu inventario.')} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>{t('Cancelar')}</Button><Button loading={busy} onClick={() => onSubmit({ items: items.map((i: any) => ({ returnItemId: i.id, ...rows[i.id] })), notes: notes.trim() || undefined })}><ClipboardCheck /> {t('Guardar inspección')}</Button></>}>
      <div className="space-y-3">
        {items.map((i: any) => {
          const r = rows[i.id] ?? { accepted: i.received, restock: i.received, condition: 'OPENED' };
          return (
            <div key={i.id} className="rounded-lg border border-line p-3 text-sm" data-inspect-item>
              <p className="font-bold">{i.title} <span className="font-normal text-muted">· {t('Recibidas')}: {i.received}</span></p>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <Field label={t('Estado del producto')}><Select value={r.condition} onChange={(e) => set(i.id, 'condition', e.target.value)}>{CONDITIONS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</Select></Field>
                <Field label={t('Unidades aceptadas')}><Select value={String(r.accepted)} onChange={(e) => set(i.id, 'accepted', Number(e.target.value))} data-inspect="accepted">{Array.from({ length: i.received + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
                <Field label={t('Reponer al inventario')}><Select value={String(r.restock)} onChange={(e) => set(i.id, 'restock', Number(e.target.value))} data-inspect="restock">{Array.from({ length: r.accepted + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
              </div>
              {r.accepted < i.received && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle className="size-3.5" /> {t('{n} unidad(es) no se reembolsarán.', { n: i.received - r.accepted })}</p>}
            </div>
          );
        })}
        <Field label={t('Notas de la inspección')} hint={t('(opcional)')}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
      </div>
    </Dialog>
  );
}

function RefundDialog({ open, d, estimate, busy, onClose, onSubmit }: { open: boolean; d: any; estimate: number; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [ref, setRef] = useState('');
  const accepted = d.items.reduce((s: number, i: any) => s + Number(i.accepted ?? 0), 0);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('Reembolsar al cliente')}
      description={accepted ? t('Se devolverá el precio de {n} unidad(es) aceptadas más sus impuestos por el medio de pago original.', { n: accepted }) : t('La inspección no aceptó unidades: la devolución se cerrará sin reembolso.')}
      footer={<><Button variant="outline" onClick={onClose}>{t('Cancelar')}</Button><Button loading={busy} onClick={() => onSubmit(ref.trim() ? { manualReference: ref.trim() } : {})}><CreditCard /> {accepted ? t('Confirmar reembolso') : t('Cerrar sin reembolso')}</Button></>}>
      <div className="space-y-3 text-sm">
        {accepted > 0 && <p className="rounded-lg bg-surface p-3">{t('Monto estimado de productos')}: <b>{money(estimate, d.currency)}</b> <span className="text-muted">{t('(+ impuestos)')}</span></p>}
        <Field label={t('Referencia de la transferencia')} hint={t('Solo si el pedido se pagó por transferencia bancaria')}>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ej. TRX-2026-00125" maxLength={60} />
        </Field>
        <p className="text-xs text-muted">{t('Pagos con tarjeta o PayPal se reembolsan automáticamente. El monto del vendedor y la comisión se revierten en la contabilidad.')}</p>
      </div>
    </Dialog>
  );
}
