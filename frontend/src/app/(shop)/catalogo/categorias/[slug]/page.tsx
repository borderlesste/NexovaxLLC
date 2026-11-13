import { Suspense } from 'react';
import { CatalogView } from '@/components/shop/catalog-view';
import { PageLoader } from '@/components/ui/misc';

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense fallback={<PageLoader />}>
      <CatalogView categorySlug={slug} />
    </Suspense>
  );
}
