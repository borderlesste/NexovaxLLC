import type { MetadataRoute } from 'next';
import { getSeo } from '@/lib/seo';

/** Web app manifest: name from Admin → Configuración → SEO, icons generated from the logo. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { siteName, title, description } = await getSeo();
  return {
    name: [siteName, title].filter(Boolean).join(' · ') || siteName,
    short_name: siteName,
    description: description || undefined,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0a6cf5',
    icons: [
      { src: '/favicon.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
