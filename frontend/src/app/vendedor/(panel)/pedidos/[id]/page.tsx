'use client';
import { use } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { ErrorBox, PageLoader } from '@/components/ui/misc';
import { OrderDetailView } from '@/components/orders/order-detail';

export default function SellerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['seller-order', id], queryFn: () => get(`/seller/orders/${id}`) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorBox message="No encontramos este pedido." />;
  return (
    <>
      <PageHeader crumbs={[{ label: 'Pedidos', href: '/vendedor/pedidos' }, { label: q.data.number }]} title={`Pedido ${q.data.number}`} description="Prepara el pedido, registra el envío y actualiza el seguimiento." />
      <OrderDetailView order={q.data} role="seller" onChanged={() => { q.refetch(); qc.invalidateQueries({ queryKey: ['seller-order-counts'] }); }} />
    </>
  );
}
