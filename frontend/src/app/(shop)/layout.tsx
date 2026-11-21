import { ShopHeader } from '@/components/layout/shop-header';
import { ShopFooter } from '@/components/layout/shop-footer';
import { RefTracker } from '@/components/affiliates/ref-tracker';
import { cookies } from 'next/headers';
import { CookieBanner } from '@/components/layout/cookie-banner';
import { GoogleAnalytics } from '@/components/layout/google-analytics';

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const answered = (await cookies()).has('nx_consent');
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <ShopHeader />
      <RefTracker />
      <main className="flex-1">{children}</main>
      <ShopFooter />
      <CookieBanner initialOpen={!answered} />
      <GoogleAnalytics />
    </div>
  );
}
