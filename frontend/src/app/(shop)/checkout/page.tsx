'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Building2, Check, ChevronLeft, CreditCard, Headphones, Home, Landmark, Lock, MapPin, PackageCheck, Pencil, Plus, ShieldCheck, ShoppingBag, Store, Truck, Wallet,
} from 'lucide-react';
import { errorMessage, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, money, uid } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Checkbox, Empty, PageLoader } from '@/components/ui/misc';
import { ProductImage } from '@/components/shop/product-card';
import { AddressDialog, type Address } from '@/components/shop/address-form';

function Steps({ current }: { current: number }) {
  const steps = ['Carrito', 'Envío', 'Pago', 'Confirmación'];
  return (
    <ol className="flex items-center">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <span className={cn('grid size-9 place-items-center rounded-full border-2 text-sm font-bold', i < current ? 'border-brand-600 bg-brand-600 text-white' : i === current ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-muted')}>
              {i < current ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cn('text-xs font-semibold', i <= current ? 'text-brand-700' : 'text-muted')}>{s}</span>
          </div>
          {i < steps.length - 1 && <span className={cn('mx-2 mb-5 h-0.5 w-10 sm:w-20', i < current ? 'bg-brand-600' : 'bg-line')} />}
        </li>
      ))}
    </ol>
  );
}

const PAY_ICONS: Record<string, any> = { CARD: CreditCard, PAYPAL: Wallet, BANK_TRANSFER: Landmark, CASH_ON_DELIVERY: PackageCheck };

