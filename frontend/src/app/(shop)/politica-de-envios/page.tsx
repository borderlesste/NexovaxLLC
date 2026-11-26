import { PolicyPage, policyMetadata } from '@/components/legal/policy-page';
import { HaitiBanner } from '@/components/shop/haiti-tracking';
import { serverGet } from '@/lib/server-api';
import { getT } from '@/lib/i18n/server';

/** Public page (linked in the footer, the sitemap and Google Merchant Center). Text edited in Admin → Políticas legales. */
export const revalidate = 300;
export const generateMetadata = () => policyMetadata('SHIPPING_POLICY');

export default async function Page() {
  const [t, cfg] = await Promise.all([getT(), serverGet<{ haitiTracking?: boolean }>('/config/public', 60)]);
  // "Haiti Tracking by Nexovax" banner (Admin → Configuración → General → Opciones del marketplace).
  const banner = cfg?.haitiTracking !== false ? (
    <HaitiBanner priority>
      <p className="max-w-xl text-sm text-white/85">{t('¿Compras para Haití? Cada pedido muestra el costo del envío antes de pagar y su seguimiento paso a paso.')}</p>
    </HaitiBanner>
  ) : undefined;
  return <PolicyPage code="SHIPPING_POLICY" banner={banner} />;
}
