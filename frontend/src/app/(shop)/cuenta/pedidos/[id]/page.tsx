'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { ErrorBox, PageLoader } from '@/components/ui/misc';
import { OrderDetailView } from '@/components/orders/order-detail';

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['order', id], queryFn: () => get(`/orders/${id}`), refetchInterval: 30_000 });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorBox message="No encontramos este pedido." />;
  return (
    <div>
      <Breadcrumbs items={[{ label: 'Mis pedidos', href: '/cuenta/pedidos' }, { label: 'Seguimiento del pedido' }]} />
      <h1 className="mt-3 text-3xl font-extrabold">Seguimiento del pedido</h1>
      <p className="mb-5 text-muted">Aquí puedes consultar el estado del pedido, el transporte y los eventos de entrega.</p>
      <OrderDetailView order={q.data} role="customer" onChanged={() => q.refetch()} />
    </div>
  );
}
