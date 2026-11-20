/** Public origin of the web (canonical links, sitemap). NEXT_PUBLIC_SITE_URL wins; on Vercel its production domain. */
export function siteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const url = env || (vercel ? `https://${vercel}` : 'https://nexovax.com');
  return url.replace(/\/+$/, '');
}
