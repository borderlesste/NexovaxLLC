'use client';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, Check, CheckCircle2, Clock, Copy, CreditCard, Download, Headphones, MapPin, MessageSquare, Package, PackageCheck, Phone, RefreshCw, RotateCcw, Star, Store, Tag, Truck, User, Zap,
} from 'lucide-react';
import { countryName, t } from '@/lib/i18n';
import { cityLine } from '@/components/shop/geo-fields';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { cn, fmtDateTime, money } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, Empty } from '@/components/ui/misc';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { ProductImage } from '@/components/shop/product-card';

type Role = 'customer' | 'seller' | 'admin';

const STEP_ICONS = [Check, Package, Truck, Truck, PackageCheck];

export function OrderDetailView({ order, role, onChanged }: { order: any; role: Role; onChanged: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [shipFor, setShipFor] = useState<any>(null);
  const [trackFor, setTrackFor] = useState<any>(null);
  const [reviewFor, setReviewFor] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const first = order.sellerOrders[0]?.items[0];
  const allShipments = order.sellerOrders.flatMap((so: any) => so.shipments.map((s: any) => ({ ...s, seller: so.seller })));
  const events = allShipments
    .flatMap((s: any) => s.events.map((e: any) => ({ ...e, seller: s.seller.name })))
    .sort((a: any, b: any) => +new Date(b.at) - +new Date(a.at));
  const lastEvent = events[0];

  const act = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      onChanged();
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const contactSeller = async (so: any) => {
    try {
      const r = await post('/conversations', { orderId: order.id, sellerId: so.seller.id, message: t('Hola, tengo una consulta sobre mi pedido {n}.', { n: order.number }) });
      router.push(`/cuenta/mensajes?c=${r.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success(t('Copiado.')));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        {/* summary */}
        <div className="card grid gap-5 p-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex gap-4">
            <ProductImage src={first?.imageUrl} alt={first?.title ?? ''} className="size-28 shrink-0 rounded-2xl bg-surface" />
            <div className="min-w-0 space-y-1.5 text-sm">
              <p className="text-xl font-extrabold">{first?.title ?? t('Pedido')}{order.sellerOrders.reduce((a: number, s: any) => a + s.items.length, 0) > 1 ? t(' y más') : ''}</p>
              <p className="inline-flex items-center gap-2 rounded-lg bg-brand-50 px-2 py-1 font-bold text-brand-700">{t('Pedido:')}{' '}{order.number} <button onClick={() => copy(order.number)} aria-label={t('Copiar')}><Copy className="size-4" /></button></p>
              <p className="flex items-center gap-2"><Store className="size-4 text-muted" /> {t('Vendedor:')}{' '}<span className="font-semibold text-brand-700">{order.sellerOrders.map((s: any) => s.seller.name).join(', ')}</span></p>
              <p className="flex items-center gap-2"><User className="size-4 text-muted" /> {t('Comprador:')}{' '}{order.customer.name}</p>
              <p className="flex items-center gap-2"><Clock className="size-4 text-muted" /> {t('Fecha de compra:')}{' '}{fmtDateTime(order.placedAt)}</p>
            </div>
          </div>
          <div className="space-y-2 border-line text-sm md:border-l md:pl-5">
            {order.sellerOrders.map((so: any) => (
              <p key={so.id} className="flex items-center gap-2"><Truck className="size-4 text-muted" /> {t('Método de envío:')}{' '}<b>{t(so.shippingMethod.name ?? '—')}</b>{order.sellerOrders.length > 1 ? ` (${so.seller.name})` : ''}</p>
            ))}
            {order.shippingAddress && (
              <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted" /><span>{t('Dirección de entrega:')}<br /><span className="text-muted">{order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''} · {cityLine(order.shippingAddress)}</span></span></p>
            )}
            <p className="flex items-center gap-2"><CreditCard className="size-4 text-muted" /> {t('Pago:')}{' '}<b>{!order.payment?.method ? (order.payment?.status === 'PAID' ? t('Pagado') : t('Pendiente')) : order.payment.method === 'BANK_TRANSFER' ? t('Transferencia bancaria') : order.payment.method === 'PAYPAL' ? 'PayPal' : order.payment.brand ? `${order.payment.brand} •••• ${order.payment.last4}` : t('Tarjeta')}</b></p>
            <p className="flex items-center gap-2">{t('Estado:')}{' '}<StatusBadge status={order.status === 'PAID' ? 'PAID' : order.fulfillmentStatus === 'DELIVERED' ? 'DELIVERED' : order.fulfillmentStatus} /></p>
          </div>
        </div>

        {/* progress */}
        <div className="card overflow-x-auto bg-brand-50/40 p-5">
          <ol className="flex min-w-[560px] items-start justify-between">
            {order.timeline.steps.map((s: any, i: number) => {
              const Icon = STEP_ICONS[i];
              const current = order.timeline.current === s.code;
              return (
                <li key={s.code} className="relative flex flex-1 flex-col items-center text-center">
                  {i > 0 && <span className={cn('absolute right-1/2 top-6 h-0.5 w-full', s.done ? 'bg-brand-600' : 'bg-line')} />}
                  <span className={cn('relative z-10 grid size-12 place-items-center rounded-full border-2', current ? 'border-brand-600 bg-brand-600 text-white ring-4 ring-brand-100' : s.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line bg-white text-muted')}>
                    {s.done && !current ? <Check className="size-5" /> : <Icon className="size-5" />}
                  </span>
                  <span className={cn('mt-2 text-sm font-semibold', current && 'rounded-lg bg-brand-100 px-2 text-brand-700')}>{t(s.label)}</span>
                  {s.at && <span className="text-[11px] text-muted">{fmtDateTime(s.at)}</span>}
                </li>
              );
            })}
          </ol>
        </div>

        {/* items per seller */}
        {order.sellerOrders.map((so: any) => (
          <div key={so.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <p className="flex items-center gap-2 font-bold"><Store className="size-4 text-brand-600" /> {so.seller.name} <span className="text-sm font-normal text-muted">· {so.number}</span></p>
                <p className="text-xs text-muted">{t(so.shippingMethod.name ?? '')} {so.shippingMethod.estimatedDays ? `· ${t('{n} días hábiles', { n: so.shippingMethod.estimatedDays })}` : ''}{so.origin ? ` · ${t('Despacha desde {place}', { place: [so.origin.city, countryName(so.origin.countryCode)].filter(Boolean).join(', ') })}` : ''}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={so.fulfillmentStatus} />
                {role === 'seller' && so.fulfillmentStatus === 'UNFULFILLED' && order.paymentStatus === 'PAID' && (
                  <Button size="sm" loading={busy === `prep-${so.id}`} onClick={() => act(`prep-${so.id}`, () => post(`/seller/seller-orders/${so.id}/prepare`), t('Pedido marcado en preparación.'))}><Package /> {t('Marcar en preparación')}</Button>
                )}
                {role === 'seller' && ['FULFILLED', 'PARTIALLY_FULFILLED'].includes(so.fulfillmentStatus) && (
                  <Button size="sm" onClick={() => setShipFor(so)}><Truck /> {t('Registrar envío')}</Button>
                )}
                {role === 'customer' && <Button size="sm" variant="outline" onClick={() => contactSeller(so)}><MessageSquare /> {t('Contactar vendedor')}</Button>}
                {role === 'customer' && so.items.some((i: any) => i.delivered > 0) && (
                  <Button size="sm" variant="outline" asChild><Link href={`/cuenta/devoluciones/nueva?pedido=${order.id}&tienda=${so.id}`} data-request-return><RotateCcw /> {t('Solicitar devolución')}</Link></Button>
                )}
              </div>
            </div>
            <ul className="divide-y divide-line">
              {so.items.map((i: any) => (
                <li key={i.id} className="flex items-center gap-4 px-5 py-4">
                  <ProductImage src={i.imageUrl} alt={i.title} className="size-16 shrink-0 rounded-xl bg-surface" />
                  <div className="min-w-0 flex-1 text-sm">
                    <Link href={`/producto/${i.slug}`} className="font-semibold hover:text-brand-700">{i.title}</Link>
                    <p className="text-muted">{Object.entries(i.attributes ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || i.sku} {t('· Cant.')}{' '}{i.quantity}</p>
                    {role !== 'customer' && <p className="text-xs text-muted">{t('SKU')}{' '}{i.sku} {t('· preparado')}{' '}{i.fulfilled}/{i.quantity} {t('· enviado')}{' '}{i.shipped} {t('· entregado')}{' '}{i.delivered}</p>}
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-bold">{money(i.lineTotal, order.currency)}</p>
                    {role === 'customer' && i.delivered > 0 && (
                      <button onClick={() => setReviewFor(i)} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-700"><Star className="size-3.5" /> {i.reviewed ? t('Editar opinión') : t('Opinar')}</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {so.shipments.map((s: any) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/60 px-5 py-3 text-sm">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Truck className="size-4 text-brand-600" /> <b>{t(s.service || s.carrier || '')}</b> · {t('Guía')} <b>{s.trackingNumber}</b>
                  <StatusBadge status={s.trackingStatus} />
                  {s.automaticTracking && <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700"><Zap className="size-3" /> {t('Rastreo automático')}</span>}
                  {s.trackingUrl && (
                    <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-700 underline"
                      title={s.trackingUrlExternal ? t('Enlace externo proporcionado por la tienda') : undefined}>
                      {t('Rastrear en la transportadora')}{s.trackingUrlExternal && s.trackingHost ? ` (${t('sitio externo')}: ${s.trackingHost})` : ''}
                    </a>
                  )}
                  {s.label?.url && (
                    <a href={s.label.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-700 underline">
                      <Download className="size-3.5" /> {t('Etiqueta')}{s.label.test ? ` (${t('prueba')})` : ''}
                    </a>
                  )}
                  {s.label?.invoiceUrl && <a href={s.label.invoiceUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">{t('Factura comercial')}</a>}
                  {s.label?.cost && role !== 'customer' && <span className="text-xs text-muted">{t('Costo de etiqueta')}: {money(s.label.cost, s.label.currency)}</span>}
                </span>
                <span className="flex gap-2">
                  {s.automaticTracking && s.trackingStatus !== 'DELIVERED' && (role !== 'admin' || can('orders.tracking')) && (
                    <Button size="sm" variant="outline" loading={busy === `sync-${s.id}`}
                      onClick={() => act(`sync-${s.id}`, () => post(`${role === 'customer' ? '/orders' : role === 'admin' ? '/admin' : '/seller'}/shipments/${s.id}/refresh-tracking`), t('Seguimiento actualizado.'))}>
                      <RefreshCw /> {t('Actualizar rastreo')}
                    </Button>
                  )}
                  {(role === 'seller' || (role === 'admin' && can('orders.tracking'))) && !s.automaticTracking && s.trackingStatus !== 'DELIVERED' && <Button size="sm" variant="outline" onClick={() => setTrackFor(s)}>{t('Actualizar seguimiento')}</Button>}
                  {role === 'customer' && s.trackingStatus !== 'DELIVERED' && (
                    <Button size="sm" loading={busy === `rcv-${s.id}`} onClick={() => act(`rcv-${s.id}`, () => post(`/orders/shipments/${s.id}/confirm-delivery`), t('¡Gracias! Confirmaste la recepción.'))}><CheckCircle2 /> {t('Confirmar recepción')}</Button>
                  )}
                </span>
              </div>
            ))}
            <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-line px-5 py-3 text-sm">
              <span className="text-muted">{t('Productos')}{' '}<b className="text-ink">{money(so.totals.subtotal, order.currency)}</b></span>
              <span className="text-muted">{t('Envío')}{' '}<b className="text-ink">{money(so.totals.shipping, order.currency)}</b></span>
              <span className="text-muted">{order.tax?.name ?? t('Impuestos')} <b className="text-ink">{money(so.totals.tax, order.currency)}</b></span>
              {so.totals.commission !== undefined && <span className="text-muted">{t('Comisión')}{' '}<b className="text-red-600">-{money(so.totals.commission, order.currency)}</b></span>}
              {so.totals.sellerNet !== undefined && <span className="text-muted">{t('Neto vendedor')}{' '}<b className="text-emerald-700">{money(so.totals.sellerNet, order.currency)}</b></span>}
              <span className="font-bold">{t('Total')}{' '}{money(so.totals.total, order.currency)}</span>
            </div>
          </div>
        ))}

        {/* events */}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="card p-5">
            <p className="flex items-center gap-2 text-lg font-bold"><Clock className="size-5 text-brand-600" /> {t('Historial de eventos')}</p>
            {events.length === 0 && order.paidAt ? (
              <ul className="mt-4 space-y-3 text-sm">
                <li className="flex gap-3"><CheckCircle2 className="size-5 text-emerald-500" /><span><b>{t('Pago confirmado')}</b><br /><span className="text-muted">{fmtDateTime(order.paidAt)}</span></span></li>
              </ul>
            ) : (
              <ol className="relative mt-4 space-y-4 border-l-2 border-brand-200 pl-5">
                {events.map((e: any, i: number) => (
                  <li key={i} className="relative text-sm">
                    <span className={cn('absolute -left-[27px] top-0.5 grid size-5 place-items-center rounded-full', i === 0 ? 'bg-brand-600 text-white' : 'bg-emerald-500 text-white')}><Check className="size-3" /></span>
                    <p className="font-bold">{t(e.label)}</p>
                    <p className="text-muted">{e.detail ? t(e.detail) : ''}{e.city ? ` · ${e.city}` : ''}</p>
                    <p className="text-xs text-muted">{fmtDateTime(e.at)}</p>
                  </li>
                ))}
                {order.paidAt && (
                  <li className="relative text-sm">
                    <span className="absolute -left-[27px] top-0.5 grid size-5 place-items-center rounded-full bg-emerald-500 text-white"><Check className="size-3" /></span>
                    <p className="font-bold">{t('Pago confirmado')}</p><p className="text-muted">{t('Tu pago fue procesado correctamente.')}</p><p className="text-xs text-muted">{fmtDateTime(order.paidAt)}</p>
                  </li>
                )}
              </ol>
            )}
          </div>
          <RouteCard order={order} lastEvent={lastEvent} />
        </div>
      </div>

      {/* side */}
      <aside className="space-y-4">
        <div className="card p-5">
          <p className="flex items-center gap-2 text-lg font-bold"><Truck className="size-5 text-brand-600" /> {t('Datos del envío')}</p>
          <dl className="mt-3 space-y-3 text-sm">
            {allShipments.length ? allShipments.map((s: any) => (
              <div key={s.id} className="space-y-1">
                <div className="flex justify-between gap-3"><dt className="text-muted">{t('Transportista')}</dt><dd className="text-right font-semibold">{t(s.service || s.carrier || '')}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">{t('Número de guía')}</dt><dd className="flex items-center gap-1 font-semibold">{s.trackingNumber} <button onClick={() => copy(s.trackingNumber)} aria-label={t('Copiar')}><Copy className="size-3.5" /></button></dd></div>
              </div>
            )) : <p className="text-muted">{t('El vendedor aún no ha despachado el pedido.')}</p>}
            {order.shippingAddress && (
              <>
                <div><dt className="text-muted">{t('Dirección de entrega')}</dt><dd className="font-semibold">{order.shippingAddress.recipientName}<br />{order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}<br /><span className="font-normal text-muted">{cityLine(order.shippingAddress)}</span></dd></div>
                {order.shippingAddress.phone && <div className="flex items-center gap-2"><Phone className="size-4 text-muted" /> {order.shippingAddress.phone}</div>}
              </>
            )}
          </dl>
          {role === 'customer' && <Button className="mt-4 w-full" asChild><Link href={`/ayuda/reportar?pedido=${order.number}&tipo=SHIPPING`}><Headphones /> {t('Contactar soporte')}</Link></Button>}
        </div>
        <div className="card p-5">
          <p className="text-lg font-bold">{t('Resumen de pago')}</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt>{t('Productos')}</dt><dd>{money(order.totals.subtotal, order.currency)}</dd></div>
            <div className="flex justify-between"><dt>{t('Envío')}</dt><dd>{money(order.totals.shipping, order.currency)}</dd></div>
            <div className="flex justify-between"><dt>{order.tax?.name ?? t('Impuestos')}{order.tax?.rate ? ` (${+(order.tax.rate * 100).toFixed(2)} %)` : ''}</dt><dd>{money(order.totals.tax, order.currency)}</dd></div>
            {order.totals.commission !== undefined && <div className="flex justify-between text-muted"><dt>{t('Comisión plataforma')}</dt><dd>{money(order.totals.commission, order.currency)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-2 text-base font-extrabold"><dt>{t('Total')}</dt><dd>{money(order.totals.total, order.currency)}</dd></div>
          </dl>
        </div>
        <div className="card p-5">
          <p className="text-lg font-bold">{t('Incidencias y mensajes')}</p>
          <div className="mt-3 flex items-start gap-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="size-5 shrink-0" /><span><b>{t('Estado: sin incidencias.')}</b><br />{t('El pedido avanza según lo programado.')}</span></div>
          {role === 'customer' && <Button variant="outline" className="mt-3 w-full" asChild><Link href={`/ayuda/reportar?pedido=${order.number}`}><AlertCircle /> {t('Reportar un problema')}</Link></Button>}
        </div>
      </aside>

      {shipFor && <ShipDialog so={shipFor} onClose={() => setShipFor(null)} onDone={() => { setShipFor(null); onChanged(); }} />}
      {trackFor && <TrackingDialog shipment={trackFor} role={role} onClose={() => setTrackFor(null)} onDone={() => { setTrackFor(null); onChanged(); }} />}
      {reviewFor && <ReviewDialog item={reviewFor} onClose={() => setReviewFor(null)} onDone={() => { setReviewFor(null); onChanged(); }} />}
    </div>
  );
}

function ShipDialog({ so, onClose, onDone }: { so: any; onClose: () => void; onDone: () => void }) {
  const viaShippo = so.shippingMethod.provider === 'SHIPPO';
  const [mode, setMode] = useState<'LABEL' | 'MANUAL'>(viaShippo ? 'LABEL' : 'MANUAL');
  const [carriers, setCarriers] = useState<any[]>([]);
  const [f, setF] = useState({ carrierCode: so.shippingMethod.code === 'PICKUP' ? 'PICKUP' : '', carrierName: '', trackingNumber: '', trackingUrl: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  useEffect(() => {
    get('/seller/carriers').then((c) => {
      setCarriers(c);
      setF((s) => ({ ...s, carrierCode: s.carrierCode || c[0]?.code || '' }));
    }).catch(() => undefined);
  }, []);
  const internal = ['OWN_DELIVERY', 'PICKUP'].includes(f.carrierCode);
  const submit = async () => {
    setBusy(true);
    try {
      const body = mode === 'LABEL'
        ? { mode }
        : { mode, carrierCode: f.carrierCode, carrierName: f.carrierName || undefined, trackingNumber: f.trackingNumber || undefined, trackingUrl: f.trackingUrl || undefined };
      const r = await post(`/seller/seller-orders/${so.id}/ship`, body);
      if (mode === 'LABEL') {
        setResult(r.shipments?.[0] ?? null);
        toast.success(t('Etiqueta comprada. El cliente fue notificado.'));
      } else {
        toast.success(t('Envío registrado. El cliente fue notificado.'));
        onDone();
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (result)
    return (
      <Dialog open onOpenChange={(o) => !o && onDone()} title={t('Etiqueta lista')} description={`${so.number} · ${result.carrier} ${result.service}`}
        footer={<Button onClick={onDone}>{t('Listo')}</Button>}>
        <div className="space-y-3 text-sm">
          <p>{t('Guía')}: <b>{result.trackingNumber}</b></p>
          <p>{t('Costo de etiqueta')}: <b>{money(result.cost, result.currency)}</b></p>
          {result.labelUrl && <Button asChild className="w-full"><a href={result.labelUrl} target="_blank" rel="noreferrer"><Download /> {t('Descargar etiqueta (PDF)')}</a></Button>}
          <p className="text-muted">{t('Imprime la etiqueta, pégala en el paquete y entrégalo a la transportadora. El rastreo se actualizará automáticamente.')}</p>
        </div>
      </Dialog>
    );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('Registrar envío')} description={`${so.number} · ${t(so.shippingMethod.name ?? '')}`}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Cancelar')}</Button><Button onClick={submit} loading={busy}>{mode === 'LABEL' ? <><Tag /> {t('Comprar etiqueta')}</> : <><Truck /> {t('Confirmar despacho')}</>}</Button></>}>
      <div className="grid gap-4">
        {viaShippo && (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface p-1 text-sm font-semibold">
            {(['LABEL', 'MANUAL'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={cn('rounded-lg px-3 py-2', mode === m ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}>
                {m === 'LABEL' ? t('Etiqueta con Shippo') : t('Guía manual')}
              </button>
            ))}
          </div>
        )}
        {mode === 'LABEL' ? (
          <div className="space-y-2 rounded-xl bg-brand-50 p-4 text-sm text-brand-900">
            <p><b>{so.shippingMethod.name}</b></p>
            <p>{t('Compraremos la etiqueta del servicio que pagó el cliente con la cuenta de envíos del marketplace. Se generará el número de guía y el rastreo será automático.')}</p>
          </div>
        ) : (
          <>
            <Field label={t('Transportadora')} required>
              <Select value={f.carrierCode} onChange={(e) => setF({ ...f, carrierCode: e.target.value })}>
                {carriers.map((c) => <option key={c.code} value={c.code}>{t(c.name)}</option>)}
              </Select>
            </Field>
            {f.carrierCode === 'OTHER' && <Field label={t('Nombre de la transportadora')} required><Input rule="businessName" value={f.carrierName} onChange={(e) => setF({ ...f, carrierName: e.target.value })} /></Field>}
            <Field label={t('Número de guía')} required={!internal} hint={internal ? t('(opcional: generamos una referencia interna)') : undefined}>
              <Input rule="trackingNumber" value={f.trackingNumber} onChange={(e) => setF({ ...f, trackingNumber: e.target.value })} placeholder={t('1Z999AA10123456784')} />
            </Field>
            {['OTHER', 'SERVIENTREGA', 'VIMENCA'].includes(f.carrierCode) && <Field label={t('Enlace de rastreo')} hint={t('(opcional, solo https)')}><Input value={f.trackingUrl} onChange={(e) => setF({ ...f, trackingUrl: e.target.value })} placeholder={t('https://…')} /></Field>}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Real shipment route: origin → destination with the latest carrier event (replaces a decorative map). */
function RouteCard({ order, lastEvent }: { order: any; lastEvent: any }) {
  const so = order.sellerOrders[0];
  const sh = so?.shipments?.[0];
  const from = sh?.from?.countryCode ? sh.from : so?.origin;
  const to = order.shippingAddress;
  const steps = order.timeline.steps;
  const doneCount = steps.filter((s: any) => s.done).length;
  const progress = Math.max(0.06, Math.min(1, (doneCount - 1) / (steps.length - 1)));
  const place = (p: any) => [p?.city, countryName(p?.countryCode)].filter(Boolean).join(', ');
  return (
    <div className="card p-5">
      <p className="flex items-center gap-2 text-lg font-bold"><MapPin className="size-5 text-brand-600" /> {t('Ruta del paquete')}</p>
      <div className="mt-5 flex items-center gap-3">
        <div className="min-w-0 text-sm">
          <p className="text-xs font-semibold uppercase text-muted">{t('Origen')}</p>
          <p className="font-bold">{from ? place(from) : '—'}</p>
        </div>
        <div className="relative mx-2 h-2 flex-1 rounded-full bg-line">
          <span className="absolute inset-y-0 left-0 rounded-full bg-brand-600 transition-all" style={{ width: `${progress * 100}%` }} />
          <span className="absolute -top-2.5 grid size-7 -translate-x-1/2 place-items-center rounded-full bg-white shadow ring-2 ring-brand-600" style={{ left: `${progress * 100}%` }}>
            <Truck className="size-4 text-brand-600" />
          </span>
        </div>
        <div className="min-w-0 text-right text-sm">
          <p className="text-xs font-semibold uppercase text-muted">{t('Destino')}</p>
          <p className="font-bold">{to ? place(to) : '—'}</p>
        </div>
      </div>
      <div className="mt-5 flex items-center gap-3 rounded-xl bg-brand-50 p-3 text-sm">
        <Truck className="size-6 shrink-0 text-brand-600" />
        <div>
          <b>{lastEvent ? t(lastEvent.label) : order.paymentStatus === 'PAID' ? t('Esperando despacho del vendedor') : t('Esperando pago')}</b>
          <p className="text-muted">
            {lastEvent ? [lastEvent.detail ? t(lastEvent.detail) : null, lastEvent.city, fmtDateTime(lastEvent.at)].filter(Boolean).join(' · ') : t('Mostramos los eventos confirmados por la transportadora.')}
          </p>
        </div>
      </div>
    </div>
  );
}

function TrackingDialog({ shipment, role, onClose, onDone }: { shipment: any; role: Role; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ status: shipment.trackingStatus === 'IN_TRANSIT' ? 'OUT_FOR_DELIVERY' : 'IN_TRANSIT', detail: '', city: '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await post(`/${role === 'admin' ? 'admin' : 'seller'}/shipments/${shipment.id}/tracking`, { ...f, detail: f.detail || undefined, city: f.city || undefined });
      toast.success(t('Seguimiento actualizado.'));
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('Actualizar seguimiento')} description={t('Guía {a}', { a: shipment.trackingNumber })}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Cancelar')}</Button><Button onClick={submit} loading={busy}>{t('Guardar evento')}</Button></>}>
      <div className="grid gap-4">
        <Field label={t('Nuevo estado')} required>
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="IN_TRANSIT">{t('En tránsito')}</option><option value="OUT_FOR_DELIVERY">{t('Salió a entrega')}</option>{role === 'admin' && <option value="DELIVERED">{t('Entregado')}</option>}<option value="EXCEPTION">{t('Incidencia')}</option>
          </Select>
        </Field>
        {role !== 'admin' && <p className="text-xs text-muted">{t('La entrega la confirma el cliente o la transportista. Si el cliente no confirma, se cierra automáticamente tras el plazo de confirmación.')}</p>}
        <Field label={t('Detalle')}><Textarea rows={2} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} placeholder={t('Ej. El paquete llegó al centro de distribución.')} /></Field>
        <Field label={t('Ciudad')}><Input rule="placeName" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

function ReviewDialog({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await post(`/orders/items/${item.id}/review`, { rating, title: title || undefined, body: body || undefined });
      toast.success(t('¡Gracias por tu opinión!'));
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('Opinar sobre el producto')} description={item.title}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Cancelar')}</Button><Button onClick={submit} loading={busy}>{t('Publicar opinión')}</Button></>}>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setRating(n)} aria-label={`${n} estrellas`}><Star className={cn('size-8', n <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300')} /></button>)}
      </div>
      <Field label={t('Título')} className="mt-4"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
      <Field label={t('Tu opinión')} className="mt-3"><Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} /></Field>
    </Dialog>
  );
}

export function OrderNotFound() {
  return <div className="card"><Empty title={t('Pedido no encontrado')} /></div>;
}
