import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata({ title: t('Tiendas del marketplace'), description: t('Descubre vendedores verificados de todo el mundo.'), path: '/vendedores' });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
