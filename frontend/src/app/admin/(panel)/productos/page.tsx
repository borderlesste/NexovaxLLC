'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Check, Clock, Download, Eye, FileText, Search, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { money } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Empty, Pagination, Segmented, Skeleton } from '@/components/ui/misc';
import { ProductImage } from '@/components/shop/product-card';
import { t } from '@/lib/i18n';

function AdminProducts() {
  const sp = useSearchParams();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState(sp.get('search') ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get('/categories'), staleTime: 300_000 });
  const q = useQuery({ queryKey: ['admin-products', status, search, categoryId, page], queryFn: () => get(`/admin/products?status=${status}&search=${encodeURIComponent(search)}&categoryId=${categoryId}&page=${page}`) });
  const c = q.data?.counts;
  const suspend = async (id: string) => {
    const reason = prompt(t('Motivo de la suspensión / reactivación:')) ?? '';
    try {
      await post(`/admin/products/${id}/suspend`, { reason });
      toast.success(t('Producto actualizado.'));
      qc.invalidateQueries({ queryKey: ['admin-products'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const exportCsv = () => {
    const rows = [[t('Producto'), 'SKU', t('Categoría'), t('Vendedor'), t('Precio'), t('Stock'), t('Estado')], ...(q.data?.items ?? []).map((p: any) => [p.title, p.sku, p.category, p.seller.name, p.price, p.stock, p.status])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map((x: any) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = 'productos.csv';
    a.click();
  };
  return (
    <>
      <PageHeader crumbs={[{ label: t('Panel') }, { label: t('Productos') }]} title={t('Productos')} description={t('Administra el catálogo de productos de todos los vendedores.')} actions={<Button variant="secondary" onClick={exportCsv}><Download /> {t('Exportar')}</Button>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Productos registrados')} value={c?.total ?? '—'} icon={<Box />} hint={t('en todo el marketplace')} />
        <StatCard label={t('Publicados')} value={c?.active ?? '—'} icon={<Check />} tone="green" hint={t('activos en catálogo')} />
        <StatCard label={t('En revisión')} value={c?.pending ?? '—'} icon={<Clock />} hint={t('pendientes de moderación')} />
        <StatCard label={t('Borradores')} value={c?.draft ?? '—'} icon={<FileText />} tone="amber" hint={t('sin publicar')} />
      </div>
      <Card className="mt-5">
        <Segmented className="px-3" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
          { value: '', label: t('Todos'), count: c?.total }, { value: 'ACTIVE', label: t('Publicados') }, { value: 'PENDING_REVIEW', label: t('En revisión') }, { value: 'DRAFT', label: t('Borradores') }, { value: 'REJECTED', label: t('Rechazados') }, { value: 'SUSPENDED', label: t('Suspendidos') },
        ]} />
        <div className="flex flex-wrap gap-3 p-4">
          <Input icon={<Search />} placeholder={t('Buscar por nombre, SKU o vendedor...')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" />
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} className="w-56"><option value="">{t('Categorías: todas')}</option>{cats.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </div>
        {q.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div> : !q.data?.items.length ? <Empty icon={<Box />} title={t('Sin productos')} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">{t('Producto')}</th><th>{t('Categoría')}</th><th>{t('Vendedor')}</th><th>{t('Precio')}</th><th>{t('Stock')}</th><th>{t('Estado')}</th><th /></tr></thead>
              <tbody className="divide-y divide-line">
                {q.data.items.map((p: any) => (
                  <tr key={p.id}>
                    <td className="px-5 py-3"><div className="flex items-center gap-3"><ProductImage src={p.imageUrl} alt={p.title} className="size-12 rounded-lg bg-surface" /><span><b className="line-clamp-1">{p.title}</b><span className="text-xs text-muted">{t('SKU:')}{' '}{p.sku}</span></span></div></td>
                    <td className="text-muted">{p.category}</td><td>{p.seller.name}</td><td className="font-semibold">{p.price ? money(p.price) : '—'}</td>
                    <td className={p.stock === 0 ? 'font-semibold text-red-600' : ''}>{p.stock}</td><td><StatusBadge status={p.status} /></td>
                    <td className="pr-5 text-right">
                      <div className="flex justify-end gap-1">
                        {p.status === 'PENDING_REVIEW' ? <Button size="sm" variant="soft" asChild><Link href={`/admin/moderacion?p=${p.id}`}>{t('Revisar')}</Link></Button>
                          : p.status === 'ACTIVE' ? <Button size="sm" variant="ghost" asChild><Link href={`/producto/${p.slug}`} target="_blank"><Eye /></Link></Button> : null}
                        {['ACTIVE', 'SUSPENDED'].includes(p.status) && <Button size="sm" variant="ghost" onClick={() => suspend(p.id)} title={p.status === 'SUSPENDED' ? t('Reactivar') : t('Suspender')}><ShieldOff /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={20} total={q.data.total} onPage={setPage} label={t('productos')} />
          </div>
        )}
      </Card>
    </>
  );
}

export default function Page() {
  return <Suspense><AdminProducts /></Suspense>;
}
