import type { MetadataRoute } from 'next';
import { serverGet } from '@/lib/server-api';
import { getSeo } from '@/lib/seo';

/** Regenerated at most once an hour. */
export const revalidate = 3600;

type Entry = { slug: string; updatedAt?: string | null };
type SitemapData = { products: Entry[]; stores: Entry[]; categories: Entry[] };

const flatten = (cats: any[]): Entry[] => cats.flatMap((c) => [{ slug: c.slug }, ...flatten(c.children ?? [])]);

/** Without the API's /sitemap (older deploy) the public listings are used instead. */
async function load(): Promise<SitemapData> {
  const data = await serverGet<SitemapData>('/sitemap', 3600);
  if (data) return data;
  const [cats, sellers] = await Promise.all([serverGet<any[]>('/categories', 3600), serverGet<any[]>('/sellers', 3600)]);
  const products: Entry[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await serverGet<{ items: any[]; total: number }>(`/products?pageSize=60&page=${page}&sort=newest`, 3600);
    if (!r?.items?.length) break;
    products.push(...r.items.map((p) => ({ slug: p.slug, updatedAt: p.createdAt })));
    if (products.length >= r.total) break;
  }
  return { products, stores: (sellers ?? []).map((s) => ({ slug: s.slug })), categories: flatten(cats ?? []) };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { base } = await getSeo();
  const now = new Date();
  const { products, stores, categories } = await load();
  const at = (e: Entry) => (e.updatedAt ? new Date(e.updatedAt) : now);
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/catalogo`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/vendedores`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/ayuda`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/politica-de-envios`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/politica-de-devoluciones`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/proteccion-al-comprador`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/vende-en-nexovax`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/sobre-nosotros`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/terminos`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/privacidad`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/terminos-vendedores`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${base}/vendedor/registro`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    ...categories.map((c) => ({ url: `${base}/catalogo/categorias/${encodeURIComponent(c.slug)}`, lastModified: at(c), changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...products.map((p) => ({ url: `${base}/producto/${encodeURIComponent(p.slug)}`, lastModified: at(p), changeFrequency: 'weekly' as const, priority: 0.8 })),
    ...stores.map((s) => ({ url: `${base}/tienda/${encodeURIComponent(s.slug)}`, lastModified: at(s), changeFrequency: 'weekly' as const, priority: 0.6 })),
  ];
  const seen = new Set<string>();
  return entries.filter((e) => !seen.has(e.url) && !!seen.add(e.url));
}
