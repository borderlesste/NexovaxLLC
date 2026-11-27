import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata({ title: t('Tiendas del marketplace'), description: t('Descubre las tiendas registradas en el marketplace. Cada insignia indica solo lo que nuestro equipo verificó.'), path: '/vendedores' });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
