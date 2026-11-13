'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Archive, Box, Check, Clock, Eye, FileText, MoreHorizontal, Pause, Pencil, Play, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { fmtDate, money } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Empty, Pagination, Segmented, Skeleton } from '@/components/ui/misc';
import { ProductImage } from '@/components/shop/product-card';

function Products() {
  const sp = useSearchParams();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState(sp.get('search') ?? '');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['seller-products', status, search, page], queryFn: () => get(`/seller/products?status=${status}&search=${encodeURIComponent(search)}&page=${page}`) });
  const act = async (id: string, action: string) => {
    try {
      await post(`/seller/products/${id}/status`, { action });
      toast.success('Producto actualizado.');
      qc.invalidateQueries({ queryKey: ['seller-products'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const c = q.data?.counts;
  const item = 'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none hover:bg-brand-50 [&_svg]:size-4';
  return (
    <>
      <PageHeader crumbs={[{ label: 'Mi tienda' }, { label: 'Productos' }]} title="Productos" description="Administra el catálogo de tu tienda." actions={<Button asChild><Link href="/vendedor/productos/nuevo"><Plus /> Crear producto</Link></Button>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Productos registrados" value={c?.total ?? '—'} icon={<Box />} />
        <StatCard label="Publicados" value={c?.active ?? '—'} icon={<Check />} tone="green" />
        <StatCard label="En revisión" value={c?.pending ?? '—'} icon={<Clock />} />
        <StatCard label="Borradores" value={c?.draft ?? '—'} icon={<FileText />} tone="amber" />
      </div>
      <Card className="mt-5">
        <Segmented className="px-3" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
          { value: '', label: 'Todos', count: c?.total }, { value: 'ACTIVE', label: 'Publicados' }, { value: 'PENDING_REVIEW', label: 'En revisión' },
          { value: 'DRAFT', label: 'Borradores' }, { value: 'REJECTED', label: 'Rechazados' }, { value: 'PAUSED', label: 'Pausados' },
        ]} />
        <div className="p-4"><Input icon={<Search />} placeholder="Buscar por nombre o SKU..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" /></div>
        {q.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div> : !q.data?.items.length ? (
          <Empty icon={<Box />} title="No hay productos" description="Crea tu primer producto para empezar a vender." action={<Button asChild><Link href="/vendedor/productos/nuevo">Crear producto</Link></Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Variantes</th><th>Estado</th><th>Actualizado</th><th /></tr></thead>
              <tbody className="divide-y divide-line">
                {q.data.items.map((p: any) => (
                  <tr key={p.id} className="hover:bg-surface/60">
                    <td className="px-5 py-3">
                      <Link href={`/vendedor/productos/${p.id}/editar`} className="flex items-center gap-3">
                        <ProductImage src={p.imageUrl} alt={p.title} className="size-12 shrink-0 rounded-lg bg-surface" />
                        <span><b className="line-clamp-1">{p.title}</b><span className="text-xs text-muted">SKU: {p.sku}</span></span>
                      </Link>
                      {p.status === 'REJECTED' && p.reviewNote && <p className="mt-1 max-w-sm text-xs text-red-600">Motivo: {p.reviewNote}</p>}
                    </td>
                    <td className="text-muted">{p.category}</td>
                    <td className="font-semibold">{p.price ? money(p.price) : '—'}</td>
                    <td className={p.stock === 0 ? 'font-semibold text-red-600' : ''}>{p.stock}</td>
                    <td>{p.variants}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="text-muted">{fmtDate(p.updatedAt)}</td>
                    <td className="pr-4 text-right">
                      <Dropdown.Root>
                        <Dropdown.Trigger className="rounded-lg p-2 hover:bg-brand-50" aria-label="Acciones"><MoreHorizontal className="size-4" /></Dropdown.Trigger>
                        <Dropdown.Portal>
                          <Dropdown.Content align="end" className="z-50 w-48 rounded-xl border border-line bg-white p-1 shadow-xl">
                            <Dropdown.Item asChild><Link className={item} href={`/vendedor/productos/${p.id}/editar`}><Pencil /> Editar</Link></Dropdown.Item>
                            {p.status === 'ACTIVE' && <Dropdown.Item asChild><Link className={item} href={`/producto/${p.slug}`} target="_blank"><Eye /> Ver en tienda</Link></Dropdown.Item>}
                            {p.status === 'ACTIVE' && <Dropdown.Item className={item} onSelect={() => act(p.id, 'PAUSE')}><Pause /> Pausar</Dropdown.Item>}
                            {p.status === 'PAUSED' && <Dropdown.Item className={item} onSelect={() => act(p.id, 'RESUME')}><Play /> Reanudar</Dropdown.Item>}
                            <Dropdown.Item className={`${item} text-red-600`} onSelect={() => confirm('¿Archivar este producto?') && act(p.id, 'ARCHIVE')}><Archive /> Archivar</Dropdown.Item>
                          </Dropdown.Content>
                        </Dropdown.Portal>
                      </Dropdown.Root>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} label="productos" />
          </div>
        )}
      </Card>
    </>
  );
}

export default function SellerProductsPage() {
  return <Suspense><Products /></Suspense>;
}
