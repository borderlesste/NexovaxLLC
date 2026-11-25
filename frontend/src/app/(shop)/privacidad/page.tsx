import { PolicyPage, policyMetadata } from '@/components/legal/policy-page';

/** Privacy: the published version edited and versioned in Admin → Políticas legales. */
export const revalidate = 300;
export const generateMetadata = () => policyMetadata('PRIVACY_POLICY');

export default function Page() {
  return <PolicyPage code="PRIVACY_POLICY" />;
}
