import { PolicyPage, policyMetadata } from '@/components/legal/policy-page';

/** "Sobre nosotros": text edited and versioned in Admin → Políticas legales; company data from Admin → Configuración. */
export const revalidate = 300;
export const generateMetadata = () => policyMetadata('ABOUT_US');

export default function Page() {
  return <PolicyPage code="ABOUT_US" />;
}
