import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata({ title: t('Abre tu tienda'), description: t('Vende en tu país y al exterior con envíos y pagos integrados.'), path: '/vendedor/registro' });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
