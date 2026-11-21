import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { serverGet } from '@/lib/server-api';
import { getSeo, pageMetadata } from '@/lib/seo';
import { getT } from '@/lib/i18n/server';
import { ProductDetail } from './product-detail';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await serverGet<any>(`/products/${slug}`, 60);
  const t = await getT();
  if (!p) return { title: t('Producto no encontrado'), robots: { index: false, follow: true } };
  return pageMetadata({
    title: p.seo?.title || p.title,
    description: p.seo?.description || p.shortDescription || p.description,
    path: `/producto/${p.slug}`,
    images: (p.images ?? []).slice(0, 4).map((i: any) => i.url),
    imageAlt: p.images?.[0]?.alt || p.title,
  });
}

/** Product structured data (schema.org) so search results can show price, stock and rating. */
function productJsonLd(p: any, base: string) {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    description: p.shortDescription ?? undefined,
    sku: p.variants?.[0]?.sku ?? undefined,
    image: (p.images ?? []).slice(0, 5).map((i: any) => `${base}${i.url}`),
    brand: p.brand?.name ? { '@type': 'Brand', name: p.brand.name } : undefined,
    category: p.category?.name ?? undefined,
    offers: p.price
      ? {
          '@type': 'Offer',
          url: `${base}/producto/${p.slug}`,
          price: String(p.price),
          priceCurrency: p.currency ?? 'USD',
          availability: Number(p.stock) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          seller: p.seller?.name ? { '@type': 'Organization', name: p.seller.name } : undefined,
        }
      : undefined,
    aggregateRating: p.reviewCount > 0 ? { '@type': 'AggregateRating', ratingValue: Number(p.rating).toFixed(1), reviewCount: p.reviewCount } : undefined,
  };
  // Escape "<" so product text can never close the script tag.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await serverGet<any>(`/products/${slug}`, 0);
  if (!p) notFound();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: productJsonLd(p, (await getSeo()).base) }} />
      <ProductDetail initial={p} />
    </>
  );
}
