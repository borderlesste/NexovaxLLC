'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Circle, Clock, ClipboardCheck, FileText, MessageSquare, Pencil, Search, Store, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { cn, fmtDate, money, relative } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Empty, Pagination, Segmented, Spinner } from '@/components/ui/misc';
import { ProductImage } from '@/components/shop/product-card';

function Moderation() {
  const sp = useSearchParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState('PENDING_REVIEW');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(sp.get('p'));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['moderation', tab, search, page], queryFn: () => get(`/admin/products?status=${tab}&search=${encodeURIComponent(search)}&page=${page}`) });
  useEffect(() => {
    if (!selected && list.data?.items[0] && tab === 'PENDING_REVIEW') setSelected(list.data.items[0].id);
  }, [list.data, selected, tab]);
  const review = useQuery({ queryKey: ['review', selected], queryFn: () => get(`/admin/products/${selected}/review`), enabled: !!selected });
  const c = list.data?.counts;
  const decide = async (decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES') => {
    setBusy(decision);
    try {
      await post(`/admin/products/${selected}/moderate`, { decision, note: note || undefined });
      toast.success(decision === 'APPROVE' ? 'Producto aprobado y publicado.' : decision === 'REJECT' ? 'Producto rechazado.' : 'Se solicitaron cambios al vendedor.');
      setNote('');
      setSelected(null);
      qc.invalidateQueries({ queryKey: ['moderation'] });
      qc.invalidateQueries({ queryKey: ['admin-attention'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const r = review.data;
  const checks = r ? [['Información completa (título, descripción, categoría)', r.checklist.complete], ['Imágenes de calidad y reales del producto', r.checklist.images], ['Precio y stock válidos', r.checklist.priceStock], ['Cumple con las políticas del marketplace', r.checklist.policies]] : [];
  return (
    <>
      <PageHeader crumbs={[{ label: 'Panel' }, { label: 'Moderación' }]} title="Moderación de productos" description="Revisa, aprueba o rechaza los productos enviados por los vendedores del marketplace." />
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Pendientes de revisión" value={c?.pending ?? '—'} icon={<Clock />} />
            <StatCard label="Aprobados hoy" value={c?.approved_today ?? '—'} icon={<Check />} tone="green" />
            <StatCard label="Rechazados hoy" value={c?.rejected_today ?? '—'} icon={<X />} tone="red" />
          </div>
          <Card>
            <Segmented className="px-3" value={tab} onChange={(v) => { setTab(v); setPage(1); setSelected(null); }} options={[
              { value: 'PENDING_REVIEW', label: 'Pendientes', count: c?.pending }, { value: 'ACTIVE', label: 'Aprobados', count: c?.active }, { value: 'REJECTED', label: 'Rechazados', count: c?.rejected },
            ]} />
            <div className="p-4"><Input icon={<Search />} placeholder="Buscar por nombre, SKU o vendedor..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" /></div>
            {list.isLoading ? <div className="grid place-items-center py-10"><Spinner /></div> : !list.data?.items.length ? <Empty icon={<ClipboardCheck />} title="No hay productos en esta cola" /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">Producto</th><th>Vendedor / Tienda</th><th>Fecha de envío</th><th>Categoría</th><th>Estado</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {list.data.items.map((p: any) => (
                      <tr key={p.id} onClick={() => setSelected(p.id)} className={cn('cursor-pointer hover:bg-surface/70', selected === p.id && 'bg-brand-50/70')}>
                        <td className="px-5 py-3"><div className="flex items-center gap-3"><ProductImage src={p.imageUrl} alt="" className="size-12 rounded-lg bg-surface" /><span><b className="line-clamp-1">{p.title}</b><span className="text-xs text-muted">SKU: {p.sku}</span></span></div></td>
                        <td><span className="flex items-center gap-1"><Store className="size-4 text-muted" /> {p.seller.name}</span></td>
                        <td className="text-muted">{fmtDate(p.submittedAt ?? p.updatedAt)}<br /><span className="text-xs">{relative(p.submittedAt ?? p.updatedAt)}</span></td>
                        <td className="text-muted">{p.category}</td><td><StatusBadge status={p.status} label={p.status === 'PENDING_REVIEW' ? 'Pendiente' : undefined} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination page={page} pageSize={20} total={list.data.total} onPage={setPage} label="productos" />
              </div>
            )}
          </Card>
        </div>
        <Card className="h-fit 2xl:sticky 2xl:top-24">
          {!selected ? <Empty icon={<ClipboardCheck />} title="Selecciona un producto" description="Elige un producto de la lista para revisarlo." /> : !r ? <div className="grid place-items-center py-16"><Spinner /></div> : (
            <div>
              <div className="flex items-start justify-between border-b border-line px-5 py-4">
                <div><p className="text-lg font-bold">Revisión del producto</p><p className="text-xs text-muted">Evalúa la información y decide su publicación.</p></div>
                <button onClick={() => setSelected(null)} aria-label="Cerrar"><X className="size-5 text-muted" /></button>
              </div>
              <div className="space-y-5 p-5">
                <div className="flex gap-3">
                  <div className="grid w-[55%] grid-cols-[1fr_56px] gap-2">
                    <ProductImage src={r.media[0]?.url} alt="" className="row-span-3 aspect-square rounded-xl bg-surface" />
                    {r.media.slice(1, 4).map((m: any) => <img key={m.id} src={m.url} alt="" className="aspect-square rounded-lg bg-surface object-contain" />)}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1 text-sm">
                    <p className="text-lg font-extrabold leading-tight">{r.title}</p>
                    <p className="text-muted">SKU: {r.variants[0]?.sku}</p>
                    <p><span className="text-muted">Vendedor:</span> {r.seller.name} <StatusBadge status={r.seller.status} /></p>
                    <p><span className="text-muted">Categoría:</span> {r.category}</p>
                    <p><span className="text-muted">Precio:</span> <b>{r.variants[0]?.price ? money(r.variants[0].price) : '—'}</b></p>
                    <p><span className="text-muted">Stock:</span> <b>{r.variants.reduce((a: number, v: any) => a + v.stock, 0)} unidades</b> · {r.variants.length} variantes</p>
                  </div>
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-2 font-bold"><FileText className="size-4 text-brand-600" /> Descripción del vendedor</p>
                  <p className="max-h-36 overflow-y-auto whitespace-pre-line rounded-xl border border-line bg-surface/60 p-3 text-sm">{r.description}</p>
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-2 font-bold"><ClipboardCheck className="size-4 text-brand-600" /> Checklist de revisión</p>
                  <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                    {checks.map(([t, ok]: any) => <li key={t} className="flex items-center gap-2 px-3 py-2.5">{ok ? <CheckCircle2 className="size-5 text-emerald-500" /> : <Circle className="size-5 text-amber-500" />} {t}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-2 font-bold"><MessageSquare className="size-4 text-brand-600" /> Notas de moderación <span className="font-normal text-muted">(obligatorio al rechazar)</span></p>
                  <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Agrega una nota sobre la revisión de este producto…" />
                  <p className="mt-1 text-right text-xs text-muted">{note.length} / 300</p>
                </div>
                {r.status === 'PENDING_REVIEW' ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Button onClick={() => decide('APPROVE')} loading={busy === 'APPROVE'}><Check /> Aprobar</Button>
                    <Button variant="outline" onClick={() => decide('REQUEST_CHANGES')} loading={busy === 'REQUEST_CHANGES'}><Pencil /> Solicitar cambios</Button>
                    <Button variant="danger" onClick={() => decide('REJECT')} loading={busy === 'REJECT'}><X /> Rechazar</Button>
                  </div>
                ) : <p className="rounded-lg bg-surface p-3 text-center text-sm">Estado actual: <StatusBadge status={r.status} /></p>}
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense><Moderation /></Suspense>;
}
