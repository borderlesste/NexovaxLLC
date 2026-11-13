'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Box, Check, CreditCard, Package, Plus, ShoppingCart, TrendingUp, Truck } from 'lucide-react';
import { get } from '@/lib/api';
import { money, relative } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Empty, PageLoader } from '@/components/ui/misc';
import { AreaTrend, Donut } from '@/components/charts/charts';
import { ProductImage } from '@/components/shop/product-card';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';

const MIX: Record<string, string> = { DELIVERED: 'Entregados', FULFILLED: 'Preparando', PARTIALLY_FULFILLED: 'Preparando', UNFULFILLED: 'Pendientes', SHIPPED: 'Enviados', PARTIALLY_SHIPPED: 'Enviados', PARTIALLY_DELIVERED: 'Enviados' };

export default function SellerDashboard() {
  const { me } = useAuth();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['seller-dashboard', days], queryFn: () => get(`/seller/dashboard?days=${days}`) });
  const store = useQuery({ queryKey: ['seller-store'], queryFn: () => get('/seller/store') });
  if (q.isLoading) return <PageLoader />;
  const d = q.data;
  const mixMap = new Map<string, number>();
  for (const m of d.statusMix) mixMap.set(MIX[m.status] ?? t('Otros'), (mixMap.get(MIX[m.status] ?? t('Otros')) ?? 0) + m.count);
  const totalOrders = [...mixMap.values()].reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader crumbs={[{ label: t('Mi tienda') }, { label: t('Dashboard') }]} title={t('Dashboard')} description={t('Bienvenido a {a}. Este es el resumen de tu tienda.', { a: store.data?.displayName ?? t('tu tienda') })}
        actions={<><Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-44"><option value={7}>{t('Últimos 7 días')}</option><option value={30}>{t('Últimos 30 días')}</option><option value={90}>{t('Últimos 90 días')}</option></Select><Button asChild><Link href="/vendedor/productos/nuevo"><Plus /> {t('Agregar producto')}</Link></Button></>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Ventas de mi tienda')} value={money(d.kpis.sales)} icon={<CreditCard />} change={d.kpis.salesChange} hint={t('vs. período anterior')} />
        <StatCard label={t('Pedidos recibidos')} value={d.kpis.orders} icon={<ShoppingCart />} change={d.kpis.ordersChange} hint={t('vs. período anterior')} />
        <StatCard label={t('Productos publicados')} value={d.kpis.activeProducts} icon={<Box />} hint={t('en mi catálogo')} />
        <StatCard label={t('Pedidos por atender')} value={d.kpis.pendingOrders} icon={<Truck />} tone={d.kpis.pendingOrders ? 'amber' : 'brand'} hint={t('preparar o despachar')} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t('Ventas de mi tienda')} subtitle={t('Comportamiento durante el período')} />
          <div className="p-4"><AreaTrend data={d.series} /></div>
        </Card>
        <Card>
          <CardHeader title={t('Mis pedidos')} subtitle={t('Resumen de pedidos de la tienda')} />
          <div className="p-5">
            <Donut data={[...mixMap.entries()].map(([name, value]) => ({ name, value }))} total={totalOrders} label={t('pedidos')} />
            <p className="mt-5 border-t border-line pt-4 text-xs text-muted"><Truck className="mr-1 inline size-4" /> {t('Tienes')}{' '}<b className="text-ink">{d.kpis.pendingOrders} {t('pedidos')}</b> {t('que requieren preparación y seguimiento.')}</p>
          </div>
        </Card>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t('Inventario y disponibilidad')} subtitle={t('Productos que requieren seguimiento')} action={<Link href="/vendedor/inventario" className="text-sm font-semibold text-brand-700">{t('Ver inventario →')}</Link>} />
          {d.lowStock.length ? (
            <div className="grid sm:grid-cols-2">
              {d.lowStock.map((i: any) => (
                <div key={i.variantId} className="flex items-center gap-3 border-b border-line px-5 py-4 sm:odd:border-r">
                  <ProductImage src={i.imageUrl} alt={i.title} className="size-14 shrink-0 rounded-xl bg-surface" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{i.title}</p><p className="truncate text-xs text-muted">{i.variantTitle ? `${i.variantTitle} · ` : ''}{t('Stock disponible:')}{' '}{i.available}</p></div>
                  <StatusBadge status={i.state} label={i.state === 'OK' ? t('Disponible') : i.state === 'LOW' ? t('Stock bajo') : t('Stock agotado')} />
                </div>
              ))}
            </div>
          ) : <Empty icon={<Package />} title={t('Aún no tienes productos')} action={<Button asChild size="sm"><Link href="/vendedor/productos/nuevo">{t('Crear producto')}</Link></Button>} />}
        </Card>
        <Card>
          <CardHeader title={t('Actividad reciente')} subtitle={t('Novedades de tu tienda')} />
          {d.activity.length ? (
            <ul className="divide-y divide-line">
              {d.activity.map((a: any, i: number) => (
                <li key={i} className="flex gap-3 px-5 py-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">{a.kind === 'ORDER' ? <ShoppingCart className="size-4" /> : a.title.includes('rechazado') ? <AlertTriangle className="size-4" /> : <Check className="size-4" />}</span>
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{a.title}</p><p className="truncate text-xs text-muted">{a.detail}</p></div>
                  <span className="shrink-0 text-xs text-muted">{relative(a.at)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty icon={<TrendingUp />} title={t('Sin actividad todavía')} />}
        </Card>
      </div>
      <p className="mt-6 text-right text-xs text-muted">{t('Hola')}{' '}{me?.firstName ?? me?.displayName}{t(', los datos se actualizan en tiempo real.')}</p>
    </>
  );
}
