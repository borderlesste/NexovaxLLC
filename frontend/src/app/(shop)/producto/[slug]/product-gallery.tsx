'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Heart, Maximize2 } from 'lucide-react';
import { useToggleFavorite } from '@/components/shop/hooks';
import { ProductImage } from '@/components/shop/product-card';
import { ShareButton } from '@/components/shop/share-button';
import { Dialog } from '@/components/ui/misc';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type Photo = { url: string; alt?: string | null; variantId?: string | null };
type GalleryProduct = { id: string; slug: string; title: string; images: Photo[]; isFavorite?: boolean };

export function ProductGallery({ product, variantId, colorVariants }: {
  product: GalleryProduct;
  variantId?: string;
  colorVariants: string[];
}) {
  const { images, title } = product;
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const fav = useToggleFavorite();

  // A photo linked to the same color also applies to sizes without their own photo.
  const current = images.find((im) => im.url === manualUrl)
    ?? images.find((im) => !!variantId && im.variantId === variantId)
    ?? images.find((im) => im.variantId && colorVariants.includes(im.variantId))
    ?? images.find((im) => !im.variantId)
    ?? images[0];
  const index = current ? images.indexOf(current) : 0;
  const multiple = images.length > 1;
  const move = (step: number) => setManualUrl(images[(index + step + images.length) % images.length].url);
  const position = (i: number) => t('Foto {i} de {n}', { i: i + 1, n: images.length });
  const arrows = multiple && (
    <div className="pointer-events-none absolute inset-x-2 top-1/2 flex -translate-y-1/2 justify-between">
      <button type="button" onClick={() => move(-1)} aria-label={t('Foto anterior')} className="pointer-events-auto grid size-10 place-items-center rounded-full border border-black/10 bg-white/95 text-ink shadow hover:bg-white">
        <ChevronLeft aria-hidden className="size-5" />
      </button>
      <button type="button" onClick={() => move(1)} aria-label={t('Foto siguiente')} className="pointer-events-auto grid size-10 place-items-center rounded-full border border-black/10 bg-white/95 text-ink shadow hover:bg-white">
        <ChevronRight aria-hidden className="size-5" />
      </button>
    </div>
  );

  return (
    <section aria-label={t('Fotos del producto')} className="min-w-0">
      <div className="card relative overflow-hidden bg-surface">
        <ProductImage src={current?.url} alt={current?.alt || title} sizes="(min-width: 1400px) 680px, (min-width: 1024px) 50vw, 100vw" priority className="aspect-[5/4] w-full object-cover" />
        <div className="absolute right-3 top-3 flex gap-2">
          <button type="button" onClick={() => fav.toggle(product.id)} aria-pressed={!!product.isFavorite} aria-label={t('Favorito')} className="grid size-10 place-items-center rounded-full bg-white shadow">
            <Heart className={cn('size-5', product.isFavorite && 'fill-brand-600 text-brand-600')} />
          </button>
          <ShareButton product={product} iconOnly className="size-10" />
        </div>
        {arrows}
        {multiple && <span aria-live="polite" aria-atomic="true" className="absolute bottom-3 left-3 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white">{position(index)}</span>}
        {current && (
          <button type="button" onClick={() => setZoom(true)} aria-label={t('Ampliar')} className="absolute bottom-3 right-3 grid size-10 place-items-center rounded-full bg-white shadow">
            <Maximize2 className="size-4" />
          </button>
        )}
      </div>
      {multiple && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {images.map((im, i) => (
            <button type="button" key={im.url} onClick={() => setManualUrl(im.url)} aria-label={position(i)} aria-pressed={i === index} className={cn('size-14 shrink-0 overflow-hidden rounded-lg border-2 sm:size-16', i === index ? 'border-brand-600' : 'border-line')}>
              <ProductImage src={im.url} alt="" sizes="64px" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <Dialog open={zoom} onOpenChange={setZoom} title={title} size="xl">
        <div className="relative">
          <ProductImage src={current?.url} alt={current?.alt || title} sizes="100vw" className="mx-auto h-[65vh] w-full object-contain" />
          {arrows}
        </div>
        {multiple && <p aria-live="polite" className="mt-1 text-center text-sm text-muted">{position(index)}</p>}
      </Dialog>
    </section>
  );
}
