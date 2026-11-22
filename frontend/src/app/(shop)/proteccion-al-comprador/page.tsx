import { PolicyPage, policyMetadata } from '@/components/legal/policy-page';

/** Buyer protection, payments and disputes: text edited in Admin → Políticas legales; figures from the live rules. */
export const revalidate = 300;
export const generateMetadata = () => policyMetadata('BUYER_PROTECTION');

export default function Page() {
  return <PolicyPage code="BUYER_PROTECTION" />;
}
