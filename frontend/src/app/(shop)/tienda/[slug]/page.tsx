import { notFound } from 'next/navigation';
import { serverGet } from '@/lib/server-api';
import { StoreView } from './store-view';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await serverGet<any>(`/stores/${slug}`, 60);
  return { title: s?.name ?? 'Tienda', description: s?.shortDescription };
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await serverGet<any>(`/stores/${slug}`, 0);
  if (!s) notFound();
  return <StoreView initial={s} />;
}
