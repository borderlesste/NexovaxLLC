'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, Check, CheckCircle2, Clock, Copy, CreditCard, Headphones, MapPin, MessageSquare, Package, PackageCheck, Phone, Star, Store, Truck, User,
} from 'lucide-react';
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
      const r = await post('/conversations', { orderId: order.id, sellerId: so.seller.id, message: `Hola, tengo una consulta sobre mi pedido ${order.number}.` });
      router.push(`/mensajes?c=${r.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success('Copiado.'));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        {/* summary */}
        <div className="card grid gap-5 p-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex gap-4">
            <ProductImage src={first?.imageUrl} alt={first?.title ?? ''} className="size-28 shrink-0 rounded-2xl bg-surface" />
            <div className="min-w-0 space-y-1.5 text-sm">
              <p className="text-xl font-extrabold">{first?.title ?? 'Pedido'}{order.sellerOrders.reduce((a: number, s: any) => a + s.items.length, 0) > 1 ? ' y más' : ''}</p>
              <p className="inline-flex items-center gap-2 rounded-lg bg-brand-50 px-2 py-1 font-bold text-brand-700">Pedido: {order.number} <button onClick={() => copy(order.number)} aria-label="Copiar"><Copy className="size-4" /></button></p>
              <p className="flex items-center gap-2"><Store className="size-4 text-muted" /> Vendedor: <span className="font-semibold text-brand-700">{order.sellerOrders.map((s: any) => s.seller.name).join(', ')}</span></p>
              <p className="flex items-center gap-2"><User className="size-4 text-muted" /> Comprador: {order.customer.name}</p>
              <p className="flex items-center gap-2"><Clock className="size-4 text-muted" /> Fecha de compra: {fmtDateTime(order.placedAt)}</p>
            </div>
          </div>
          <div className="space-y-2 border-line text-sm md:border-l md:pl-5">
            {order.sellerOrders.map((so: any) => (
              <p key={so.id} className="flex items-center gap-2"><Truck className="size-4 text-muted" /> Método de envío: <b>{so.shippingMethod.name ?? '—'}</b>{order.sellerOrders.length > 1 ? ` (${so.seller.name})` : ''}</p>
            ))}
            {order.shippingAddress && (
              <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted" /><span>Dirección de entrega:<br /><span className="text-muted">{order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}, {order.shippingAddress.city}, R.D.</span></span></p>
            )}
            <p className="flex items-center gap-2"><CreditCard className="size-4 text-muted" /> Pago: <b>{order.payment?.method === 'BANK_TRANSFER' ? 'Transferencia bancaria' : order.payment?.brand ? `${order.payment.brand} •••• ${order.payment.last4}` : 'Tarjeta'}</b></p>
            <p className="flex items-center gap-2">Estado: <StatusBadge status={order.status === 'PAID' ? 'PAID' : order.fulfillmentStatus === 'DELIVERED' ? 'DELIVERED' : order.fulfillmentStatus} /></p>
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
                  <span className={cn('mt-2 text-sm font-semibold', current && 'rounded-lg bg-brand-100 px-2 text-brand-700')}>{s.label}</span>
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
                <p className="text-xs text-muted">{so.shippingMethod.name} {so.shippingMethod.estimatedDays ? `· ${so.shippingMethod.estimatedDays} días hábiles` : ''}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={so.fulfillmentStatus} />
                {role === 'seller' && so.fulfillmentStatus === 'UNFULFILLED' && order.paymentStatus === 'PAID' && (
                  <Button size="sm" loading={busy === `prep-${so.id}`} onClick={() => act(`prep-${so.id}`, () => post(`/seller/seller-orders/${so.id}/prepare`), 'Pedido marcado en preparación.')}><Package /> Marcar en preparación</Button>
                )}
                {role === 'seller' && ['FULFILLED', 'PARTIALLY_FULFILLED'].includes(so.fulfillmentStatus) && (
                  <Button size="sm" onClick={() => setShipFor(so)}><Truck /> Registrar envío</Button>
                )}
                {role === 'customer' && <Button size="sm" variant="outline" onClick={() => contactSeller(so)}><MessageSquare /> Contactar vendedor</Button>}
              </div>
            </div>
            <ul className="divide-y divide-line">
              {so.items.map((i: any) => (
                <li key={i.id} className="flex items-center gap-4 px-5 py-4">
                  <ProductImage src={i.imageUrl} alt={i.title} className="size-16 shrink-0 rounded-xl bg-surface" />
                  <div className="min-w-0 flex-1 text-sm">
                    <Link href={`/producto/${i.slug}`} className="font-semibold hover:text-brand-700">{i.title}</Link>
                    <p className="text-muted">{Object.entries(i.attributes ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || i.sku} · Cant. {i.quantity}</p>
                    {role !== 'customer' && <p className="text-xs text-muted">SKU {i.sku} · preparado {i.fulfilled}/{i.quantity} · enviado {i.shipped} · entregado {i.delivered}</p>}
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-bold">{money(i.lineTotal)}</p>
                    {role === 'customer' && i.delivered > 0 && (
                      <button onClick={() => setReviewFor(i)} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-700"><Star className="size-3.5" /> {i.reviewed ? 'Editar opinión' : 'Opinar'}</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {so.shipments.map((s: any) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/60 px-5 py-3 text-sm">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Truck className="size-4 text-brand-600" /> <b>{s.carrier}</b> · Guía <b>{s.trackingNumber}</b>
                  <StatusBadge status={s.trackingStatus === 'DELIVERED' ? 'DELIVERED' : s.trackingStatus} />
                  {s.trackingUrl && <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">Rastrear</a>}
                </span>
                <span className="flex gap-2">
                  {(role === 'seller' || role === 'admin') && s.trackingStatus !== 'DELIVERED' && <Button size="sm" variant="outline" onClick={() => setTrackFor(s)}>Actualizar seguimiento</Button>}
                  {role === 'customer' && s.trackingStatus !== 'DELIVERED' && (
                    <Button size="sm" loading={busy === `rcv-${s.id}`} onClick={() => act(`rcv-${s.id}`, () => post(`/orders/shipments/${s.id}/confirm-delivery`), '¡Gracias! Confirmaste la recepción.')}><CheckCircle2 /> Confirmar recepción</Button>
                  )}
                </span>
              </div>
            ))}
            <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-line px-5 py-3 text-sm">
              <span className="text-muted">Productos <b className="text-ink">{money(so.totals.subtotal)}</b></span>
              <span className="text-muted">Envío <b className="text-ink">{money(so.totals.shipping)}</b></span>
              <span className="text-muted">ITBIS <b className="text-ink">{money(so.totals.tax)}</b></span>
              {so.totals.commission !== undefined && <span className="text-muted">Comisión <b className="text-red-600">-{money(so.totals.commission)}</b></span>}
              {so.totals.sellerNet !== undefined && <span className="text-muted">Neto vendedor <b className="text-emerald-700">{money(so.totals.sellerNet)}</b></span>}
              <span className="font-bold">Total {money(so.totals.total)}</span>
            </div>
          </div>
        ))}

        {/* events */}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="card p-5">
            <p className="flex items-center gap-2 text-lg font-bold"><Clock className="size-5 text-brand-600" /> Historial de eventos</p>
            {events.length === 0 && order.paidAt ? (
              <ul className="mt-4 space-y-3 text-sm">
                <li className="flex gap-3"><CheckCircle2 className="size-5 text-emerald-500" /><span><b>Pago confirmado</b><br /><span className="text-muted">{fmtDateTime(order.paidAt)}</span></span></li>
              </ul>
            ) : (
              <ol className="relative mt-4 space-y-4 border-l-2 border-brand-200 pl-5">
                {events.map((e: any, i: number) => (
                  <li key={i} className="relative text-sm">
                    <span className={cn('absolute -left-[27px] top-0.5 grid size-5 place-items-center rounded-full', i === 0 ? 'bg-brand-600 text-white' : 'bg-emerald-500 text-white')}><Check className="size-3" /></span>
                    <p className="font-bold">{e.label}</p>
                    <p className="text-muted">{e.detail}{e.city ? ` · ${e.city}` : ''}</p>
                    <p className="text-xs text-muted">{fmtDateTime(e.at)}</p>
                  </li>
                ))}
                {order.paidAt && (
                  <li className="relative text-sm">
                    <span className="absolute -left-[27px] top-0.5 grid size-5 place-items-center rounded-full bg-emerald-500 text-white"><Check className="size-3" /></span>
                    <p className="font-bold">Pago confirmado</p><p className="text-muted">Tu pago fue procesado correctamente.</p><p className="text-xs text-muted">{fmtDateTime(order.paidAt)}</p>
                  </li>
                )}
              </ol>
            )}
          </div>
          <div className="card p-5">
            <p className="flex items-center gap-2 text-lg font-bold"><MapPin className="size-5 text-brand-600" /> Ubicación actual del paquete</p>
            <div className="relative mt-4 h-48 overflow-hidden rounded-xl bg-[linear-gradient(135deg,#eef9f0_25%,#f5f3ff_25%,#f5f3ff_50%,#eef9f0_50%,#eef9f0_75%,#f5f3ff_75%)] bg-[length:40px_40px]">
              <svg viewBox="0 0 300 150" className="absolute inset-0 size-full"><path d="M20 120 C 80 40, 140 140, 200 70 S 270 40, 280 30" fill="none" stroke="#5b2be0" strokeWidth="4" strokeDasharray={lastEvent ? '0' : '8 6'} /><circle cx="20" cy="120" r="7" fill="#fff" stroke="#5b2be0" strokeWidth="3" /><circle cx="280" cy="30" r="8" fill="#5b2be0" /></svg>
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-brand-50 p-3 text-sm">
              <Truck className="size-6 text-brand-600" />
              <div><b>{lastEvent ? lastEvent.label : order.paymentStatus === 'PAID' ? 'Esperando despacho del vendedor' : 'Esperando pago'}</b><p className="text-muted">{lastEvent?.city ? `Último reporte: ${lastEvent.city}` : 'Mostramos los eventos confirmados por la transportadora.'}</p></div>
            </div>
          </div>
        </div>
      </div>

      {/* side */}
      <aside className="space-y-4">
        <div className="card p-5">
          <p className="flex items-center gap-2 text-lg font-bold"><Truck className="size-5 text-brand-600" /> Datos del envío</p>
          <dl className="mt-3 space-y-3 text-sm">
            {allShipments.length ? allShipments.map((s: any) => (
              <div key={s.id} className="space-y-1">
                <div className="flex justify-between"><dt className="text-muted">Transportista</dt><dd className="font-semibold">{s.carrier}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Número de guía</dt><dd className="flex items-center gap-1 font-semibold">{s.trackingNumber} <button onClick={() => copy(s.trackingNumber)} aria-label="Copiar"><Copy className="size-3.5" /></button></dd></div>
              </div>
            )) : <p className="text-muted">El vendedor aún no ha despachado el pedido.</p>}
            {order.shippingAddress && (
              <>
                <div><dt className="text-muted">Dirección de entrega</dt><dd className="font-semibold">{order.shippingAddress.recipientName}<br />{order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}, {order.shippingAddress.city}</dd></div>
                {order.shippingAddress.phone && <div className="flex items-center gap-2"><Phone className="size-4 text-muted" /> {order.shippingAddress.phone}</div>}
              </>
            )}
          </dl>
          {role === 'customer' && <Button className="mt-4 w-full" asChild><Link href={`/ayuda/reportar?pedido=${order.number}&tipo=SHIPPING`}><Headphones /> Contactar soporte</Link></Button>}
        </div>
        <div className="card p-5">
          <p className="text-lg font-bold">Resumen de pago</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt>Productos</dt><dd>{money(order.totals.subtotal)}</dd></div>
            <div className="flex justify-between"><dt>Envío</dt><dd>{money(order.totals.shipping)}</dd></div>
            <div className="flex justify-between"><dt>ITBIS</dt><dd>{money(order.totals.tax)}</dd></div>
            {order.totals.commission !== undefined && <div className="flex justify-between text-muted"><dt>Comisión plataforma</dt><dd>{money(order.totals.commission)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-2 text-base font-extrabold"><dt>Total</dt><dd>{money(order.totals.total)}</dd></div>
          </dl>
        </div>
        <div className="card p-5">
          <p className="text-lg font-bold">Incidencias y mensajes</p>
          <div className="mt-3 flex items-start gap-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="size-5 shrink-0" /><span><b>Estado: sin incidencias.</b><br />El pedido avanza según lo programado.</span></div>
          {role === 'customer' && <Button variant="outline" className="mt-3 w-full" asChild><Link href={`/ayuda/reportar?pedido=${order.number}`}><AlertCircle /> Reportar un problema</Link></Button>}
        </div>
      </aside>

      {shipFor && <ShipDialog so={shipFor} onClose={() => setShipFor(null)} onDone={() => { setShipFor(null); onChanged(); }} />}
      {trackFor && <TrackingDialog shipment={trackFor} role={role} onClose={() => setTrackFor(null)} onDone={() => { setTrackFor(null); onChanged(); }} />}
      {reviewFor && <ReviewDialog item={reviewFor} onClose={() => setReviewFor(null)} onDone={() => { setReviewFor(null); onChanged(); }} />}
    </div>
  );
}

function ShipDialog({ so, onClose, onDone }: { so: any; onClose: () => void; onDone: () => void }) {
  const [carriers, setCarriers] = useState<any[]>([]);
  const [f, setF] = useState({ carrierCode: so.shippingMethod.code === 'PICKUP' ? 'PICKUP' : 'RD_EXPRESS', trackingNumber: '', trackingUrl: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get('/seller/carriers').then(setCarriers).catch(() => undefined);
  }, []);
  const submit = async () => {
    setBusy(true);
    try {
      await post(`/seller/seller-orders/${so.id}/ship`, { ...f, trackingNumber: f.trackingNumber || undefined, trackingUrl: f.trackingUrl || undefined });
      toast.success('Envío registrado. El cliente fue notificado.');
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Registrar envío" description={`${so.number} · ${so.shippingMethod.name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={busy}><Truck /> Confirmar despacho</Button></>}>
      <div className="grid gap-4">
        <Field label="Transportadora" required><Select value={f.carrierCode} onChange={(e) => setF({ ...f, carrierCode: e.target.value })}>{carriers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select></Field>
        <Field label="Número de guía" hint="(si lo dejas vacío generamos uno interno)"><Input value={f.trackingNumber} onChange={(e) => setF({ ...f, trackingNumber: e.target.value })} placeholder="Ej. RD-EX-556789432" /></Field>
        <Field label="Enlace de rastreo" hint="(opcional)"><Input value={f.trackingUrl} onChange={(e) => setF({ ...f, trackingUrl: e.target.value })} placeholder="https://…" /></Field>
      </div>
    </Dialog>
  );
}

