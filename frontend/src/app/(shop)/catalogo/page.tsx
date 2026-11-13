import { Suspense } from 'react';
import { CatalogView } from '@/components/shop/catalog-view';
import { PageLoader } from '@/components/ui/misc';

export const metadata = { title: 'Catálogo' };

export default function CatalogPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <CatalogView />
    </Suspense>
  );
}