export default function CheckoutPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [shipping, setShipping] = useState<Record<string, string>>({});
  const [addressId, setAddressId] = useState<string>('');
  const [addrDialog, setAddrDialog] = useState<{ open: boolean; address?: Address | null }>({ open: false });
  const [method, setMethod] = useState<'CARD' | 'BANK_TRANSFER'>('CARD');
  const [card, setCard] = useState({ number: '', exp: '', cvc: '', name: '' });
  const [save, setSave] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [idem] = useState(() => uid());

  useEffect(() => {
    if (!loading && !session) router.replace('/auth/iniciar-sesion?next=/checkout');
  }, [loading, session, router]);

  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => get<Address[]>('/me/addresses'), enabled: !!session });
  useEffect(() => {
    if (!addressId && addresses.data?.length) setAddressId((addresses.data.find((a) => a.isDefaultShipping) ?? addresses.data[0]).id);
  }, [addresses.data, addressId]);
  const quote = useQuery({
    queryKey: ['checkout-quote', shipping],
    queryFn: () => post('/checkout/quote', { shipping }),
    enabled: !!session,
    placeholderData: (prev) => prev,
  });
  const q = quote.data;
  const items = useMemo(() => q?.groups.flatMap((g: any) => g.items) ?? [], [q]);

  if (loading || !session || (quote.isLoading && !q)) return <PageLoader />;
  if (quote.isError && !q)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16"><div className="card"><Empty icon={<ShoppingBag />} title="Tu carrito está vacío" description="Agrega productos antes de finalizar la compra." action={<Button asChild><Link href="/catalogo">Explorar productos</Link></Button>} /></div></div>
    );

  const place = async () => {
    if (!addressId) return toast.error('Selecciona una dirección de envío.');
    let cardPayload;
    if (method === 'CARD') {
      const [mm, yy] = card.exp.split('/').map((s) => s.trim());
      if (!card.number || !mm || !yy || !card.cvc || !card.name) return toast.error('Completa los datos de la tarjeta.');
      cardPayload = { number: card.number.replace(/\s/g, ''), expMonth: Number(mm), expYear: Number(yy), cvc: card.cvc, name: card.name };
    }
    setPlacing(true);
    try {
      const shippingSel = Object.fromEntries(q.groups.map((g: any) => [g.sellerId, shipping[g.sellerId] ?? g.selectedRate]));
      const r = await post('/checkout/place', { addressId, shipping: shippingSel, paymentMethod: method, card: cardPayload, idempotencyKey: idem });
      qc.invalidateQueries({ queryKey: ['cart'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      router.push(`/checkout/confirmacion/${r.checkoutId}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPlacing(false);
    }
  };

  const fmtCard = (v: string) => v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-8">
          <Link href="/carrito" className="hidden items-center gap-1 text-sm font-semibold sm:flex"><ChevronLeft className="size-4" /> Volver al carrito</Link>
          <div>
            <h1 className="text-3xl font-extrabold">Finalizar compra</h1>
            <p className="text-sm text-muted">Completa los pasos para realizar tu pedido de forma segura.</p>
          </div>
        </div>
        <Steps current={method ? 2 : 1} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_440px]">
        <div className="space-y-5">
          {/* address */}
          <section className="card p-5">
            <div className="mb-4 flex items-start gap-3">
              <MapPin className="mt-0.5 size-6 text-brand-600" />
              <div><h2 className="text-lg font-bold">Dirección de envío</h2><p className="text-sm text-muted">Indica dónde deseas recibir tu pedido.</p></div>
            </div>
            <div className="space-y-3">
              {(addresses.data ?? []).map((a) => (
                <label key={a.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-4', addressId === a.id ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-200' : 'border-line')}>
                  <input type="radio" checked={addressId === a.id} onChange={() => setAddressId(a.id)} className="mt-1 size-4 accent-brand-600" />
                  {a.label === 'Trabajo' ? <Building2 className="mt-0.5 size-5 shrink-0" /> : <Home className="mt-0.5 size-5 shrink-0" />}
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-bold">{a.label ?? 'Dirección'} · {a.recipientName}</p>
                    <p className="text-muted">{a.line1}{a.line2 ? `, ${a.line2}` : ''}</p>
                    <p className="text-muted">{a.city}{a.region ? `, ${a.region}` : ''}, República Dominicana</p>
                  </div>
                  {a.isDefaultShipping && <span className="rounded-md bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">Predeterminada</span>}
                  <button type="button" onClick={(e) => { e.preventDefault(); setAddrDialog({ open: true, address: a }); }} className="text-muted hover:text-brand-700" aria-label="Editar"><Pencil className="size-4" /></button>
                </label>
              ))}
              <button onClick={() => setAddrDialog({ open: true, address: null })} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-brand-300 px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-50">
                <Plus className="size-4" /> Agregar nueva dirección
              </button>
            </div>
          </section>

          {/* shipping */}
          <section className="card p-5">
            <div className="mb-4 flex items-start gap-3">
              <Truck className="mt-0.5 size-6 text-brand-600" />
              <div><h2 className="text-lg font-bold">Método de envío</h2><p className="text-sm text-muted">Elige cómo deseas recibir tu pedido{q.groups.length > 1 ? ' de cada tienda' : ''}.</p></div>
            </div>
            <div className="space-y-5">
              {q.groups.map((g: any) => (
                <div key={g.sellerId}>
                  {q.groups.length > 1 && <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><Store className="size-4 text-brand-600" /> {g.sellerName}</p>}
                  <div className="space-y-2">
                    {g.rates.map((r: any) => {
                      const sel = (shipping[g.sellerId] ?? g.selectedRate) === r.code;
                      return (
                        <label key={r.code} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-4', sel ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-200' : 'border-line')}>
                          <input type="radio" checked={sel} onChange={() => setShipping((s) => ({ ...s, [g.sellerId]: r.code }))} className="size-4 accent-brand-600" />
                          {r.code === 'PICKUP' ? <Store className="size-5" /> : <Truck className="size-5" />}
                          <div className="flex-1 text-sm"><p className="font-bold">{r.name}</p><p className="text-muted">{r.description}</p></div>
                          <span className="font-bold">{Number(r.amount) === 0 ? 'Gratis' : money(r.amount)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* payment */}
          <section className="card p-5">
            <div className="mb-4 flex items-start gap-3">
              <CreditCard className="mt-0.5 size-6 text-brand-600" />
              <div><h2 className="text-lg font-bold">Método de pago</h2><p className="text-sm text-muted">Selecciona tu forma de pago.</p></div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {q.paymentMethods.map((m: any) => {
                const Icon = PAY_ICONS[m.code] ?? CreditCard;
                const sel = method === m.code;
                return (
                  <button key={m.code} disabled={!m.available} title={m.reason} onClick={() => setMethod(m.code)}
                    className={cn('flex items-center gap-3 rounded-xl border p-3 text-left text-sm font-semibold', sel ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-200' : 'border-line', !m.available && 'cursor-not-allowed opacity-50')}>
                    <span className={cn('grid size-4 place-items-center rounded-full border', sel ? 'border-brand-600' : 'border-gray-300')}>{sel && <span className="size-2 rounded-full bg-brand-600" />}</span>
                    <Icon className="size-5 shrink-0" /> <span className="leading-tight">{m.name}{!m.available && <span className="block text-[11px] font-normal text-muted">No disponible</span>}</span>
                  </button>
                );
              })}
            </div>
            {method === 'CARD' && (
              <div className="mt-5 grid gap-4 sm:grid-cols-[1.2fr_0.8fr_0.6fr]">
                <Field label="Número de tarjeta" required className="sm:col-span-3">
                  <Input inputMode="numeric" autoComplete="cc-number" placeholder="1234 5678 9012 3456" value={card.number} onChange={(e) => setCard({ ...card, number: fmtCard(e.target.value) })} />
                </Field>
                <Field label="Nombre en la tarjeta" required><Input autoComplete="cc-name" placeholder="Ej. Juan Pérez" value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} /></Field>
                <Field label="Fecha de vencimiento" required>
                  <Input inputMode="numeric" autoComplete="cc-exp" placeholder="MM / AA" value={card.exp} onChange={(e) => {
                    const d = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setCard({ ...card, exp: d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d });
                  }} />
                </Field>
                <Field label="CVV" required><Input inputMode="numeric" autoComplete="cc-csc" placeholder="123" value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></Field>
                <div className="sm:col-span-3"><Checkbox checked={save} onChange={setSave} label="Guardar esta tarjeta para futuras compras" /></div>
                {q.paymentMethods.find((m: any) => m.code === 'CARD')?.sandbox && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:col-span-3">
                    Entorno de pruebas: usa <b>4242 4242 4242 4242</b> (aprobada) o <b>4000 0000 0000 0002</b> (rechazada), con cualquier fecha futura y CVV.
                  </p>
                )}
              </div>
            )}
            {method === 'BANK_TRANSFER' && (
              <p className="mt-4 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800">
                Al confirmar recibirás los datos bancarios y una referencia. Reservamos tu inventario por 72 horas y confirmaremos tu pedido cuando validemos la transferencia.
              </p>
            )}
          </section>
        </div>

        {/* summary */}
        <aside className="card h-fit p-6 lg:sticky lg:top-24">
          <h2 className="flex items-center gap-3 text-xl font-bold"><ShoppingBag className="size-6 text-brand-600" /> Resumen del pedido</h2>
          <ul className="mt-4 max-h-80 divide-y divide-line overflow-y-auto border-y border-line scrollbar-thin">
            {items.map((i: any) => (
              <li key={i.id} className="flex gap-3 py-3">
                <ProductImage src={i.imageUrl} alt={i.title} className="size-20 shrink-0 rounded-xl bg-surface" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-bold">{i.title}</p>
                  <p className="text-muted">{Object.entries(i.attributes ?? {}).map(([k, v]) => `${k}: ${v}`).join(' | ')}</p>
                  <p className="text-muted">Cantidad: {i.quantity}</p>
                </div>
                <b className="text-sm">{money(i.lineTotal)}</b>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(q.subtotal)}</dd></div>
            <div className="flex justify-between"><dt>Envío</dt><dd>{Number(q.shipping) === 0 ? 'Gratis' : money(q.shipping)}</dd></div>
            <div className="flex justify-between"><dt>Impuestos (ITBIS {Math.round(q.itbisRate * 100)}%)</dt><dd>{money(q.tax)}</dd></div>
          </dl>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3 text-xl font-extrabold"><span>Total a pagar</span><span className="text-brand-800">{money(q.total)}</span></div>
          <Button size="lg" className="mt-5 h-14 w-full text-lg" onClick={place} loading={placing} disabled={!addressId}>
            <Lock /> Confirmar compra
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-muted"><ShieldCheck className="size-4 text-brand-600" /> Tu pago es 100% seguro y encriptado.</p>
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-5 text-center text-xs">
            {[[ShieldCheck, 'Pago seguro', 'Datos protegidos'], [PackageCheck, 'Compra protegida', 'Garantía de entrega'], [Headphones, 'Soporte al cliente', 'Siempre disponible']].map(([I, t, d]: any) => (
              <div key={t}><I className="mx-auto size-6 text-brand-600" /><p className="mt-1 font-bold">{t}</p><p className="text-muted">{d}</p></div>
            ))}
          </div>
        </aside>
      </div>
      {addrDialog.open && (
        <AddressDialog open onOpenChange={(o) => setAddrDialog({ open: o })} address={addrDialog.address} onSaved={(a) => { qc.invalidateQueries({ queryKey: ['addresses'] }); setAddressId(a.id); }} />
      )}
    </div>
  );
}
