import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site-url';

/** Search engines index the shop; private areas (accounts, panels, checkout, API) stay out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/vendedor/registro'],
        disallow: ['/api/', '/admin', '/cuenta', '/carrito', '/checkout', '/mensajes', '/auth/', '/vendedor/', '/*?*q='],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
