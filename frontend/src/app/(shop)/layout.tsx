import { ShopHeader } from '@/components/layout/shop-header';
import { ShopFooter } from '@/components/layout/shop-footer';
import { RefTracker } from '@/components/affiliates/ref-tracker';
import { cookies } from 'next/headers';
import { CookieBanner } from '@/components/layout/cookie-banner';
import { GoogleAnalytics } from '@/components/layout/google-analytics';
import { OrganizationJsonLd } from '@/components/seo/organization-jsonld';
import type { PublicConfig } from '@/lib/config';
import { getSeo } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const answered = (await cookies()).has('nx_consent');
  // Company and contact data rendered on the server, so the footer and the Organization data are in the HTML crawlers read.
  const [cfg, { base }] = await Promise.all([serverGet<PublicConfig>('/config/public', 60), getSeo()]);
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <ShopHeader />
      <RefTracker />
      <main className="flex-1">{children}</main>
      <ShopFooter initial={cfg} />
      <OrganizationJsonLd cfg={cfg} base={base} />
      <CookieBanner initialOpen={!answered} />
      <GoogleAnalytics />
    </div>
  );
}
