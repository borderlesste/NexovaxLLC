import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/seo';
import { Suspense } from 'react';
import { CatalogView } from '@/components/shop/catalog-view';
import { PageLoader } from '@/components/ui/misc';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata({ title: t('Catálogo'), path: '/catalogo' });
}

export default function CatalogPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <CatalogView />
    </Suspense>
  );
}
