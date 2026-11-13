'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Box, ChevronRight, CreditCard, Download, Landmark, MessageSquare, Package, ShoppingCart, TrendingUp, Users, Wallet } from 'lucide-react';
import { get } from '@/lib/api';
import { fmtDate, money } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Empty, PageLoader, Pills } from '@/components/ui/misc';
import { AreaTrend, Donut } from '@/components/charts/charts';
import { t, getIntlLocale } from '@/lib/i18n';

const MIX: Record<string, string> = { DELIVERED: 'Completados', COMPLETED: 'Completados', CLOSED: 'Completados', PROCESSING: 'En proceso', SHIPPED: 'Enviados', PARTIALLY_SHIPPED: 'Enviados', PARTIALLY_DELIVERED: 'Enviados', PREPARING: 'En proceso', PAID: 'En proceso', PENDING: 'Pendientes', PENDING_PAYMENT: 'Pendientes', CANCELLED: 'Cancelados', RETURNED: 'Devueltos', REFUNDED: 'Devueltos' };

function download(name: string, rows: any[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
}

export default function AdminDashboard() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['admin-dashboard', days], queryFn: () => get(`/admin/dashboard?days=${days}`) });
  if (q.isLoading) return <PageLoader />;
  const d = q.data;
  const mix = new Map<string, number>();
  for (const m of d.statusMix) mix.set(MIX[m.status] ?? t('Otros'), (mix.get(MIX[m.status] ?? t('Otros')) ?? 0) + m.count);
  const totalMix = [...mix.values()].reduce((a, b) => a + b, 0);
  const a = d.attention;
  const attention = [
    a.products_pending && { icon: Box, title: t('Productos por revisar'), detail: t('{a} publicaciones esperan moderación.', { a: a.products_pending }), href: '/admin/moderacion' },
    a.sellers_pending && { icon: Users, title: t('Nuevas solicitudes'), detail: t('{a} tiendas solicitan aprobación.', { a: a.sellers_pending }), href: '/admin/vendedores?status=PENDING_VERIFICATION' },
    a.transfers_pending && { icon: Landmark, title: t('Transferencias por confirmar'), detail: t('{a} pagos por transferencia esperan validación.', { a: a.transfers_pending }), href: '/admin/finanzas' },
    a.payouts_pending && { icon: Wallet, title: t('Retiros pendientes'), detail: t('{a} solicitudes de retiro por aprobar.', { a: a.payouts_pending }), href: '/admin/comisiones' },
    a.payout_accounts_pending && { icon: CreditCard, title: t('Métodos de cobro'), detail: t('{a} cuentas bancarias por verificar.', { a: a.payout_accounts_pending }), href: '/admin/comisiones' },
    a.low_stock && { icon: AlertTriangle, title: t('Alerta de inventario'), detail: t('{a} productos llegaron al mínimo.', { a: a.low_stock }), href: '/admin/productos' },
    a.open_tickets && { icon: MessageSquare, title: t('Reportes abiertos'), detail: `${a.open_tickets} incidencias requieren seguimiento.`, href: '/admin/reportes' },
  ].filter(Boolean) as any[];
  return (
    <>
      <PageHeader crumbs={[{ label: t('Inicio') }, { label: t('Dashboard') }]} title={t('Dashboard')} description={t('Visión general del rendimiento de tu marketplace.')}
        actions={<><Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-44"><option value={7}>{t('Últimos 7 días')}</option><option value={30}>{t('Últimos 30 días')}</option><option value={90}>{t('Últimos 90 días')}</option></Select>
          <Button onClick={() => download(`informe-${days}d.csv`, [[t('Día'), t('Ventas'), t('Pedidos')], ...d.series.map((s: any) => [s.day, s.sales, s.orders])])}><Download /> {t('Exportar informe')}</Button></>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Ventas totales')} value={money(d.kpis.sales)} icon={<CreditCard />} change={d.kpis.salesChange} hint={t('vs. período anterior')} />
        <StatCard label={t('Pedidos realizados')} value={d.kpis.orders.toLocaleString(getIntlLocale())} icon={<ShoppingCart />} change={d.kpis.ordersChange} hint={t('vs. período anterior')} />
        <StatCard label={t('Vendedores activos')} value={d.kpis.activeSellers} icon={<Users />} hint={t('de {a} registrados', { a: d.kpis.totalSellers })} />
        <StatCard label={t('Productos publicados')} value={d.kpis.activeProducts.toLocaleString(getIntlLocale())} icon={<Package />} hint={t('de {a} en catálogo', { a: d.kpis.totalProducts })} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t('Resumen de ventas')} subtitle={t('Ingresos registrados durante el período')} action={<Pills value={String(days)} onChange={(v) => setDays(Number(v))} options={[{ value: '7', label: t('7 días') }, { value: '30', label: t('30 días') }, { value: '90', label: t('90 días') }]} />} />
          <div className="p-4"><AreaTrend data={d.series} /></div>
        </Card>
        <Card>
          <CardHeader title={t('Estado de los pedidos')} subtitle={t('Distribución de los pedidos')} />
          <div className="p-5"><Donut data={[...mix.entries()].map(([name, value]) => ({ name, value }))} total={totalMix.toLocaleString(getIntlLocale())} label={t('pedidos')} />
            <p className="mt-5 flex items-center gap-2 border-t border-line pt-4 text-xs text-muted"><TrendingUp className="size-4" /> {t('El volumen de pedidos')}{' '}{d.kpis.ordersChange != null ? <>{t('cambió')}{' '}<b className={d.kpis.ordersChange >= 0 ? 'text-emerald-600' : 'text-red-600'}>{d.kpis.ordersChange.toFixed(1)} %</b> {t('respecto al período anterior.')}</> : t('se compara con el período anterior cuando hay datos.')}</p>
          </div>
        </Card>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t('Pedidos recientes')} subtitle={t('Últimas transacciones del marketplace')} action={<Link href="/admin/pedidos" className="text-sm font-semibold text-brand-700">{t('Ver todos →')}</Link>} />
          {d.recentOrders.length ? (
            <table className="w-full text-sm"><thead className="bg-surface text-left text-xs text-muted"><tr><th className="px-5 py-2.5">{t('Pedido')}</th><th>{t('Cliente')}</th><th>{t('Fecha')}</th><th>{t('Total')}</th><th>{t('Estado')}</th><th /></tr></thead>
              <tbody className="divide-y divide-line">{d.recentOrders.map((o: any) => (
                <tr key={o.id}><td className="px-5 py-3 font-bold">#{o.number}</td><td>{o.customer}</td><td className="text-muted">{fmtDate(o.placed_at)}</td><td className="font-semibold">{money(o.total)}</td><td><StatusBadge status={o.status} /></td><td className="pr-5 text-right"><Link href={`/admin/pedidos/${o.id}`} className="font-semibold text-brand-700">{t('Ver detalle')}</Link></td></tr>
              ))}</tbody></table>
          ) : <Empty icon={<ShoppingCart />} title={t('Aún no hay pedidos')} />}
        </Card>
        <Card>
          <CardHeader title={t('Actividad que requiere atención')} subtitle={t('Acciones pendientes en la plataforma')} />
          {attention.length ? (
            <ul className="divide-y divide-line">{attention.map((x: any) => (
              <li key={x.title}><Link href={x.href} className="flex gap-3 px-5 py-4 hover:bg-surface"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><x.icon className="size-4" /></span><span className="flex-1"><b className="block text-sm">{x.title}</b><span className="text-xs text-muted">{x.detail}</span></span><ChevronRight className="size-4 self-center text-muted" /></Link></li>
            ))}</ul>
          ) : <Empty title={t('Todo al día')} description={t('No hay acciones pendientes.')} />}
        </Card>
      </div>
    </>
  );
}
