'use client';
import Link from 'next/link';
import { fmtDate, money } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/badge';
import { Empty, Pagination } from '@/components/ui/misc';
import { ShoppingCart } from 'lucide-react';

export function OrdersTable({ data, base, showSeller, onPage }: { data: any; base: string; showSeller?: boolean; onPage: (p: number) => void }) {
  if (!data.items.length) return <Empty icon={<ShoppingCart />} title="No hay pedidos" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-surface text-left text-xs font-semibold text-muted">
          <tr><th className="px-5 py-3">Pedido</th><th>Cliente</th>{showSeller && <th>Vendedor</th>}<th>Fecha</th><th>Productos</th><th>Total</th><th>Estado</th><th /></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.items.map((o: any) => (
            <tr key={o.sellerOrderId} className="hover:bg-surface/60">
              <td className="px-5 py-3 font-bold">#{o.orderNumber}</td>
              <td className="font-semibold">{o.customer.name}</td>
              {showSeller && <td className="text-muted">{o.seller.name}</td>}
              <td className="text-muted">{fmtDate(o.placedAt)}</td>
              <td className="text-muted">{o.units} {o.units === 1 ? 'producto' : 'productos'}</td>
              <td className="font-bold">{money(o.total)}</td>
              <td><StatusBadge status={o.status} /></td>
              <td className="pr-5 text-right"><Link href={`${base}/${o.orderId}`} className="font-semibold text-brand-700 hover:underline">Ver detalle</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={onPage} label="pedidos" />
    </div>
  );
}
