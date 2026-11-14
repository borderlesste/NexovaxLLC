'use client';
import { t } from '@/lib/i18n';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { ErrorBox, PageLoader } from '@/components/ui/misc';
import { OrderDetailView } from '@/components/orders/order-detail';
import { RefundWithoutReturn } from '@/components/returns/refund-without-return';
import { useAuth } from '@/lib/auth';

export default function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['admin-order', id], queryFn: () => get(`/admin/orders/${id}`) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorBox message="No encontramos este pedido." />;
  return (
    <>
      <PageHeader crumbs={[{ label: t('Pedidos'), href: '/admin/pedidos' }, { label: q.data.number }]} title={`Pedido ${q.data.number}`} description={`Cliente: ${q.data.customer.name} · ${q.data.customer.email}`} actions={can('orders.refundWithoutReturn') ? <RefundWithoutReturn order={q.data} /> : undefined} />
      <OrderDetailView order={q.data} role="admin" onChanged={() => q.refetch()} />
    </>
  );
}
