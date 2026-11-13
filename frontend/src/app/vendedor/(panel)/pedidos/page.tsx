'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Clock, Package, Search, ShoppingCart, Truck } from 'lucide-react';
import { get } from '@/lib/api';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, StatCard } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageLoader, Segmented } from '@/components/ui/misc';
import { OrdersTable } from '@/components/orders/orders-table';

function Orders() {
  const sp = useSearchParams();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState(sp.get('search') ?? '');
  const [page, setPage] = useState(1);
  const counts = useQuery({ queryKey: ['seller-order-counts'], queryFn: () => get('/seller/orders/counts') });
  const q = useQuery({ queryKey: ['seller-orders', status, search, page], queryFn: () => get(`/seller/orders?status=${status}&search=${encodeURIComponent(search)}&page=${page}`) });
  const c = counts.data;
  return (
    <>
      <PageHeader crumbs={[{ label: 'Mi tienda' }, { label: 'Pedidos' }]} title="Pedidos" description="Prepara, despacha y da seguimiento a los pedidos de tu tienda." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pedidos totales" value={c?.total ?? '—'} icon={<ShoppingCart />} />
        <StatCard label="Por preparar" value={c?.to_prepare ?? '—'} icon={<Clock />} tone="amber" />
        <StatCard label="En preparación" value={c?.preparing ?? '—'} icon={<Package />} />
        <StatCard label="Enviados / entregados" value={c ? `${c.shipped} / ${c.delivered}` : '—'} icon={<Truck />} tone="green" />
      </div>
      <Card className="mt-5">
        <Segmented className="px-3" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
          { value: '', label: 'Todos', count: c?.total }, { value: 'TO_PREPARE', label: 'Por preparar', count: c?.to_prepare }, { value: 'PREPARING', label: 'En preparación', count: c?.preparing },
          { value: 'SHIPPED', label: 'Enviados', count: c?.shipped }, { value: 'DELIVERED', label: 'Entregados', count: c?.delivered }, { value: 'PENDING_PAYMENT', label: 'Pago pendiente', count: c?.pending_payment },
        ]} />
        <div className="p-4"><Input icon={<Search />} placeholder="Buscar pedido o cliente..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" /></div>
        {q.isLoading ? <PageLoader /> : q.data && <OrdersTable data={q.data} base="/vendedor/pedidos" onPage={setPage} />}
      </Card>
    </>
  );
}

export default function SellerOrdersPage() {
  return <Suspense><Orders /></Suspense>;
}
