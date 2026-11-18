import type { MetadataRoute } from 'next';

/** Web app manifest: name and icons (generated from the NEXOVAX logo) for home screens and tabs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NEXOVAX Marketplace',
    short_name: 'NEXOVAX',
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
