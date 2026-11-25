import 'server-only';
import type { PublicConfig } from '@/lib/config';

/**
 * Organization structured data (schema.org) so search engines can tie the site to the company that
 * operates it. Everything comes from Admin → Configuración (name, support e-mail, Empresa y pie de página,
 * redes sociales); empty fields are left out.
 */
export function OrganizationJsonLd({ cfg, base }: { cfg: PublicConfig | null; base: string }) {
  if (!cfg) return null;
  const co = cfg.company ?? {};
  const name = cfg.name?.trim() || co.legalName?.trim();
  if (!name) return null;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${base}/#organization`,
    name,
    url: `${base}/`,
    logo: `${base}/icon-512.png`,
    legalName: co.legalName || undefined,
    email: cfg.supportEmail || undefined,
    telephone: co.phone || undefined,
    address: co.address ? { '@type': 'PostalAddress', streetAddress: co.address } : undefined,
    taxID: co.taxId || undefined,
    sameAs: (cfg.social ?? []).map((s) => s.url).filter(Boolean),
    contactPoint: cfg.supportEmail || co.phone
      ? { '@type': 'ContactPoint', contactType: 'customer support', email: cfg.supportEmail || undefined, telephone: co.phone || undefined, url: `${base}/ayuda/reportar` }
      : undefined,
  };
  // Escape "<" so admin text can never close the script tag.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