function TrackingDialog({ shipment, role, onClose, onDone }: { shipment: any; role: Role; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ status: shipment.trackingStatus === 'IN_TRANSIT' ? 'OUT_FOR_DELIVERY' : 'IN_TRANSIT', detail: '', city: '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await post(`/${role === 'admin' ? 'admin' : 'seller'}/shipments/${shipment.id}/tracking`, { ...f, detail: f.detail || undefined, city: f.city || undefined });
      toast.success('Seguimiento actualizado.');
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Actualizar seguimiento" description={`Guía ${shipment.trackingNumber}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={busy}>Guardar evento</Button></>}>
      <div className="grid gap-4">
        <Field label="Nuevo estado" required>
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="IN_TRANSIT">En tránsito</option><option value="OUT_FOR_DELIVERY">Salió a entrega</option><option value="DELIVERED">Entregado</option><option value="EXCEPTION">Incidencia</option>
          </Select>
        </Field>
        <Field label="Detalle"><Textarea rows={2} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} placeholder="Ej. El paquete llegó al centro de distribución de Santo Domingo." /></Field>
        <Field label="Ciudad"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="Ej. Santo Domingo" /></Field>
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
      toast.success('¡Gracias por tu opinión!');
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Opinar sobre el producto" description={item.title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={busy}>Publicar opinión</Button></>}>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setRating(n)} aria-label={`${n} estrellas`}><Star className={cn('size-8', n <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300')} /></button>)}
      </div>
      <Field label="Título" className="mt-4"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
      <Field label="Tu opinión" className="mt-3"><Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} /></Field>
    </Dialog>
  );
}

export function OrderNotFound() {
  return <div className="card"><Empty title="Pedido no encontrado" /></div>;
}
