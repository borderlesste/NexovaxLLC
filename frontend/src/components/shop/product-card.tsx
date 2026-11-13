'use client';
import Link from 'next/link';
import { Heart, ImageOff, ShoppingCart, Star, Store } from 'lucide-react';
import { useState } from 'react';
import { money, cn } from '@/lib/utils';
import { useToggleFavorite } from './hooks';
import { Button } from '@/components/ui/button';
import { get } from '@/lib/api';
import { useAddToCart } from './hooks';
import { t, getIntlLocale } from '@/lib/i18n';

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
  seller: { name: string; slug: string; verified?: boolean };
}

export function ProductImage({ src, alt, className }: { src?: string | null; alt: string; className?: string }) {
  const [err, setErr] = useState(false);
  if (!src || err)
    return (
      <div className={cn('grid place-items-center bg-gradient-to-br from-brand-50 to-brand-100 text-brand-300', className)}>
        <ImageOff className="size-8" />
      </div>
    );
  return <img src={src} alt={alt} loading="lazy" onError={() => setErr(true)} className={cn('object-contain', className)} />;
}

export function Stars({ value, count, size = 'sm' }: { value: number; count?: number; size?: 'sm' | 'md' }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-muted', size === 'sm' ? 'text-xs' : 'text-sm')}>
      <Star className={cn('fill-amber-400 text-amber-400', size === 'sm' ? 'size-3.5' : 'size-4')} />
      <b className="font-semibold text-ink">{value ? value.toFixed(1) : '—'}</b>
      {count !== undefined && <span>({count.toLocaleString(getIntlLocale())})</span>}
    </span>
  );
}

export function ProductCard({ p, showAddToCart, isFavorite }: { p: ProductCardData; showAddToCart?: boolean; isFavorite?: boolean }) {
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
  return (
    <div className="group card relative flex flex-col overflow-hidden p-3 transition hover:-translate-y-0.5 hover:shadow-lg">
      <button
        onClick={() => fav.toggle(p.id)}
        className="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-full bg-white/90 text-ink shadow-sm transition hover:text-brand-600"
        aria-label={t('Agregar a favoritos')}
      >
        <Heart className={cn('size-4', isFavorite && 'fill-brand-600 text-brand-600')} />
      </button>
      <Link href={`/producto/${p.slug}`} className="block">
        <div className="relative aspect-square overflow-hidden rounded-xl bg-surface">
          <ProductImage src={p.imageUrl} alt={p.title} className="size-full transition duration-300 group-hover:scale-105" />
          {p.discountPercent ? <span className="absolute left-2 top-2 rounded-md bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">-{p.discountPercent}%</span> : null}
          {out && <span className="absolute bottom-2 left-2 rounded-md bg-ink/80 px-2 py-0.5 text-xs font-semibold text-white">{t('Agotado')}</span>}
        </div>
        <h3 className="mt-3 line-clamp-2 min-h-10 text-sm font-bold leading-5 text-ink">{p.title}</h3>
      </Link>
      <Link href={`/tienda/${p.seller.slug}`} className="mt-1 flex items-center gap-1 truncate text-xs text-muted hover:text-brand-700">
        <Store className="size-3.5 shrink-0" /> <span className="truncate">{p.seller.name}</span>
      </Link>
      <div className="mt-1.5"><Stars value={p.rating} count={p.reviewCount} /></div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <span className="whitespace-nowrap text-lg font-extrabold">{p.price ? money(p.price) : '—'}</span>
        {p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price) && <span className="whitespace-nowrap text-xs text-muted line-through">{money(p.compareAtPrice)}</span>}
      </div>
      {showAddToCart && (
        <Button size="sm" className="mt-3 w-full" onClick={quickAdd} loading={adding} disabled={out}>
          <ShoppingCart /> {out ? t('Agotado') : t('Añadir al carrito')}
        </Button>
      )}
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
