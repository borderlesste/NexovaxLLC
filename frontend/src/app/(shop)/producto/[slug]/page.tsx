import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { serverGet } from '@/lib/server-api';
import { ProductDetail } from './product-detail';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await serverGet<any>(`/products/${slug}`, 60);
  if (!p) return { title: 'Producto no encontrado' };
  return { title: p.seo?.title ?? p.title, description: p.seo?.description ?? p.shortDescription ?? undefined, openGraph: { images: p.images?.[0]?.url ? [p.images[0].url] : [] } };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await serverGet<any>(`/products/${slug}`, 0);
  if (!p) notFound();
  return <ProductDetail initial={p} />;
}
