'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Link2, MousePointerClick, Share2, ShoppingBag, Users } from 'lucide-react';
import { toast } from 'sonner';
import { get } from '@/lib/api';
import { shareUrl } from '@/lib/shares';
import { fmtDate, money } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, PageLoader, Segmented } from '@/components/ui/misc';
import { ProductImage } from '@/components/shop/product-card';

type Filter = 'ALL' | 'SALES' | 'NONE';

export default function SharedLinksPage() {
  const q = useQuery({ queryKey: ['my-shares'], queryFn: () => get<any>('/me/shares') });
  const [filter, setFilter] = useState<Filter>('ALL');
  const links = useMemo(
    () => (q.data?.links ?? []).filter((l: any) => filter === 'ALL' || (filter === 'SALES' ? l.orders > 0 : l.orders === 0)),
    [q.data, filter],
  );
  if (q.isLoading || !q.data) return <PageLoader />;
  const d = q.data;
  const copy = (slug: string, code: string) =>
    navigator.clipboard.writeText(shareUrl(slug, code)).then(() => toast.success(t('Enlace copiado.')));

  return (
    <div data-shared-links>
      <h1 className="text-3xl font-extrabold">{t('Enlaces compartidos')}</h1>
      <p className="text-muted">{t('Los productos que compartiste con tu enlace, cuántas personas lo abrieron y si terminaron en una venta (compras pagadas hasta {d} días después de abrir tu enlace).', { d: d.windowDays })}</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="card p-5"><p className="flex items-center gap-2 text-sm text-muted"><Link2 className="size-4" /> {t('Enlaces')}</p><p className="mt-1 text-2xl font-extrabold">{d.totals.links}</p></div>
        <div className="card p-5"><p className="flex items-center gap-2 text-sm text-muted"><MousePointerClick className="size-4" /> {t('Visitas')}</p><p className="mt-1 text-2xl font-extrabold">{d.totals.clicks}</p></div>
        <div className="card p-5"><p className="flex items-center gap-2 text-sm text-muted"><ShoppingBag className="size-4" /> {t('Con venta')}</p><p className="mt-1 text-2xl font-extrabold text-emerald-700" data-shares-with-sales>{d.totals.withSales}</p></div>
        <div className="card p-5"><p className="flex items-center gap-2 text-sm text-muted"><Users className="size-4" /> {t('Pedidos generados')}</p><p className="mt-1 text-2xl font-extrabold text-brand-700">{d.totals.orders}</p></div>
      </div>

      <div className="card mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
          <p className="flex items-center gap-2 font-bold"><Share2 className="size-5 text-brand-600" /> {t('Mis enlaces')}</p>
          <Segmented<Filter> className="border-b-0" value={filter} onChange={setFilter} options={[
            { value: 'ALL', label: t('Todos') },
            { value: 'SALES', label: t('Con venta') },
            { value: 'NONE', label: t('Sin venta') },
          ]} />
        </div>
        {links.length ? (
          <ul className="divide-y divide-line">
            {links.map((l: any) => (
              <li key={l.code} className="flex flex-wrap items-center gap-4 p-4" data-share-row>
                <Link href={`/producto/${l.product.slug}`} className="size-16 shrink-0 overflow-hidden rounded-xl border border-line bg-white">
                  <ProductImage src={l.product.imageUrl} alt={l.product.title} className="size-full" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/producto/${l.product.slug}`} className="truncate font-semibold hover:text-brand-700">{l.product.title}</Link>
                    {l.orders > 0 ? <Badge tone="green">{t('Con venta')}</Badge> : <Badge tone="gray">{t('Sin venta')}</Badge>}
                    {!l.product.active && <Badge tone="amber">{t('No disponible')}</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {t('Compartido el {a}', { a: fmtDate(l.lastSharedAt) })} · {l.clicks} {t('visitas')} · {l.visitors} {t('compradores interesados')}
                  </p>
                  {l.orders > 0 && (
                    <p className="mt-1 text-sm font-semibold text-emerald-700">
                      {l.orders === 1 ? t('1 pedido') : t('{a} pedidos', { a: l.orders })} · {l.units} {t('unidades')} · {money(l.amount, l.currency)}
                      {l.lastSaleAt && <span className="font-normal text-muted"> · {t('última el {a}', { a: fmtDate(l.lastSaleAt) })}</span>}
                    </p>
                  )}
                </div>
                <Button size="sm" variant="secondary" onClick={() => copy(l.product.slug, l.code)} aria-label={t('Copiar enlace')}><Copy /> {t('Copiar enlace')}</Button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={<Share2 />} title={filter === 'ALL' ? t('Aún no has compartido productos') : t('No hay enlaces en este filtro')}
            description={filter === 'ALL' ? t('Abre un producto y pulsa “Compartir” para obtener tu enlace personal.') : undefined}
            action={filter === 'ALL' ? <Button asChild><Link href="/catalogo">{t('Explorar productos')}</Link></Button> : undefined} />
        )}
      </div>
      <p className="mt-4 text-xs text-muted">
        {t('¿La tienda tiene programa de afiliados? Tu enlace también incluye tu código y las comisiones aparecen en')}{' '}
        <Link href="/cuenta/afiliados" className="font-semibold text-brand-700">{t('Afiliados')}</Link>.
      </p>
    </div>
  );
}
