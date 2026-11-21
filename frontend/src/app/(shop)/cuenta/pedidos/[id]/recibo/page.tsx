'use client';
import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { get } from '@/lib/api';
import { usePublicConfig } from '@/lib/config';
import { countryName, t } from '@/lib/i18n';
import { fmtDateTime, money } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ErrorBox, PageLoader } from '@/components/ui/misc';
import { LogoMark } from '@/components/layout/logo';

/** How the order was paid, as shown to the buyer. */
function paymentLabel(payment: any) {
  if (!payment?.method) return payment?.status === 'PAID' ? t('Pagado') : t('Pendiente');
  if (payment.method === 'BANK_TRANSFER') return t('Transferencia bancaria');
  if (payment.method === 'PAYPAL') return 'PayPal';
  return payment.brand ? `${payment.brand} •••• ${payment.last4}` : t('Tarjeta');
}

/** Printable purchase receipt of a buyer's order ("Imprimir o guardar como PDF" uses the browser). */
export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const cfg = usePublicConfig();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => get(`/orders/${id}`) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorBox message={t('No encontramos este pedido.')} />;
  const o = q.data;
  const cur = o.currency;
  const paid = !!o.paidAt;
  const a = o.shippingAddress;
  const brand = cfg?.name || 'NEXOVAX';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/cuenta/pedidos/${o.id}`}><ArrowLeft /> {t('Volver al pedido')}</Link>
        </Button>
        <Button size="sm" onClick={() => window.print()}><Printer /> {t('Imprimir o guardar PDF')}</Button>
      </div>

      <article data-print-area data-receipt className="card mx-auto max-w-3xl p-6 text-sm sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div className="flex items-center gap-3">
            <LogoMark className="size-12" />
            <div>
              <p className="text-xl font-black tracking-[0.08em]">{brand}</p>
              {cfg?.supportEmail && <p className="text-muted">{cfg.supportEmail}</p>}
            </div>
          </div>
          <div className="sm:text-right">
            <h1 className="text-2xl font-extrabold">{t('Recibo de compra')}</h1>
            <p className="font-semibold">{t('Pedido')} {o.number}</p>
            <p className={paid ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'} data-receipt-status={paid ? 'PAID' : 'PENDING'}>
              {paid ? t('Pagado') : t('Pago pendiente')}
            </p>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-5 border-b border-line py-5 sm:grid-cols-3">
          <div>
            <p className="text-xs font-bold uppercase text-muted">{t('Cliente')}</p>
            <p className="mt-1 font-semibold">{o.customer?.name}</p>
            <p className="break-all text-muted">{o.customer?.email}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-muted">{t('Dirección de entrega')}</p>
            {a ? (
              <p className="mt-1">
                <span className="font-semibold">{a.recipientName}</span><br />
                {a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />
                {[a.city, a.region, a.postalCode].filter(Boolean).join(', ')}<br />
                {countryName(a.countryCode)}
              </p>
            ) : <p className="mt-1 text-muted">—</p>}
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-muted">{t('Pago')}</p>
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1.5">
              <div><dt className="text-xs text-muted">{t('Fecha del pedido')}</dt><dd>{fmtDateTime(o.placedAt)}</dd></div>
              <div><dt className="text-xs text-muted">{t('Fecha de pago')}</dt><dd>{paid ? fmtDateTime(o.paidAt) : '—'}</dd></div>
              <div><dt className="text-xs text-muted">{t('Método')}</dt><dd className="whitespace-nowrap">{paymentLabel(o.payment)}</dd></div>
              {o.payment?.number && <div><dt className="text-xs text-muted">{t('Referencia')}</dt><dd>{o.payment.number}</dd></div>}
            </dl>
          </div>
        </section>

        {o.sellerOrders.map((so: any) => (
          <section key={so.id} className="border-b border-line py-5" data-receipt-store>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-bold">{t('Vendido por {store}', { store: so.seller.name })}</p>
              <p className="text-xs text-muted">{so.number}{so.cancellation?.status === 'REFUNDED' ? ` · ${t('Reembolsado')}` : ''}</p>
            </div>
            {(so.seller.legal || so.seller.email) && (
              <p className="mb-2 text-xs text-muted" data-receipt-seller-legal>
                {[
                  so.seller.legal?.name && `${t('Razón social')}: ${so.seller.legal.name}`,
                  so.seller.legal?.taxId && `${t('Identificación fiscal')}: ${so.seller.legal.taxId}`,
                  so.seller.legal?.countryCode && countryName(so.seller.legal.countryCode),
                  so.seller.email,
                ].filter(Boolean).join(' · ')}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted">
                    <th className="py-1.5 font-semibold">{t('Producto')}</th>
                    <th className="whitespace-nowrap py-1.5 pl-4 text-right font-semibold">{t('Cant.')}</th>
                    <th className="hidden whitespace-nowrap py-1.5 pl-4 text-right font-semibold sm:table-cell print:table-cell">{t('Precio')}</th>
                    <th className="whitespace-nowrap py-1.5 pl-4 text-right font-semibold">{t('Importe')}</th>
                  </tr>
                </thead>
                <tbody>
                  {so.items.map((i: any) => (
                    <tr key={i.id} className="border-t border-line/60 align-top">
                      <td className="py-2">
                        <p className="font-semibold">{i.title}</p>
                        {(i.variantTitle || i.sku) && <p className="text-xs text-muted">{[i.variantTitle, i.sku && `SKU ${i.sku}`].filter(Boolean).join(' · ')}</p>}
                        <p className="text-xs text-muted sm:hidden print:hidden">{i.quantity} × {money(i.unitPrice, cur)}</p>
                      </td>
                      <td className="py-2 pl-4 text-right">{i.quantity}</td>
                      <td className="hidden whitespace-nowrap py-2 pl-4 text-right sm:table-cell print:table-cell">{money(i.unitPrice, cur)}</td>
                      <td className="whitespace-nowrap py-2 pl-4 text-right font-semibold">{money(i.lineTotal, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">
              {t('Envío')}: {t(so.shippingMethod?.name ?? '—')} · {money(so.totals.shipping, cur)}
              {so.coupon ? ` · ${t('Cupón')}: ${so.coupon}` : ''}
            </p>
          </section>
        ))}

        <section className="flex justify-end py-5">
          <dl className="w-full max-w-xs space-y-1.5">
            <div className="flex justify-between"><dt>{t('Productos')}</dt><dd>{money(o.totals.subtotal, cur)}</dd></div>
            {Number(o.totals.discount) > 0 && <div className="flex justify-between text-emerald-700"><dt>{t('Descuento por cupón')}</dt><dd>-{money(o.totals.discount, cur)}</dd></div>}
            <div className="flex justify-between"><dt>{t('Envío')}</dt><dd>{money(o.totals.shipping, cur)}</dd></div>
            <div className="flex justify-between"><dt>{o.tax?.name ?? t('Impuestos')}{o.tax?.rate ? ` (${+(o.tax.rate * 100).toFixed(2)} %)` : ''}</dt><dd>{money(o.totals.tax, cur)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-extrabold" data-receipt-total>
              <dt>{paid ? t('Total pagado') : t('Total a pagar')}</dt><dd>{money(o.totals.total, cur)}</dd>
            </div>
          </dl>
        </section>

        <footer className="border-t border-line pt-4 text-xs text-muted">
          <p>{t('Este recibo es un comprobante de tu compra en {brand}. Cada tienda es responsable de los productos que vende y de su facturación fiscal.', { brand })}</p>
          <p className="mt-1">{t('Emitido el {date}', { date: fmtDateTime(new Date()) })}</p>
        </footer>
      </article>
    </div>
  );
}
