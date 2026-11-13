'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, Check, Coins, Download, Percent, Store, Users } from 'lucide-react';
import { get } from '@/lib/api';
import { fmtDate, money } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Empty, PageLoader, Segmented } from '@/components/ui/misc';
import { Bars } from '@/components/charts/charts';
import { PayoutActions } from '@/components/admin/payout-actions';

const monthLabel = (m: string) => new Date(m + '-15').toLocaleDateString('es-DO', { month: 'short', year: 'numeric' });

export default function CommissionsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'commissions' | 'payouts' | 'history'>('commissions');
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['admin-commissions'], queryFn: () => get('/admin/commissions') });
  if (q.isLoading) return <PageLoader />;
  const d = q.data;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-commissions'] }); qc.invalidateQueries({ queryKey: ['admin-attention'] }); };
  const sellers = d.sellers.filter((s: any) => s.name.toLowerCase().includes(search.toLowerCase()));
  const pending = d.payouts.filter((p: any) => ['APPROVAL_REQUIRED', 'REQUESTED', 'APPROVED', 'PROCESSING'].includes(p.status));
  const history = d.payouts.filter((p: any) => !pending.includes(p));
  const exportCsv = () => {
    const rows = [['Vendedor', 'Código', 'Ventas', 'Comisión', 'Neto', 'Disponible'], ...d.sellers.map((s: any) => [s.name, s.code, s.sales, s.commission, s.net, s.available])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r: any[]) => r.map((x) => `"${x}"`).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = 'comisiones.csv'; a.click();
  };
  const payoutTable = (rows: any[], actions: boolean) => rows.length ? (
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
      <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">Retiro</th><th>Vendedor</th><th>Destino</th><th>Monto</th><th>Solicitado</th><th>Estado</th><th /></tr></thead>
      <tbody className="divide-y divide-line">{rows.map((p: any) => (
        <tr key={p.id}><td className="px-5 py-3 font-bold">{p.number}</td><td>{p.seller.name}</td><td className="text-muted">{p.account.label} ****{p.account.last4}</td><td className="font-semibold">{money(p.amount)}</td>
          <td className="text-muted">{fmtDate(p.requestedAt)}{p.paidAt ? <><br />Pagado {fmtDate(p.paidAt)}</> : null}</td><td><StatusBadge status={p.status} /></td>
          <td className="pr-5 text-right">{actions && <PayoutActions p={p} onDone={refresh} />}</td></tr>
      ))}</tbody></table></div>
  ) : <Empty title="No hay retiros" />;
  return (
    <>
      <PageHeader crumbs={[{ label: 'Finanzas' }, { label: 'Comisiones y payouts' }]} title="Comisiones y payouts" description="Gestiona las comisiones del marketplace y las liquidaciones (payouts) de los vendedores."
        actions={<><Button variant="secondary" onClick={exportCsv}><Download /> Exportar reporte</Button><Button asChild><Link href="/admin/configuracion"><Percent /> Comisión: {d.commissionRate != null ? `${(d.commissionRate * 100).toFixed(1)} %` : '—'}</Link></Button></>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Comisión total del mes" value={money(d.kpis.month_commission)} icon={<Percent />} />
        <StatCard label="Payouts pendientes" value={money(d.kpis.payouts_pending)} icon={<Coins />} tone="amber" />
        <StatCard label="Payouts liquidados" value={money(d.kpis.payouts_paid)} icon={<Check />} tone="green" />
        <StatCard label="Vendedores con saldo" value={d.kpis.sellers_with_balance} icon={<Users />} />
      </div>
      <Card className="mt-5">
        <Segmented className="px-3" value={tab} onChange={setTab} options={[{ value: 'commissions', label: 'Comisiones' }, { value: 'payouts', label: 'Liquidaciones', count: pending.length }, { value: 'history', label: 'Historial de pagos' }]} />
        {tab === 'commissions' && (
          <>
            <div className="flex flex-wrap items-center gap-3 p-4"><Input placeholder="Buscar vendedor..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" /><span className="flex items-center gap-1 text-sm text-muted"><Calendar className="size-4" /> Período: {fmtDate(d.period.from)} – {fmtDate(d.period.to)}</span></div>
            {sellers.length ? (
              <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm">
                <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">Vendedor</th><th>Ventas</th><th>Comisión</th><th>Neto vendedor</th><th>Saldo disponible</th><th>Pendiente</th><th>Último pago</th></tr></thead>
                <tbody className="divide-y divide-line">{sellers.map((s: any) => (
                  <tr key={s.id}><td className="px-5 py-3"><Link href={`/admin/vendedores/${s.id}`} className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-brand-50 text-brand-600"><Store className="size-4" /></span><span><b>{s.name}</b><span className="block text-xs text-muted">{s.code}</span></span></Link></td>
                    <td className="font-semibold">{money(s.sales)}</td><td>{money(s.commission)}</td><td>{money(s.net)}</td><td className="font-semibold text-emerald-700">{money(s.available)}</td><td className="text-muted">{money(s.pending)}</td>
                    <td className="text-muted">{s.lastPaidAt ? fmtDate(s.lastPaidAt) : '—'}</td></tr>
                ))}</tbody></table></div>
            ) : <Empty title="Sin vendedores" />}
          </>
        )}
        {tab === 'payouts' && payoutTable(pending, true)}
        {tab === 'history' && payoutTable(history, false)}
      </Card>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card><CardHeader title="Comisiones mensuales" subtitle="Total de comisiones generadas por el marketplace" /><div className="p-4"><Bars data={d.monthly} xKey="month" xFormatter={monthLabel} bars={[{ key: 'commission', name: 'Comisión' }]} /></div></Card>
        <Card>
          <CardHeader title="Próximos payouts" subtitle="Retiros solicitados por los vendedores" />
          {pending.length ? <ul className="divide-y divide-line">{pending.slice(0, 6).map((p: any) => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-3"><span className="grid size-9 place-items-center rounded-lg bg-brand-50 text-brand-600"><Store className="size-4" /></span><span className="flex-1"><b className="block text-sm">{p.seller.name}</b><span className="text-xs text-muted">{p.number}</span></span><b>{money(p.amount)}</b><StatusBadge status={p.status} /></li>
          ))}</ul> : <Empty title="No hay payouts pendientes" />}
        </Card>
      </div>
    </>
  );
}
