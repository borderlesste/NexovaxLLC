'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Check, ChevronDown, ChevronRight, Download, Layers, Pencil, Plus, Search, Star } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, post, put } from '@/lib/api';
import { fmtDateTime } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, Empty, PageLoader, Pagination } from '@/components/ui/misc';
import { Donut } from '@/components/charts/charts';
import { CategoryIcon } from '@/components/shop/category-icon';
import { t, getIntlLocale } from '@/lib/i18n';

export default function CategoriesAdminPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<any>(null);
  const q = useQuery({ queryKey: ['admin-categories', search, status], queryFn: () => get(`/admin/categories?search=${encodeURIComponent(search)}&status=${status}`) });
  const all = q.data ?? [];
  const roots = useMemo(() => all.filter((c: any) => !c.parentId), [all]);
  const byParent = useMemo(() => { const m = new Map<string, any[]>(); for (const c of all) if (c.parentId) m.set(c.parentId, [...(m.get(c.parentId) ?? []), c]); return m; }, [all]);
  const list = search ? all : roots;
  const pageItems = list.slice((page - 1) * 10, page * 10);
  const topSubs = [...all.filter((c: any) => c.parentId)].sort((a, b) => b.products - a.products).slice(0, 5);
  const save = async () => {
    try {
      const body = { name: dlg.name, parentId: dlg.parentId || null, status: dlg.status, sortOrder: dlg.sortOrder ? Number(dlg.sortOrder) : undefined };
      dlg.id ? await put(`/admin/categories/${dlg.id}`, body) : await post('/admin/categories', body);
      toast.success(t('Categoría guardada.'));
      setDlg(null);
      qc.invalidateQueries({ queryKey: ['admin-categories'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const archive = async (id: string) => {
    if (!confirm(t('¿Archivar esta categoría?'))) return;
    try { await del(`/admin/categories/${id}`); toast.success(t('Categoría archivada.')); qc.invalidateQueries({ queryKey: ['admin-categories'] }); } catch (e) { toast.error(errorMessage(e)); }
  };
  const exportCsv = () => {
    const rows = [[t('Categoría'), t('Slug'), t('Padre'), t('Productos'), t('Subcategorías'), t('Estado')], ...all.map((c: any) => [c.name, c.slug, all.find((p: any) => p.id === c.parentId)?.name ?? '', c.products, c.children, c.status])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map((x: any) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = 'categorias.csv'; a.click();
  };
  if (q.isLoading) return <PageLoader />;
  const totalProducts = roots.reduce((a: number, r: any) => a + r.products, 0);
  const dist = [...roots].sort((a, b) => b.products - a.products);
  const distData = [...dist.slice(0, 5).map((r: any) => ({ name: r.name, value: r.products })), { name: t('Otras'), value: dist.slice(5).reduce((a: number, r: any) => a + r.products, 0) }];
  return (
    <>
      <PageHeader crumbs={[{ label: t('Panel') }, { label: t('Categorías') }]} title={t('Categorías')} description={t('Administra las categorías del marketplace. Organiza el catálogo, crea subcategorías y controla su visibilidad.')}
        actions={<><Button variant="secondary" onClick={exportCsv}><Download /> {t('Exportar')}</Button>{isAdmin && <Button onClick={() => setDlg({ name: '', parentId: '', status: 'ACTIVE', sortOrder: '' })}><Plus /> {t('Crear categoría')}</Button>}</>} />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('Total de categorías')} value={all.length} icon={<Layers />} />
        <StatCard label={t('Categorías activas')} value={all.filter((c: any) => c.status === 'ACTIVE').length} icon={<Check />} tone="green" />
        <StatCard label={t('Categorías principales')} value={roots.length} icon={<Star />} />
      </div>
      <Card className="mt-5">
        <CardHeader title={t('Listado de categorías')} subtitle={t('Todas las categorías del marketplace')} />
        <div className="flex flex-wrap gap-3 p-4">
          <Input icon={<Search />} placeholder={t('Buscar por categoría o slug...')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44"><option value="">{t('Estado: Todos')}</option><option value="ACTIVE">{t('Activas')}</option><option value="INACTIVE">{t('Inactivas')}</option></Select>
        </div>
        {!pageItems.length ? <Empty title={t('Sin categorías')} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">{t('Categoría')}</th><th>{t('Slug')}</th><th>{t('Productos')}</th><th>{t('Subcategorías')}</th><th>{t('Estado')}</th><th>{t('Actualización')}</th><th /></tr></thead>
              <tbody className="divide-y divide-line">
                {pageItems.flatMap((c: any) => [c, ...(expanded.has(c.id) ? byParent.get(c.id) ?? [] : [])]).map((c: any) => (
                  <tr key={c.id}>
                    <td className={`py-3 pr-3 ${c.parentId && !search ? 'pl-12' : 'px-5'}`}>
                      <span className="flex items-center gap-2">
                        {!c.parentId && c.children > 0 && !search && <button onClick={() => setExpanded((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} aria-label={t('Expandir')}>{expanded.has(c.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button>}
                        <CategoryIcon slug={c.slug} className="size-5 text-brand-600" /> <b>{c.name}</b>
                      </span>
                    </td>
                    <td className="text-muted">{c.slug}</td><td className="font-semibold">{c.products}</td><td>{c.children}</td>
                    <td><StatusBadge status={c.status} label={c.status === 'ACTIVE' ? t('Activa') : t('Inactiva')} /></td>
                    <td className="text-muted">{fmtDateTime(c.updatedAt)}</td>
                    <td className="pr-5 text-right">{isAdmin && <span className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setDlg({ id: c.id, name: c.name, parentId: c.parentId ?? '', status: c.status, sortOrder: String(c.sortOrder) })} aria-label={t('Editar')}><Pencil /></Button>
                      <Button size="sm" variant="ghost" onClick={() => archive(c.id)} aria-label={t('Archivar')}><Archive /></Button></span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={10} total={list.length} onPage={setPage} label={t('categorías')} />
          </div>
        )}
      </Card>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<Star />} title={t('Subcategorías destacadas')} subtitle={t('Subcategorías con mayor número de productos')} />
          <ul className="divide-y divide-line">{topSubs.map((s: any, i: number) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3"><CategoryIcon slug={s.slug} className="size-6 text-brand-600" /><span className="flex-1"><b className="block text-sm">{s.name}</b><span className="text-xs text-muted">{s.products} {t('productos')}</span></span><span className="rounded-lg bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">#{i + 1}</span></li>
          ))}</ul>
        </Card>
        <Card>
          <CardHeader title={t('Distribución de productos por categoría')} subtitle={t('Porcentaje de productos en el catálogo')} />
          <div className="p-5"><Donut data={distData} total={totalProducts.toLocaleString(getIntlLocale())} label={t('productos')} /></div>
        </Card>
      </div>
      {dlg && (
        <Dialog open onOpenChange={(o) => !o && setDlg(null)} title={dlg.id ? t('Editar categoría') : t('Crear categoría')} footer={<><Button variant="secondary" onClick={() => setDlg(null)}>{t('Cancelar')}</Button><Button onClick={save} disabled={!dlg.name.trim()}>{t('Guardar')}</Button></>}>
          <div className="grid gap-4">
            <Field label={t('Nombre')} required><Input value={dlg.name} onChange={(e) => setDlg({ ...dlg, name: e.target.value })} /></Field>
            <Field label={t('Categoría padre')}><Select value={dlg.parentId} onChange={(e) => setDlg({ ...dlg, parentId: e.target.value })}><option value="">{t('— Categoría principal —')}</option>{roots.filter((r: any) => r.id !== dlg.id).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
            <Field label={t('Estado')}><Select value={dlg.status} onChange={(e) => setDlg({ ...dlg, status: e.target.value })}><option value="ACTIVE">{t('Activa')}</option><option value="INACTIVE">{t('Inactiva')}</option></Select></Field>
            <Field label={t('Orden')}><Input inputMode="numeric" value={dlg.sortOrder} onChange={(e) => setDlg({ ...dlg, sortOrder: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
        </Dialog>
      )}
    </>
  );
}
