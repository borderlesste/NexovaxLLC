'use client';
import Link from 'next/link';
import { use, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Copy, Landmark, Package, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { get, post } from '@/lib/api';
import { money } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ErrorBox, PageLoader } from '@/components/ui/misc';
import { t } from '@/lib/i18n';

export default function ConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['checkout', id], queryFn: () => get(`/checkout/${id}`), refetchInterval: (query) => (['REQUIRES_ACTION', 'PROCESSING'].includes(query.state.data?.paymentStatus) && !query.state.data?.orderId ? 15_000 : false) });
  // Return from a 3-D Secure redirect: verify the card payment with Stripe once.
  const verified = useRef(false);
  useEffect(() => {
    const r = q.data;
    if (!r || verified.current || r.orderId || r.provider !== 'STRIPE' || !['REQUIRES_ACTION', 'REQUIRES_PAYMENT_METHOD'].includes(r.paymentStatus)) return;
    verified.current = true;
    post(`/checkout/${id}/payments/stripe/confirm`).then(() => q.refetch()).catch((e) => toast.error(e?.message ?? t('El pago aún no se ha completado.')));
  }, [q.data, id, q]);
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <div className="mx-auto max-w-2xl px-4 py-16"><ErrorBox message={t('No encontramos esta compra.')} /></div>;
  const r = q.data;
  const paid = !!r.orderId;
  const failed = !paid && ['CANCELLED', 'FAILED'].includes(r.paymentStatus);
  if (failed)
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="card p-8 text-center" data-payment-failed>
          <XCircle className="mx-auto size-16 text-red-500" />
          <h1 className="mt-4 text-3xl font-extrabold">{t('No se pudo completar el pago')}</h1>
          <p className="mt-2 text-muted">{t('El procesador rechazó el pago y no se te cobró. Tus productos siguen en el carrito: puedes intentarlo de nuevo con otro medio de pago.')}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild><Link href="/carrito">{t('Volver al carrito')}</Link></Button>
            <Button variant="outline" asChild><Link href="/catalogo">{t('Seguir comprando')}</Link></Button>
          </div>
        </div>
      </div>
    );
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success(t('Copiado.')));
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="card p-8 text-center">
        {paid ? <CheckCircle2 className="mx-auto size-16 text-emerald-500" /> : <Clock className="mx-auto size-16 text-amber-500" />}
        <h1 className="mt-4 text-3xl font-extrabold">{paid ? t('¡Gracias por tu compra!') : t('Tu pedido está reservado')}</h1>
        <p className="mt-2 text-muted">
          {paid
            ? t('Tu pedido {a} fue confirmado. Te avisaremos cuando la tienda lo despache.', { a: r.orderNumber })
            : r.bankTransfer
              ? t('Completa la transferencia bancaria para confirmar tu pedido.')
              : r.paymentStatus === 'PROCESSING'
                ? t('PayPal o tu banco aún está procesando el pago. Tu pedido queda reservado y te avisaremos en cuanto se confirme; esta página se actualiza sola.')
                : t('Estamos confirmando tu pago con el procesador. Esta página se actualizará automáticamente.')}
        </p>
        <p className="mt-4 text-2xl font-extrabold">{money(r.amount, r.currency)}</p>
        {r.bankTransfer && (
          <div className="mt-6 rounded-xl border border-line bg-surface p-5 text-left text-sm">
            <p className="mb-3 flex items-center gap-2 font-bold"><Landmark className="size-5 text-brand-600" /> {t('Datos para la transferencia')}</p>
            {([
              [t('Banco'), r.bankTransfer.bank, false],
              [t('Titular'), r.bankTransfer.accountName, false],
              [t('Cuenta'), r.bankTransfer.accountNumber, true],
              ...(r.bankTransfer.routingOrSwift ? [['Routing / SWIFT', r.bankTransfer.routingOrSwift, false]] : []),
              ...(r.bankTransfer.iban ? [['IBAN', r.bankTransfer.iban, true]] : []),
              [t('Monto exacto'), money(r.amount, r.currency), false],
              [t('Referencia'), r.bankTransfer.reference, true],
            ] as Array<[string, string, boolean]>).map(([k, v, copyable]) => (
              <div key={k} className="flex items-center justify-between border-b border-line py-2 last:border-0">
                <span className="text-muted">{k}</span>
                <span className="flex items-center gap-2 font-semibold">{v} {copyable ? <button onClick={() => copy(String(v))} aria-label={t('Copiar')}><Copy className="size-4 text-brand-600" /></button> : null}</span>
              </div>
            ))}
            <p className="mt-3 text-xs text-muted">{r.bankTransfer.instructions}</p>
          </div>
        )}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {paid ? (
            <Button asChild><Link href={`/cuenta/pedidos/${r.orderId}`}><Package /> {t('Ver mi pedido')}</Link></Button>
          ) : (
            <Button asChild><Link href="/cuenta/pedidos">{t('Ir a mis pedidos')}</Link></Button>
          )}
          <Button variant="outline" asChild><Link href="/catalogo">{t('Seguir comprando')}</Link></Button>
        </div>
      </div>
    </div>
  );
}
