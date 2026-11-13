'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowLeftRight, ArrowUpRight, Ban, Box, Download, Layers, MapPin, Search, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { fmtDateTime, money } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, Empty, PageLoader } from '@/components/ui/misc';
import { AreaTrend } from '@/components/charts/charts';
import { ProductImage } from '@/components/shop/product-card';

function exportCsv(items: any[]) {
  const head = ['SKU', 'Producto', 'Variante', 'Stock actual', 'Reservado', 'Disponible', 'Stock mínimo', 'Precio', 'Valor', 'Ubicación'];
  const rows = items.map((i) => [i.sku, i.title, i.variantTitle ?? '', i.onHand, i.reserved, i.available, i.minStock, i.price ?? '', i.value, i.location]);
  const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `inventario-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

function Inventory() {
  const sp = useSearchParams();
  const qc = useQueryClient();
  const [search, setSearch] = useState(sp.get('search') ?? '');
  const [stock, setStock] = useState('');
  const q = useQuery({ queryKey: ['inventory', search, stock], queryFn: () => get(`/seller/inventory?search=${encodeURIComponent(search)}&stock=${stock}`) });
  const [adj, setAdj] = useState<any>(null);
  const [form, setForm] = useState({ mode: 'ADD', quantity: '', reason: 'STOCK_IN', minStock: '' });
  const [busy, setBusy] = useState(false);
  const open = (i: any) => { setAdj(i); setForm({ mode: 'ADD', quantity: '', reason: 'RESTOCK', minStock: String(i.minStock) }); };
  const save = async () => {
    setBusy(true);
    try {
      await post('/seller/inventory/adjust', { variantId: adj.variantId, mode: form.mode, quantity: Number(form.quantity || 0), reason: form.mode === 'REMOVE' ? form.reason : form.mode === 'ADD' ? 'RESTOCK' : 'MANUAL_ADJUSTMENT', minStock: form.minStock ? Number(form.minStock) : undefined });
      toast.success('Inventario actualizado.');
      setAdj(null);
      qc.invalidateQueries({ queryKey: ['inventory'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (q.isLoading) return <PageLoader />;
  const d = q.data;
  const MV: Record<string, [string, any, string]> = { STOCK_IN: ['Ingreso', ArrowUpRight, 'text-emerald-700 bg-emerald-50'], SALE_COMMIT: ['Salida', ArrowDownRight, 'text-red-600 bg-red-50'], DAMAGE: ['Daño', ArrowDownRight, 'text-red-600 bg-red-50'], LOSS: ['Pérdida', ArrowDownRight, 'text-red-600 bg-red-50'], MANUAL_ADJUSTMENT: ['Ajuste', ArrowLeftRight, 'text-brand-700 bg-brand-50'], RETURN_RESTOCK: ['Devolución', ArrowUpRight, 'text-emerald-700 bg-emerald-50'] };
  return (
    <>
      <PageHeader crumbs={[{ label: 'Mi tienda' }, { label: 'Inventario' }]} title="Inventario" description="Gestiona el stock de tus productos y variantes, controla niveles mínimos y movimientos de inventario."
        actions={<Button variant="secondary" onClick={() => exportCsv(d.items)}><Download /> Exportar</Button>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="SKUs activos" value={d.summary.activeSkus} icon={<Box />} />
        <StatCard label="Bajo stock" value={d.summary.low} icon={<AlertTriangle />} tone="amber" />
        <StatCard label="Sin stock" value={d.summary.out} icon={<Ban />} tone="red" />
        <StatCard label="Valor del inventario" value={money(d.summary.value)} icon={<Layers />} />
      </div>
      <Card className="mt-5">
        <div className="flex flex-wrap gap-3 p-4">
          <Input icon={<Search />} placeholder="Buscar por producto, variante o SKU..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
          <Select value={stock} onChange={(e) => setStock(e.target.value)} className="w-48"><option value="">Existencia: Todos</option><option value="OK">En stock</option><option value="LOW">Bajo stock</option><option value="OUT">Sin stock</option></Select>
        </div>
        {!d.items.length ? <Empty icon={<Box />} title="Sin productos en inventario" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">Producto / Variante</th><th>SKU</th><th>Stock actual</th><th>Reservado</th><th>Stock mínimo</th><th>Estado</th><th>Ubicación</th><th className="pr-5 text-right">Acciones</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.items.map((i: any) => (
                  <tr key={i.variantId}>
                    <td className="px-5 py-3"><div className="flex items-center gap-3"><ProductImage src={i.imageUrl} alt={i.title} className="size-11 rounded-lg bg-surface" /><span><b className="line-clamp-1">{i.title}</b><span className="text-xs text-muted">{i.variantTitle ?? 'Única'}</span></span></div></td>
                    <td><span className="rounded-md border border-line px-2 py-1 font-mono text-xs">{i.sku}</span></td>
                    <td><span className={`rounded-md px-2 py-1 text-xs font-bold ${i.state === 'OUT' ? 'bg-red-50 text-red-600' : i.state === 'LOW' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{i.onHand}</span></td>
                    <td>{i.reserved}</td>
                    <td>{i.minStock}</td>
                    <td><StatusBadge status={i.state} /></td>
                    <td className="text-muted"><span className="flex items-center gap-1"><MapPin className="size-4" /> {i.location}</span></td>
                    <td className="pr-5 text-right"><Button size="sm" variant="secondary" onClick={() => open(i)}><SlidersHorizontal /> Ajustar</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card><CardHeader title="Tendencia de stock" subtitle="Evolución del stock total de tus SKUs (30 días)" /><div className="p-4"><AreaTrend data={d.trend} yKey="stock" currency={false} /></div></Card>
        <Card>
          <CardHeader title="Movimientos recientes" subtitle="Últimos ajustes y cambios de inventario" />
          {d.movements.length ? (
            <table className="w-full text-sm"><thead className="bg-surface text-left text-xs text-muted"><tr><th className="px-5 py-2">Movimiento</th><th>Producto / Variante</th><th>Cantidad</th><th>Fecha</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.movements.map((m: any) => {
                  const [label, Icon, cls] = MV[m.movement_type] ?? [m.movement_type, ArrowLeftRight, 'text-muted bg-surface'];
                  return (
                    <tr key={m.id}><td className="px-5 py-2.5"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}><Icon className="size-3.5" /> {label}</span></td>
                      <td className="truncate">{m.title}{m.variant_title ? ` - ${m.variant_title}` : ''}</td><td className={`font-bold ${m.delta > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{m.delta > 0 ? '+' : ''}{m.delta}</td><td className="text-muted">{fmtDateTime(m.created_at)}</td></tr>
                  );
                })}
              </tbody></table>
          ) : <Empty title="Sin movimientos" />}
        </Card>
      </div>
      <Dialog open={!!adj} onOpenChange={(o) => !o && setAdj(null)} title="Ajustar inventario" description={adj ? `${adj.title} · ${adj.sku} · actual ${adj.onHand} (reservado ${adj.reserved})` : ''}
        footer={<><Button variant="secondary" onClick={() => setAdj(null)}>Cancelar</Button><Button onClick={save} loading={busy}>Guardar ajuste</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de ajuste"><Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="ADD">Ingreso de mercancía</option><option value="REMOVE">Salida (daño, pérdida…)</option><option value="SET">Fijar stock exacto</option></Select></Field>
          <Field label={form.mode === 'SET' ? 'Nuevo stock' : 'Cantidad'}><Input inputMode="numeric" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value.replace(/\D/g, '') })} /></Field>
          {form.mode === 'REMOVE' && <Field label="Motivo"><Select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}><option value="DAMAGE">Producto dañado</option><option value="LOSS">Pérdida</option><option value="MANUAL_ADJUSTMENT">Corrección</option></Select></Field>}
          <Field label="Stock mínimo (alerta)"><Input inputMode="numeric" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
      </Dialog>
    </>
  );
}

export default function InventoryPage() {
  return <Suspense><Inventory /></Suspense>;
}
