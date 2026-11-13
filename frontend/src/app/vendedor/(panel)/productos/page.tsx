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
import { t } from '@/lib/i18n';

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
      toast.success(t('Producto actualizado.'));
      qc.invalidateQueries({ queryKey: ['seller-products'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const c = q.data?.counts;
  const item = 'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none hover:bg-brand-50 [&_svg]:size-4';
  return (
    <>
      <PageHeader crumbs={[{ label: t('Mi tienda') }, { label: t('Productos') }]} title={t('Productos')} description={t('Administra el catálogo de tu tienda.')} actions={<Button asChild><Link href="/vendedor/productos/nuevo"><Plus /> {t('Crear producto')}</Link></Button>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Productos registrados')} value={c?.total ?? '—'} icon={<Box />} />
        <StatCard label={t('Publicados')} value={c?.active ?? '—'} icon={<Check />} tone="green" />
        <StatCard label={t('En revisión')} value={c?.pending ?? '—'} icon={<Clock />} />
        <StatCard label={t('Borradores')} value={c?.draft ?? '—'} icon={<FileText />} tone="amber" />
      </div>
      <Card className="mt-5">
        <Segmented className="px-3" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
          { value: '', label: t('Todos'), count: c?.total }, { value: 'ACTIVE', label: t('Publicados') }, { value: 'PENDING_REVIEW', label: t('En revisión') },
          { value: 'DRAFT', label: t('Borradores') }, { value: 'REJECTED', label: t('Rechazados') }, { value: 'PAUSED', label: t('Pausados') },
        ]} />
        <div className="p-4"><Input icon={<Search />} placeholder={t('Buscar por nombre o SKU...')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" /></div>
        {q.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div> : !q.data?.items.length ? (
          <Empty icon={<Box />} title={t('No hay productos')} description={t('Crea tu primer producto para empezar a vender.')} action={<Button asChild><Link href="/vendedor/productos/nuevo">{t('Crear producto')}</Link></Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">{t('Producto')}</th><th>{t('Categoría')}</th><th>{t('Precio')}</th><th>{t('Stock')}</th><th>{t('Variantes')}</th><th>{t('Estado')}</th><th>{t('Actualizado')}</th><th /></tr></thead>
              <tbody className="divide-y divide-line">
                {q.data.items.map((p: any) => (
                  <tr key={p.id} className="hover:bg-surface/60">
                    <td className="px-5 py-3">
                      <Link href={`/vendedor/productos/${p.id}/editar`} className="flex items-center gap-3">
                        <ProductImage src={p.imageUrl} alt={p.title} className="size-12 shrink-0 rounded-lg bg-surface" />
                        <span><b className="line-clamp-1">{p.title}</b><span className="text-xs text-muted">{t('SKU:')}{' '}{p.sku}</span></span>
                      </Link>
                      {p.status === 'REJECTED' && p.reviewNote && <p className="mt-1 max-w-sm text-xs text-red-600">{t('Motivo:')}{' '}{p.reviewNote}</p>}
                    </td>
                    <td className="text-muted">{p.category}</td>
                    <td className="font-semibold">{p.price ? money(p.price) : '—'}</td>
                    <td className={p.stock === 0 ? 'font-semibold text-red-600' : ''}>{p.stock}</td>
                    <td>{p.variants}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="text-muted">{fmtDate(p.updatedAt)}</td>
                    <td className="pr-4 text-right">
                      <Dropdown.Root>
                        <Dropdown.Trigger className="rounded-lg p-2 hover:bg-brand-50" aria-label={t('Acciones')}><MoreHorizontal className="size-4" /></Dropdown.Trigger>
                        <Dropdown.Portal>
                          <Dropdown.Content align="end" className="z-50 w-48 rounded-xl border border-line bg-white p-1 shadow-xl">
                            <Dropdown.Item asChild><Link className={item} href={`/vendedor/productos/${p.id}/editar`}><Pencil /> {t('Editar')}</Link></Dropdown.Item>
                            {p.status === 'ACTIVE' && <Dropdown.Item asChild><Link className={item} href={`/producto/${p.slug}`} target="_blank"><Eye /> {t('Ver en tienda')}</Link></Dropdown.Item>}
                            {p.status === 'ACTIVE' && <Dropdown.Item className={item} onSelect={() => act(p.id, 'PAUSE')}><Pause /> {t('Pausar')}</Dropdown.Item>}
                            {p.status === 'PAUSED' && <Dropdown.Item className={item} onSelect={() => act(p.id, 'RESUME')}><Play /> {t('Reanudar')}</Dropdown.Item>}
                            <Dropdown.Item className={`${item} text-red-600`} onSelect={() => confirm(t('¿Archivar este producto?')) && act(p.id, 'ARCHIVE')}><Archive /> {t('Archivar')}</Dropdown.Item>
                          </Dropdown.Content>
                        </Dropdown.Portal>
                      </Dropdown.Root>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} label={t('productos')} />
          </div>
        )}
      </Card>
    </>
  );
}

export default function SellerProductsPage() {
  return <Suspense><Products /></Suspense>;
}
