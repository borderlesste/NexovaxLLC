'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { get } from '@/lib/api';
import { t } from '@/lib/i18n';
import { CONSENT_EVENT, visitorId } from '@/lib/consent';
import { ProductCard } from './product-card';

const TITLES: Record<string, [string, string]> = {
  FOR_YOU: ['Recomendado para ti', 'Según lo que has visto y guardado'],
  POPULAR: ['Lo más popular', 'Lo que más interesa a otros compradores esta semana'],
  FOR_YOU_RELATED: ['También te puede interesar', 'Según este producto y lo que has visto'],
  RELATED: ['Quienes vieron esto también vieron', 'Productos parecidos y relacionados'],
  COMPLETE_CART: ['Completa tu compra', 'Otros compradores también llevaron'],
};

/**
 * Recommendation strip. Personalized only with analytics consent; otherwise popular /
 * similar products. Renders nothing when there is nothing to show.
 */
export function Recommendations({ context, productId, limit = 8, className, gridClassName, fallback, reserveSpace }: {
  context: 'home' | 'product' | 'cart'; productId?: string; limit?: number; className?: string; gridClassName?: string; fallback?: React.ReactNode;
  /** Show placeholders while loading (for sections above other content, e.g. the home page). */
  reserveSpace?: boolean;
}) {
  const [consentKey, setConsentKey] = useState(0);
  useEffect(() => {
    const on = () => setConsentKey((k) => k + 1);
    window.addEventListener(CONSENT_EVENT, on);
    return () => window.removeEventListener(CONSENT_EVENT, on);
  }, []);
  const q = useQuery({
    queryKey: ['recommendations', context, productId ?? '', limit, consentKey],
    queryFn: () => {
      const vid = visitorId();
      return get<any>(`/recommendations?context=${context}&limit=${limit}${productId ? `&productId=${productId}` : ''}${vid ? `&visitorId=${vid}` : ''}`);
    },
    staleTime: 60_000,
  });
  const grid = gridClassName ?? 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6';
  // While loading, hold the space the section will take so the content below doesn't jump (layout shift).
  if (q.isLoading && reserveSpace)
    return (
      <section className={className} aria-busy="true" data-recommendations-loading>
        <div className="mb-4 h-[52px]"><div className="h-7 w-56 rounded bg-surface" /></div>
        <div className={grid}>
          {Array.from({ length: limit }).map((_, i) => (
            <div key={i} className="card overflow-hidden"><div className="aspect-square bg-surface" /><div className="space-y-2 p-3"><div className="h-3 w-4/5 rounded bg-surface" /><div className="h-3 w-1/2 rounded bg-surface" /><div className="h-4 w-1/3 rounded bg-surface" /></div></div>
          ))}
        </div>
      </section>
    );
  if (!q.data?.items?.length) return q.isLoading ? null : <>{fallback ?? null}</>;
  const [title, subtitle] = TITLES[q.data.title] ?? TITLES.POPULAR;
  return (
    <section className={className} data-recommendations={q.data.title}>
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">{q.data.personalized && <Sparkles className="size-5 text-brand-600" />}{t(title)}</h2>
        <p className="text-sm text-muted">{t(subtitle)}</p>
      </div>
      <div className={grid}>
        {q.data.items.map((p: any) => <ProductCard key={p.id} p={p} />)}
      </div>
    </section>
  );
}
