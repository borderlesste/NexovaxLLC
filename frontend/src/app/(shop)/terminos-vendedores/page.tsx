import { PolicyPage, policyMetadata } from '@/components/legal/policy-page';

/** Seller terms: the published version edited and versioned in Admin → Políticas legales. */
export const revalidate = 300;
export const generateMetadata = () => policyMetadata('SELLER_TERMS');

export default function Page() {
  return <PolicyPage code="SELLER_TERMS" />;
}
