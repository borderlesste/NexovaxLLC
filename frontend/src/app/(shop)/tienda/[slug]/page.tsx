import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { serverGet } from '@/lib/server-api';
import { getT } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/seo';
import { StoreView } from './store-view';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = await serverGet<any>(`/stores/${slug}`, 60);
  const t = await getT();
  if (!s) return { title: t('Tienda'), robots: { index: false, follow: true } };
  return pageMetadata({
    title: s.name,
    description: s.shortDescription || s.description,
    path: `/tienda/${s.slug ?? slug}`,
    images: [s.bannerUrl, s.logoUrl],
    imageAlt: s.name,
    type: 'profile',
  });
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await serverGet<any>(`/stores/${slug}`, 0);
  if (!s) notFound();
  return <StoreView initial={s} />;
}
