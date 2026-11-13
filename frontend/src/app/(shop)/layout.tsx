import { ShopHeader } from '@/components/layout/shop-header';
import { ShopFooter } from '@/components/layout/shop-footer';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <ShopHeader />
      <main className="flex-1">{children}</main>
      <ShopFooter />
    </div>
  );
}
