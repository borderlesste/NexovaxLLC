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

function AdminOrders() {
  const sp = useSearchParams();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState(sp.get('search') ?? '');
  const [page, setPage] = useState(1);
  const counts = useQuery({ queryKey: ['admin-order-counts'], queryFn: () => get('/admin/orders/counts') });
  const q = useQuery({ queryKey: ['admin-orders', status, search, page], queryFn: () => get(`/admin/orders?status=${status}&search=${encodeURIComponent(search)}&page=${page}`) });
  const c = counts.data;
  return (
    <>
      <PageHeader crumbs={[{ label: 'Inicio' }, { label: 'Pedidos' }]} title="Pedidos" description="Supervisa las compras, los pagos y los envíos del marketplace." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pedidos totales" value={c?.total ?? '—'} icon={<ShoppingCart />} />
        <StatCard label="Pendientes" value={c ? c.pending_payment + c.to_prepare : '—'} icon={<Clock />} tone="amber" hint="requieren seguimiento" />
        <StatCard label="En preparación" value={c?.preparing ?? '—'} icon={<Package />} />
        <StatCard label="Entregados" value={c?.delivered ?? '—'} icon={<Truck />} tone="green" />
      </div>
      <Card className="mt-5">
        <Segmented className="px-3" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
          { value: '', label: 'Todos', count: c?.total }, { value: 'PENDING_PAYMENT', label: 'Pendientes de pago', count: c?.pending_payment }, { value: 'PAID', label: 'Pagados', count: c?.to_prepare },
          { value: 'PREPARING', label: 'En preparación', count: c?.preparing }, { value: 'SHIPPED', label: 'Enviados', count: c?.shipped }, { value: 'DELIVERED', label: 'Entregados', count: c?.delivered }, { value: 'CANCELLED', label: 'Cancelados', count: c?.cancelled },
        ]} />
        <div className="p-4"><Input icon={<Search />} placeholder="Buscar pedido, cliente o tienda..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" /></div>
        {q.isLoading ? <PageLoader /> : q.data && <OrdersTable data={q.data} base="/admin/pedidos" showSeller onPage={setPage} />}
      </Card>
    </>
  );
}
export default function Page() { return <Suspense><AdminOrders /></Suspense>; }
