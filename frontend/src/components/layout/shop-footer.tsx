'use client';
import Link from 'next/link';
import { Logo } from './logo';
import { openConsent } from '@/lib/consent';
import { getLocale, t } from '@/lib/i18n';
import { Clock, Mail, Phone } from 'lucide-react';
import { usePublicConfig, type PublicConfig } from '@/lib/config';
import { SOCIAL_ICONS, SOCIAL_NAMES } from './social-icons';

// Each link appears once: legal pages live only in the "Legal" column.
const cols = [
  { title: 'Marketplace', links: [['Inicio', '/'], ['Categorías', '/catalogo'], ['Ofertas', '/catalogo?onSale=true'], ['Vendedores', '/vendedores'], ['Sobre nosotros', '/sobre-nosotros']] },
  { title: 'Vendedores', links: [['Vender en la plataforma', '/vende-en-nexovax'], ['Planes y comisiones', '/vende-en-nexovax#comisiones'], ['Ayuda para vendedores', '/ayuda#vendedores']] },
  { title: 'Ayuda', links: [['Centro de ayuda', '/ayuda'], ['Preguntas frecuentes', '/ayuda#faq'], ['Contactar a soporte', '/ayuda/reportar']] },
  { title: 'Legal', links: [['Términos y condiciones', '/terminos'], ['Privacidad y cookies', '/privacidad'], ['Protección al comprador', '/proteccion-al-comprador'], ['Política de devoluciones', '/politica-de-devoluciones'], ['Política de envíos', '/politica-de-envios']] },
];

/** `initial`: the config read on the server, so company and contact data are in the first HTML. */
export function ShopFooter({ initial }: { initial?: PublicConfig | null }) {
  const cfg = usePublicConfig() ?? initial ?? undefined;
  const social = (cfg?.social ?? []).filter((l) => SOCIAL_ICONS[l.network]);
  // Company data and texts from Admin → Configuración → Ayuda y redes → Empresa y pie de página.
  const co: Record<string, string | undefined> = cfg?.company ?? {};
  const loc = getLocale();
  const L = loc === 'fr' ? 'Fr' : loc === 'ht' ? 'Ht' : loc === 'en' ? 'En' : '';
  const footerText = (L ? co[`footerText${L}`] : co.footerText) || t('Conectamos a compradores exigentes con tiendas de todo el mundo, ofreciendo envíos internacionales transparentes y compras protegidas en un solo lugar.');
  const hours = (L && co[`supportHours${L}`]) || co.supportHours;
  const legal = [co.legalName, co.address].filter(Boolean).join(' · ');
  return (
    <footer className="mt-16 bg-brand-950 text-brand-100">
      <div className="mx-auto grid max-w-[1400px] grid-cols-2 gap-x-6 gap-y-8 px-4 py-10 sm:grid-cols-4 md:grid-cols-[1.4fr_repeat(4,1fr)_auto] md:gap-8 md:py-12 lg:px-8">
        <div className="col-span-2 sm:col-span-4 md:col-span-1">
          <Logo invert />
          <p className="mt-3 max-w-sm text-sm text-brand-200 md:mt-4 md:max-w-xs" data-footer-text>{footerText}</p>
          {(cfg?.supportEmail || hours || co.phone) && (
            <ul className="mt-4 space-y-1.5 text-sm text-brand-200" data-footer-contact>
              {cfg?.supportEmail && <li className="flex items-center gap-2"><Mail className="size-4 shrink-0" /><a href={`mailto:${cfg.supportEmail}`} className="break-all hover:text-white" data-support-email>{cfg.supportEmail}</a></li>}
              {co.phone && <li className="flex items-center gap-2"><Phone className="size-4 shrink-0" /><a href={`tel:${co.phone.replace(/[^\d+]/g, '')}`} className="hover:text-white">{co.phone}</a></li>}
              {hours && <li className="flex items-start gap-2"><Clock className="mt-0.5 size-4 shrink-0" /><span data-support-hours>{hours}</span></li>}
            </ul>
          )}
        </div>
        {cols.map((c) => (
          <div key={c.title} className="min-w-0">
            <p className="mb-2 font-bold text-white md:mb-3">{t(c.title)}</p>
            <ul className="space-y-1.5 text-sm">
              {c.links.map(([l, h]) => (
                <li key={l}><Link href={h} className="block break-words py-0.5 text-brand-200 hover:text-white">{t(l)}</Link></li>
              ))}
            </ul>
          </div>
        ))}
        {social.length > 0 ? (
          <div data-footer-social className="min-w-0">
            <p className="mb-2 font-bold text-white md:mb-3">{t('Síguenos')}</p>
            <div className="flex flex-wrap gap-3 text-brand-200">
              {social.map((l) => (
                <a key={l.network} href={l.url} target="_blank" rel="noopener noreferrer" aria-label={SOCIAL_NAMES[l.network]} title={SOCIAL_NAMES[l.network]} className="hover:text-white">{SOCIAL_ICONS[l.network]}</a>
              ))}
            </div>
          </div>
        ) : <div />}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1400px] flex-col items-center gap-3 px-4 py-5 text-center text-xs text-brand-300 md:flex-row md:flex-wrap md:justify-between md:py-4 md:text-left lg:px-8">
          <span className="break-words" data-footer-legal>
            © {new Date().getFullYear()} {cfg?.name || 'NEXOVAX'}. {t('Todos los derechos reservados.')}
            {legal && <> {t('Operado por {a}.', { a: legal })}</>}
            {co.registrationNumber && <> {t('Registro: {a}.', { a: co.registrationNumber })}</>}
          </span>
          <span className="flex flex-wrap justify-center gap-x-4 gap-y-2 md:justify-end">
            <button type="button" onClick={openConsent} className="hover:text-white" data-cookie-prefs>{t('Preferencias de cookies')}</button>
            <a href="https://www.geonames.org" target="_blank" rel="noopener noreferrer" title="CC BY 4.0">{t('Datos geográficos: GeoNames')}</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
