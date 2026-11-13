'use client';
import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Copy, Landmark, Package } from 'lucide-react';
import { toast } from 'sonner';
import { get } from '@/lib/api';
import { money } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ErrorBox, PageLoader } from '@/components/ui/misc';

export default function ConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['checkout', id], queryFn: () => get(`/checkout/${id}`), refetchInterval: (query) => (query.state.data?.paymentStatus === 'REQUIRES_ACTION' ? 15_000 : false) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <div className="mx-auto max-w-2xl px-4 py-16"><ErrorBox message="No encontramos esta compra." /></div>;
  const r = q.data;
  const paid = !!r.orderId;
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success('Copiado.'));
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="card p-8 text-center">
        {paid ? <CheckCircle2 className="mx-auto size-16 text-emerald-500" /> : <Clock className="mx-auto size-16 text-amber-500" />}
        <h1 className="mt-4 text-3xl font-extrabold">{paid ? '¡Gracias por tu compra!' : 'Tu pedido está reservado'}</h1>
        <p className="mt-2 text-muted">
          {paid ? `Tu pedido ${r.orderNumber} fue confirmado. Te avisaremos cuando la tienda lo despache.` : 'Completa la transferencia bancaria para confirmar tu pedido.'}
        </p>
        <p className="mt-4 text-2xl font-extrabold">{money(r.amount, r.currency)}</p>
        {r.bankTransfer && (
          <div className="mt-6 rounded-xl border border-line bg-surface p-5 text-left text-sm">
            <p className="mb-3 flex items-center gap-2 font-bold"><Landmark className="size-5 text-brand-600" /> Datos para la transferencia</p>
            {[
              ['Banco', r.bankTransfer.bank],
              ['Titular', r.bankTransfer.accountName],
              ['Cuenta', `${r.bankTransfer.accountNumber} (${r.bankTransfer.accountType})`],
              ['Monto exacto', money(r.amount, r.currency)],
              ['Referencia', r.bankTransfer.reference],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b border-line py-2 last:border-0">
                <span className="text-muted">{k}</span>
                <span className="flex items-center gap-2 font-semibold">{v} {k === 'Referencia' || k === 'Cuenta' ? <button onClick={() => copy(String(v))} aria-label="Copiar"><Copy className="size-4 text-brand-600" /></button> : null}</span>
              </div>
            ))}
            <p className="mt-3 text-xs text-muted">{r.bankTransfer.instructions}</p>
          </div>
        )}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {paid ? (
            <Button asChild><Link href={`/cuenta/pedidos/${r.orderId}`}><Package /> Ver mi pedido</Link></Button>
          ) : (
            <Button asChild><Link href="/cuenta/pedidos">Ir a mis pedidos</Link></Button>
          )}
          <Button variant="outline" asChild><Link href="/catalogo">Seguir comprando</Link></Button>
        </div>
      </div>
    </div>
  );
}
