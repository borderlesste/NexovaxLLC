import type { MetadataRoute } from 'next';
import { getSeo } from '@/lib/seo';

/** Search engines index the shop; private areas (accounts, panels, checkout, API) stay out. SEO → "No indexar" closes it all. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const { base, seo } = await getSeo();
  if (seo.noindex) return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/vendedor/registro'],
        disallow: ['/api/', '/admin', '/cuenta', '/carrito', '/checkout', '/mensajes', '/auth/', '/vendedor/', '/*?*q='],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
