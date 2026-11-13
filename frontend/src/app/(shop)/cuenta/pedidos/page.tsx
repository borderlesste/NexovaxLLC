'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Package } from 'lucide-react';
import { get } from '@/lib/api';
import { fmtDate, money } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/badge';
import { Empty, Pagination, Segmented, Skeleton } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { ProductImage } from '@/components/shop/product-card';

export default function OrdersPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['my-orders', status, page], queryFn: () => get(`/orders?status=${status}&page=${page}`) });
  return (
    <div>
      <h1 className="text-3xl font-extrabold">Mis pedidos</h1>
      <p className="text-muted">Consulta el estado de tus compras y el seguimiento de cada envío.</p>
      <div className="card mt-6">
        <Segmented className="px-3" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
          { value: '', label: 'Todos' }, { value: 'PENDING_PAYMENT', label: 'Pago pendiente' }, { value: 'PAID', label: 'Pagados' },
          { value: 'PREPARING', label: 'En preparación' }, { value: 'SHIPPED', label: 'Enviados' }, { value: 'DELIVERED', label: 'Entregados' },
        ]} />
        {q.isLoading ? <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div> :
          !q.data?.items.length ? <Empty icon={<Package />} title="Aún no tienes pedidos" action={<Button asChild><Link href="/catalogo">Explorar productos</Link></Button>} /> : (
            <>
              <ul className="divide-y divide-line">
                {q.data.items.map((o: any) => (
                  <li key={o.sellerOrderId}>
                    <Link href={`/cuenta/pedidos/${o.orderId}`} className="flex items-center gap-4 p-5 hover:bg-surface">
                      <ProductImage src={o.imageUrl} alt={o.firstTitle ?? ''} className="size-16 shrink-0 rounded-xl bg-surface" />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold">Pedido {o.orderNumber} <span className="font-normal text-muted">· {o.seller.name}</span></p>
                        <p className="truncate text-sm text-muted">{o.firstTitle}{o.itemLines > 1 ? ` y ${o.itemLines - 1} más` : ''} · {o.units} {o.units === 1 ? 'artículo' : 'artículos'}</p>
                        <p className="text-xs text-muted">{fmtDate(o.placedAt)}</p>
                      </div>
                      <div className="text-right"><p className="font-extrabold">{money(o.total)}</p><StatusBadge status={o.status} className="mt-1" /></div>
                      <ChevronRight className="size-5 text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} label="pedidos" />
            </>
          )}
      </div>
    </div>
  );
}
