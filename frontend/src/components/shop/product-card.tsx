'use client';
import Link from 'next/link';
import { Heart, ImageOff, ShoppingCart, Star, Store } from 'lucide-react';
import { useState } from 'react';
import { money, cn } from '@/lib/utils';
import { useToggleFavorite } from './hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAddToCart } from './hooks';
import { t, getIntlLocale } from '@/lib/i18n';
import { AvailabilityLine } from './availability';

export interface ProductCardData {
  id: string;
  slug: string;
  title: string;
  price: string | null;
  compareAtPrice?: string | null;
  discountPercent?: number | null;
  imageUrl: string | null;
  rating: number;
  reviewCount: number;
  stock?: number;
  preorderAvailable?: boolean;
  affiliateCommissionEnabled?: boolean;
  seller: { id: string; name: string; slug: string; verified?: boolean };
}

/** Widths the API resizes to (MEDIA_WIDTHS in backend/src/media/media.controller.ts). */
const MEDIA_WIDTHS = [160, 320, 480, 640, 960, 1280];
/** Product cards: 2 columns on phones up to 6 on wide screens. */
export const CARD_SIZES = '(min-width: 1280px) 15vw, (min-width: 1024px) 24vw, (min-width: 640px) 32vw, 48vw';

/**
 * Catalog image. Our own media (/api/media/<id>) gets a srcSet of resized copies so the browser downloads
 * only the size it shows; `sizes` says how wide it is displayed. `priority` is for the first, visible image.
 */
export function ProductImage({ src, alt, className, sizes, priority }: { src?: string | null; alt: string; className?: string; sizes?: string; priority?: boolean }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // Fixed-size thumbnails (size-10 … size-28) need only that many pixels; anything else is a card.
  const fixed = /(?:^|\s)size-(\d+)(?:\s|$)/.exec(className ?? '');
  sizes ??= fixed ? `${Number(fixed[1]) * 4}px` : CARD_SIZES;
  if (!src || src === failedSrc)
    return (
      <div className={cn('grid place-items-center bg-gradient-to-br from-brand-50 to-brand-100 text-brand-300', className)}>
        <ImageOff className="size-8" />
      </div>
    );
  const own = /^\/api\/media\/[0-9a-f-]{36}$/i.test(src);
  return (
    <img
      src={own ? `${src}?w=640` : src}
      srcSet={own ? MEDIA_WIDTHS.map((w) => `${src}?w=${w} ${w}w`).join(', ') : undefined}
      sizes={own ? sizes : undefined}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      onError={() => setFailedSrc(src)}
      className={cn('object-contain', className)}
    />
  );
}

export function Stars({ value, count, countLabel, size = 'sm' }: { value: number; count?: number; countLabel?: string; size?: 'sm' | 'md' }) {
  const textClass = cn('text-muted', size === 'sm' ? 'text-xs' : 'text-sm');
  if (!value || count === 0) return <span className={textClass}>{t('Sin valoraciones')}</span>;

  return (
    <span className={cn('inline-flex items-center gap-1', textClass)}>
      <Star aria-hidden="true" className={cn('fill-amber-400 text-amber-400', size === 'sm' ? 'size-3.5' : 'size-4')} />
      <b className="font-semibold text-ink">{value.toFixed(1)}</b>
      {count !== undefined && <span>({count.toLocaleString(getIntlLocale())}{countLabel && ` ${countLabel}`})</span>}
    </span>
  );
}

export function ProductCard({ p, showAddToCart, isFavorite }: { p: ProductCardData; showAddToCart?: boolean; isFavorite?: boolean }) {
  const { me } = useAuth();
  const canEarnCommission = p.affiliateCommissionEnabled === true && !me?.sellers.some((seller) => seller.id === p.seller.id);
  const fav = useToggleFavorite();
  const cart = useAddToCart();
  const [adding, setAdding] = useState(false);
  const quickAdd = async () => {
    setAdding(true);
    try {
      const d = await get(`/products/${p.slug}`);
      const v = d.variants.find((x: any) => x.stock > 0) ?? d.variants[0];
      if (d.variants.length > 1) {
        window.location.href = `/producto/${p.slug}`;
        return;
      }
      if (v) await cart.add(v.id, 1);
    } finally {
      setAdding(false);
    }
  };
  const out = p.stock !== undefined && p.stock <= 0;
  const upcoming = out && p.preorderAvailable;
  return (
    <div className="group card relative flex flex-col overflow-hidden p-2.5 transition hover:-translate-y-0.5 hover:shadow-lg">
      <button
        onClick={() => fav.toggle(p.id)}
        className="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-full bg-white/90 text-ink shadow-sm transition hover:text-brand-600"
        aria-label={t('Agregar a favoritos')}
      >
        <Heart className={cn('size-4', isFavorite && 'fill-brand-600 text-brand-600')} />
      </button>
      <Link href={`/producto/${p.slug}`} className="block">
        <div className="relative aspect-[5/4] overflow-hidden rounded-xl bg-surface">
          <ProductImage src={p.imageUrl} alt={p.title} className="size-full object-cover transition duration-300 group-hover:scale-105" />
          {p.discountPercent ? <span className="absolute left-2 top-2 rounded-md bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">-{p.discountPercent}%</span> : null}
          {out && <span className={cn('absolute bottom-2 left-2 rounded-md px-2 py-0.5 text-xs font-semibold', upcoming ? 'bg-amber-100 text-amber-900' : 'bg-ink/80 text-white')}>
            {t(upcoming ? 'Próximamente en stock' : 'Agotado')}
          </span>}
        </div>
        <h3 className="mt-2 line-clamp-2 min-h-10 text-sm font-bold leading-5 text-ink">{p.title}</h3>
      </Link>
      <div className="mt-1 flex items-center justify-between gap-2">
        <Link href={`/tienda/${p.seller.slug}`} className="flex min-w-0 items-center gap-1 text-xs text-muted hover:text-brand-700">
          <Store className="size-3.5 shrink-0" /> <span className="truncate">{p.seller.name}</span>
        </Link>
        {p.reviewCount > 0 && <span className="shrink-0"><Stars value={p.rating} count={p.reviewCount} /></span>}
      </div>
      <AvailabilityLine productId={p.id} className="mt-1" />
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="whitespace-nowrap text-lg font-extrabold">{p.price ? money(p.price) : '—'}</span>
        {p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price) && <span className="whitespace-nowrap text-xs text-muted line-through">{money(p.compareAtPrice)}</span>}
      </div>
      {canEarnCommission && (
        <Badge tone="green" className="mt-1.5 self-start whitespace-normal">{t('Gana comisión al compartir')}</Badge>
      )}
      {showAddToCart && (upcoming ? (
        <Button asChild size="sm" className="mt-2 w-full" variant="secondary"><Link href={`/producto/${p.slug}`}>{t('Ver preorden')}</Link></Button>
      ) : (
        <Button size="sm" className="mt-2 w-full" onClick={quickAdd} loading={adding} disabled={out}>
          <ShoppingCart /> {out ? t('Agotado') : t('Añadir al carrito')}
        </Button>
      ))}
    </div>
  );
}

export function ProductGrid({ items, showAddToCart, cols = 'lg:grid-cols-6' }: { items: ProductCardData[]; showAddToCart?: boolean; cols?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4', cols)}>
      {items.map((p) => (
        <ProductCard key={p.id} p={p} showAddToCart={showAddToCart} />
      ))}
    </div>
  );
}
