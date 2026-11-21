import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import { Providers } from './providers';
import { Analytics } from '@vercel/analytics/next';
import { getServerLocale } from '@/lib/i18n/server';
import { serverGet } from '@/lib/server-api';
import { getSeo, pageMetadata } from '@/lib/seo';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

/**
 * Site-wide metadata from Admin → Configuración → SEO: title, description, canonical of the current path,
 * Open Graph, Twitter/X card and search-engine verification. Pages with their own data override it.
 */
export async function generateMetadata(): Promise<Metadata> {
  const ctx = await getSeo();
  const base = await pageMetadata({}, ctx);
  const homeTitle = (base.title as { absolute: string }).absolute;
  const other: Record<string, string> = {};
  if (ctx.seo.bingVerification) other['msvalidate.01'] = ctx.seo.bingVerification;
  return {
    ...base,
    title: { default: homeTitle, template: ctx.template },
    verification: { google: ctx.seo.googleVerification || undefined, other },
  };
}

export const viewport: Viewport = { themeColor: '#0a6cf5' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getServerLocale();
  const cfg = await serverGet<{ currency: string }>('/config/public', 60);
  return (
    <html lang={locale} className={inter.variable}>
      <body className="font-sans">
        <Providers locale={locale} currency={cfg?.currency ?? 'USD'}>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
