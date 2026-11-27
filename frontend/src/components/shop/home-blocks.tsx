import Link from 'next/link';
import { ArrowRight, BadgeCheck, Star, Store, Wallet } from 'lucide-react';
import { ProductImage } from './product-card';

/** Title row of a home section: title, optional subtitle/extra and a "Ver todo" link. Strings come translated. */
export function SectionHeading({ title, subtitle, href, linkLabel, extra }: { title: string; subtitle?: string; href?: string; linkLabel?: string; extra?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-extrabold sm:text-2xl">{title}{extra}</h2>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {href && linkLabel && (
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
          {linkLabel} <ArrowRight className="size-4" />
        </Link>
      )}
    </div>
  );
}

export interface HomeStore {
  id: string; slug: string; name: string; shortDescription?: string | null; logoUrl: string | null; bannerUrl: string | null;
  trust?: { payoutVerified: boolean; identityVerified: boolean } | null; products: number; rating: number; reviews: number;
}

/** "Tiendas destacadas": one card per store with logo, rating and product count. */
export function StoreCards({ stores, labels }: { stores: HomeStore[]; labels: { products: (n: number) => string; noReviews: string; identity: string; payout: string } }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:gap-2.5 xl:grid-cols-8" data-top-stores>
      {stores.map((s) => (
        <Link key={s.id} href={`/tienda/${s.slug}`} className="card flex flex-col items-center gap-2 p-3 text-center transition hover:-translate-y-0.5 hover:shadow-lg">
          {s.logoUrl ? (
            <ProductImage src={s.logoUrl} alt={s.name} className="size-14 rounded-full border border-line bg-white object-cover" />
          ) : (
            <span className="grid size-14 place-items-center rounded-full bg-brand-50 text-brand-600"><Store className="size-7" /></span>
          )}
          <span className="flex max-w-full items-center gap-1 text-sm font-bold">
            <span className="truncate">{s.name}</span>
            {s.trust?.identityVerified && <span title={labels.identity} className="inline-flex shrink-0"><BadgeCheck className="size-4 text-brand-600" aria-label={labels.identity} /></span>}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            {s.reviews > 0 ? <><Star className="size-3.5 fill-amber-400 text-amber-400" /><b className="text-ink">{s.rating.toFixed(1)}</b> ({s.reviews})</> : labels.noReviews}
          </span>
          <span className="text-xs text-muted">{labels.products(s.products)}</span>
          {s.trust?.payoutVerified && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><Wallet className="size-3" /> {labels.payout}</span>}
        </Link>
      ))}
    </div>
  );
}
