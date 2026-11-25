'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { get } from '@/lib/api';
import { t } from '@/lib/i18n';
import { cn, money } from '@/lib/utils';
import { clearRecentlyViewed, recentlyViewed, RECENTLY_VIEWED_EVENT } from '@/lib/recently-viewed';
import { ProductCardData, ProductGrid } from './product-card';
import { SectionHeading } from './home-blocks';

/** "Vistos recientemente": products this browser opened, newest first. Hidden when there are none. */
export function RecentlyViewed({ title, limit, gap, className }: { title?: string; limit: number; gap: string; className?: string }) {
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => {
    const load = () => setIds(recentlyViewed());
    load();
    window.addEventListener(RECENTLY_VIEWED_EVENT, load);
    return () => window.removeEventListener(RECENTLY_VIEWED_EVENT, load);
  }, []);
  const want = (ids ?? []).slice(0, Math.min(24, limit + 6)); // a few spare in case some are no longer for sale
  const q = useQuery({
    queryKey: ['recently-viewed', want.join(',')],
    queryFn: () => get<{ items: ProductCardData[] }>(`/products?ids=${want.join(',')}&pageSize=24`),
    enabled: want.length > 0,
    staleTime: 60_000,
  });
  if (!want.length || !q.data?.items?.length) return null;
  const byId = new Map(q.data.items.map((p) => [p.id, p]));
  const items = want.map((id) => byId.get(id)).filter(Boolean).slice(0, limit) as ProductCardData[];
  if (!items.length) return null;
  return (
    <section className={className} data-home-section="recently_viewed">
      <SectionHeading
        title={title || t('Vistos recientemente')}
        subtitle={t('Retoma donde lo dejaste')}
        extra={
          <button type="button" onClick={clearRecentlyViewed} className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink">
            <History className="size-3.5" /> {t('Borrar historial')}
          </button>
        }
      />
      <ProductGrid items={items} showAddToCart hideSeller gap={gap} />
    </section>
  );
}

/** "Por rango de precio": one tab per amount ("Menos de US$ 10"…), each with its products and a link to all of them. */
export function PriceRanges({ title, ranges, gap, className }: { title?: string; ranges: { max: number; items: ProductCardData[] }[]; gap: string; className?: string }) {
  const [i, setI] = useState(0);
  const cur = ranges[Math.min(i, ranges.length - 1)];
  if (!cur) return null;
  return (
    <section className={className} data-home-section="price_ranges">
      <SectionHeading title={title || t('Por rango de precio')} href={`/catalogo?maxPrice=${cur.max}`} linkLabel={t('Ver todo')} />
      <div className="mb-3 flex flex-wrap gap-2" role="tablist">
        {ranges.map((r, j) => (
          <button
            key={r.max}
            type="button"
            role="tab"
            aria-selected={j === i}
            onClick={() => setI(j)}
            className={cn('rounded-full border px-3.5 py-1.5 text-sm font-semibold transition', j === i ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink hover:border-brand-300')}
          >
            {t('Menos de {a}', { a: money(r.max) })}
          </button>
        ))}
      </div>
      <ProductGrid items={cur.items} showAddToCart hideSeller gap={gap} />
    </section>
  );
}
