import { ShopHeader } from '@/components/layout/shop-header';
import { ShopFooter } from '@/components/layout/shop-footer';
import { RefTracker } from '@/components/affiliates/ref-tracker';
import { CookieBanner } from '@/components/layout/cookie-banner';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <ShopHeader />
      <RefTracker />
      <main className="flex-1">{children}</main>
      <ShopFooter />
      <CookieBanner />
    </div>
  );
}
