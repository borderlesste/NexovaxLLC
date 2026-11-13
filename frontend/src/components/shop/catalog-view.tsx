'use client';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { get } from '@/lib/api';
import { ProductGrid } from './product-card';
import { CategoryIcon } from './category-icon';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Empty, ErrorBox, Pagination, Skeleton, Checkbox } from '@/components/ui/misc';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn, currencySymbol } from '@/lib/utils';
import { t, getIntlLocale } from '@/lib/i18n';

const SORTS = [
  ['relevance', 'Más relevantes'],
  ['newest', 'Más recientes'],
  ['best_selling', 'Más vendidos'],
  ['price_asc', 'Precio: menor a mayor'],
  ['price_desc', 'Precio: mayor a menor'],
  ['rating', 'Mejor valorados'],
];

function findPath(tree: any[], slug: string, path: any[] = []): any[] | null {
  for (const c of tree) {
    if (c.slug === slug) return [...path, c];
    const r = findPath(c.children ?? [], slug, [...path, c]);
    if (r) return r;
  }
  return null;
}

export function CatalogView({ categorySlug }: { categorySlug?: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [showFilters, setShowFilters] = useState(false);
  const params = useMemo(() => {
    const p = new URLSearchParams(sp.toString());
    if (categorySlug) p.set('category', categorySlug);
    if (!p.get('pageSize')) p.set('pageSize', '24');
    return p;
  }, [sp, categorySlug]);
  const set = (k: string, v?: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== 'page') p.delete('page');
    router.push(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const q = useQuery({ queryKey: ['products', params.toString()], queryFn: () => get(`/products?${params.toString()}`) });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get('/categories'), staleTime: 300_000 });
  const path = categorySlug && cats.data ? findPath(cats.data, categorySlug) ?? [] : [];
  const current = path[path.length - 1];
  const siblings = current ? (current.children?.length ? current.children : path.length > 1 ? path[path.length - 2].children : cats.data) : cats.data;
  const [min, setMin] = useState(sp.get('minPrice') ?? '');
  const [max, setMax] = useState(sp.get('maxPrice') ?? '');
  const title = current?.name ?? (sp.get('q') ? t('Resultados para “{a}”', { a: sp.get('q') }) : sp.get('onSale') ? t('Ofertas') : t('Todos los productos'));

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">
      <Breadcrumbs items={[{ label: t('Catálogo'), href: '/catalogo' }, ...path.map((c: any) => ({ label: t(c.name), href: `/catalogo/categorias/${c.slug}` }))]} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold sm:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-muted">{q.data ? `${q.data.total.toLocaleString(getIntlLocale())} ${t('productos')}` : t('Cargando…')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="lg:hidden" onClick={() => setShowFilters((v) => !v)}><SlidersHorizontal /> {t('Filtros')}</Button>
          <span className="hidden text-sm font-semibold sm:inline">{t('Ordenar por:')}</span>
          <Select value={sp.get('sort') ?? 'relevance'} onChange={(e) => set('sort', e.target.value)} className="w-52">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
          </Select>
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className={cn('card h-fit space-y-6 p-5', !showFilters && 'hidden lg:block')}>
          <div className="flex items-center justify-between">
            <p className="text-lg font-bold">{t('Filtros')}</p>
            <Link href={categorySlug ? pathname : '/catalogo'} className="text-sm font-semibold text-brand-700 underline">{t('Limpiar filtros')}</Link>
          </div>
          <div>
            <p className="mb-2 text-sm font-bold">{t('Categoría')}</p>
            <ul className="max-h-72 space-y-0.5 overflow-y-auto pr-1 text-sm scrollbar-thin">
              {(siblings ?? []).map((c: any) => (
                <li key={c.id}>
                  <Link href={`/catalogo/categorias/${c.slug}${sp.toString() ? `?${sp.toString()}` : ''}`} className={cn('flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-brand-50', c.slug === categorySlug && 'bg-brand-50 font-semibold text-brand-700')}>
                    <span className="flex items-center gap-2 truncate"><CategoryIcon slug={c.slug} className="size-4 shrink-0 text-brand-500" /> <span className="truncate">{c.name}</span></span>
                    <span className="text-xs text-muted">{c.productCount}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-sm font-bold">{`${t('Precio')} (${currencySymbol()})`}</p>
            <div className="flex items-center gap-2">
              <Input inputMode="numeric" placeholder={t('Mín.')} value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d]/g, ''))} />
              <span className="text-muted">–</span>
              <Input inputMode="numeric" placeholder={t('Máx.')} value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d]/g, ''))} />
            </div>
            <Button variant="soft" size="sm" className="mt-2 w-full" onClick={() => {
              const p = new URLSearchParams(sp.toString());
              min ? p.set('minPrice', min) : p.delete('minPrice');
              max ? p.set('maxPrice', max) : p.delete('maxPrice');
              p.delete('page');
              router.push(`${pathname}?${p.toString()}`);
            }}>{t('Aplicar precio')}</Button>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-bold">{t('Disponibilidad')}</p>
            <Checkbox checked={sp.get('inStock') === 'true'} onChange={(v) => set('inStock', v ? 'true' : null)} label={t('Solo disponibles')} />
            <Checkbox checked={sp.get('onSale') === 'true'} onChange={(v) => set('onSale', v ? 'true' : null)} label={t('En oferta')} />
          </div>
        </aside>
        <section>
          {q.isError && <ErrorBox message={t("No se pudo cargar el catálogo.")} onRetry={() => q.refetch()} />}
          {q.isLoading && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-80" />)}
            </div>
          )}
          {q.data && q.data.items.length === 0 && (
            <div className="card"><Empty title={t('No encontramos productos')} description={t('Prueba con otros filtros o términos de búsqueda.')} /></div>
          )}
          {q.data && q.data.items.length > 0 && (
            <>
              <ProductGrid items={q.data.items} cols="xl:grid-cols-4" showAddToCart />
              <div className="card mt-6">
                <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => set('page', String(p))} label={t('productos')} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
