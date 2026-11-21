/**
 * Fallback public origin of the web, used only when Admin → Configuración → SEO has no canonical URL
 * (see getSeo in lib/seo.ts): NEXT_PUBLIC_SITE_URL, else the Vercel production domain, else local dev.
 */
export function siteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const url = env || (vercel ? `https://${vercel}` : 'http://localhost:3000');
  return url.replace(/\/+$/, '');
}
