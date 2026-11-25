import { PolicyPage, policyMetadata } from '@/components/legal/policy-page';

/** Terms of service: the published version edited and versioned in Admin → Políticas legales. */
export const revalidate = 300;
export const generateMetadata = () => policyMetadata('TERMS_OF_SERVICE');

export default function Page() {
  return <PolicyPage code="TERMS_OF_SERVICE" />;
}
