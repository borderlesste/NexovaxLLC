import type { Metadata } from 'next';
import { serverGet } from '@/lib/server-api';
import { getT } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/seo';
import { Suspense } from 'react';
import { CatalogView } from '@/components/shop/catalog-view';
import { PageLoader } from '@/components/ui/misc';

type Cat = { name: string; slug: string; description?: string | null; imageUrl?: string | null; productCount?: number; children?: Cat[] };
const find = (cats: Cat[], slug: string): Cat | null => {
  for (const c of cats) {
    if (c.slug === slug) return c;
    const hit = find(c.children ?? [], slug);
    if (hit) return hit;
  }
  return null;
};

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const { slug } = await params;
  const page = Math.trunc(Number((await searchParams).page)) || 1;
  const c = find((await serverGet<Cat[]>('/categories', 300)) ?? [], slug);
  const t = await getT();
  if (!c) return pageMetadata({ title: t('Catálogo'), path: '/catalogo', noindex: true });
  return pageMetadata({
    title: page > 1 ? `${c.name} · ${t('Página {n}', { n: page })}` : c.name,
    description: c.description || t('Compra {c} en el marketplace: {n} productos de múltiples vendedores.', { c: c.name, n: c.productCount ?? 0 }),
    path: `/catalogo/categorias/${encodeURIComponent(c.slug)}${page > 1 ? `?page=${page}` : ''}`,
    images: [c.imageUrl],
    imageAlt: c.name,
  });
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense fallback={<PageLoader />}>
      <CatalogView categorySlug={slug} />
    </Suspense>
  );
}
