'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Eye, Heart, Lightbulb, MousePointerClick, Package, Percent, ShoppingCart, TicketPercent } from 'lucide-react';
import { get } from '@/lib/api';
import { money } from '@/lib/utils';
import { getIntlLocale, t } from '@/lib/i18n';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Empty, PageLoader, Pills } from '@/components/ui/misc';
import { Bars } from '@/components/charts/charts';

const day = (d: string) => new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString(getIntlLocale(), { day: '2-digit', month: 'short' });
const ACTION: Record<string, (p: any) => { label: string; href: string; icon: any }> = {
  COUPON: (p) => ({ label: 'Crear cupón', href: `/vendedor/cupones?producto=${p.id}`, icon: TicketPercent }),
  PRICE: (p) => ({ label: 'Cambiar precio u oferta', href: `/vendedor/productos/${p.id}`, icon: Percent }),
  EDIT: (p) => ({ label: 'Mejorar publicación', href: `/vendedor/productos/${p.id}`, icon: Package }),
  STOCK: () => ({ label: 'Reponer inventario', href: '/vendedor/inventario', icon: Package }),
};

export default function SellerStatsPage() {
  const [days, setDays] = useState('30');
  const q = useQuery({ queryKey: ['seller-analytics', days], queryFn: () => get<any>(`/seller/analytics?days=${days}`), placeholderData: (p) => p });
  if (q.isLoading || !q.data) return <PageLoader />;
  const d = q.data;
  const s = d.summary;
  const tips = d.products.filter((p: any) => p.suggestions.length);
  return (
    <>
      <PageHeader crumbs={[{ label: t('Inicio') }, { label: t('Estadísticas') }]} title={t('Estadísticas de tus productos')}
        description={t('Visitas, carritos, favoritos y ventas de cada producto. Son cifras totales: nunca se muestra quién es cada cliente.')}
        actions={<Pills value={days} onChange={setDays} options={[{ value: '7', label: t('7 días') }, { value: '30', label: t('30 días') }, { value: '90', label: t('90 días') }]} />} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" data-stats-summary>
        <StatCard label={t('Visitas')} value={s.views.toLocaleString(getIntlLocale())} icon={<Eye />} hint={t('{n} visitantes', { n: s.visitors.toLocaleString(getIntlLocale()) })} />
        <StatCard label={t('Agregados al carrito')} value={s.addToCart.toLocaleString(getIntlLocale())} icon={<ShoppingCart />} />
        <StatCard label={t('En favoritos')} value={s.favorites.toLocaleString(getIntlLocale())} icon={<Heart />} hint={t('+{n} en el período', { n: s.favoritesAdded })} />
        <StatCard label={t('Pedidos')} value={s.orders.toLocaleString(getIntlLocale())} icon={<Package />} hint={t('Ventas: {a}', { a: money(s.revenue) })} />
        <StatCard label={t('Conversión')} value={s.conversion != null ? `${s.conversion} %` : '—'} icon={<MousePointerClick />} hint={t('Pedidos por cada 100 visitantes')} />
      </div>
      <Card className="mt-5">
        <CardHeader title={t('Actividad diaria')} subtitle={t('Visitas, carritos y pedidos por día')} />
        <div className="p-4"><Bars data={d.series} xKey="day" xFormatter={day} bars={[{ key: 'views', name: t('Visitas') }, { key: 'cart', name: t('Carritos') }, { key: 'orders', name: t('Pedidos') }]} currency={false} /></div>
      </Card>
      {tips.length > 0 && (
        <Card className="mt-5" data-stats-tips>
          <CardHeader icon={<Lightbulb />} title={t('Sugerencias')} subtitle={t('Acciones recomendadas según el comportamiento de tus visitantes')} />
          <ul className="divide-y divide-line">
            {tips.slice(0, 12).map((p: any) => p.suggestions.map((sg: any) => (
              <li key={p.id + sg.code} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm" data-tip={sg.code}>
                <Badge tone={sg.tone}>{p.title}</Badge>
                <span className="min-w-0 flex-1 text-muted">{t(sg.message, sg.params)}</span>
                <span className="flex gap-2">
                  {sg.actions.map((a: string) => {
                    const x = ACTION[a](p);
                    return <Button key={a} size="sm" variant="outline" asChild><Link href={x.href}><x.icon /> {t(x.label)}</Link></Button>;
                  })}
                </span>
              </li>
            )))}
          </ul>
        </Card>
      )}
      <Card className="mt-5">
        <CardHeader title={t('Por producto')} subtitle={t('Ordenado por visitas')} />
        {d.products.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-stats-products>
              <thead className="bg-surface text-left text-xs text-muted">
                <tr><th className="px-5 py-2.5">{t('Producto')}</th><th>{t('Visitas')}</th><th>{t('Visitantes')}</th><th>{t('Tiempo medio')}</th><th>{t('Carrito')}</th><th>{t('Favoritos')}</th><th>{t('Vendidos')}</th><th>{t('Conversión')}</th><th>{t('Stock')}</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.products.map((p: any) => (
                  <tr key={p.id} data-stats-row={p.id}>
                    <td className="px-5 py-3"><Link href={`/producto/${p.slug}`} className="font-semibold hover:text-brand-700">{p.title}</Link>
                      <span className="block text-xs text-muted">{p.price ? money(p.price) : '—'}{p.onSale ? ` · ${t('En oferta')}` : ''}{p.hasCoupon ? ` · ${t('Con cupón')}` : ''}</span></td>
                    <td className="font-semibold">{p.views}</td>
                    <td>{p.visitors}</td>
                    <td>{p.avgDwellSeconds != null ? `${p.avgDwellSeconds} s` : '—'}</td>
                    <td>{p.addToCart}</td>
                    <td>{p.favorites}{p.favoritesAdded > 0 && <span className="ml-1 text-xs text-emerald-700">+{p.favoritesAdded}</span>}</td>
                    <td>{p.units}<span className="block text-xs text-muted">{money(p.revenue)}</span></td>
                    <td>{p.conversion != null ? `${p.conversion} %` : '—'}</td>
                    <td className={p.stock <= 0 ? 'font-semibold text-red-600' : ''}>{p.stock}{p.waiting > 0 && <span className="block text-xs font-normal text-brand-700" data-waiting>{t('{n} esperan', { n: p.waiting })}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={<Eye />} title={t('Aún no hay datos')} description={t('Las estadísticas aparecen cuando tus productos reciben visitas.')} />}
      </Card>
    </>
  );
}
