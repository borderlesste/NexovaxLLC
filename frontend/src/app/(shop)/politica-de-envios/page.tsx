import { PolicyPage, policyMetadata } from '@/components/legal/policy-page';

/** Public page (linked in the footer, the sitemap and Google Merchant Center). Text edited in Admin → Políticas legales. */
export const revalidate = 300;
export const generateMetadata = () => policyMetadata('SHIPPING_POLICY');

export default function Page() {
  return <PolicyPage code="SHIPPING_POLICY" />;
}
