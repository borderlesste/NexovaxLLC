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
        // Product photos (/api/media) must stay crawlable for Google Images and Merchant Center.
        allow: ['/', '/vendedor/registro', '/api/media/', '/feeds/'],
        disallow: ['/api/', '/admin', '/cuenta', '/carrito', '/checkout', '/mensajes', '/auth/', '/vendedor/', '/*?*q='],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
