import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/seo';
import { Suspense } from 'react';
import { CatalogView } from '@/components/shop/catalog-view';
import { PageLoader } from '@/components/ui/misc';

export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const t = await getT();
  const page = Math.trunc(Number((await searchParams).page)) || 1;
  // Each page of the catalog is its own canonical URL (page 1 stays /catalogo).
  return page > 1
    ? pageMetadata({ title: `${t('Catálogo')} · ${t('Página {n}', { n: page })}`, path: `/catalogo?page=${page}` })
    : pageMetadata({ title: t('Catálogo'), path: '/catalogo' });
}

export default function CatalogPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <CatalogView />
    </Suspense>
  );
}
