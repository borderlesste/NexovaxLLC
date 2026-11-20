'use client';
import Link from 'next/link';
import { Logo } from './logo';
import { openConsent } from '@/lib/consent';
import { t } from '@/lib/i18n';
import { usePublicConfig } from '@/lib/config';
import { SOCIAL_ICONS, SOCIAL_NAMES } from './social-icons';



const cols = [
  { title: 'Marketplace', links: [['Inicio', '/'], ['Categorías', '/catalogo'], ['Ofertas', '/catalogo?onSale=true'], ['Vendedores', '/vendedores']] },
  { title: 'Vendedores', links: [['Vender en la plataforma', '/vendedor/registro'], ['Planes y comisiones', '/ayuda#comisiones'], ['Ayuda para vendedores', '/ayuda#vendedores']] },
  { title: 'Ayuda', links: [['Centro de ayuda', '/ayuda'], ['Preguntas frecuentes', '/ayuda#faq'], ['Reportar un problema', '/ayuda/reportar']] },
];

export function ShopFooter() {
  const cfg = usePublicConfig();
  const social = (cfg?.social ?? []).filter((l) => SOCIAL_ICONS[l.network]);
  return (
    <footer className="mt-16 bg-brand-950 text-brand-100">
      <div className="mx-auto grid max-w-[1400px] grid-cols-2 gap-x-6 gap-y-8 px-4 py-10 sm:grid-cols-3 md:grid-cols-[1.4fr_repeat(3,1fr)_auto] md:gap-10 md:py-12 lg:px-8">
        <div className="col-span-2 sm:col-span-3 md:col-span-1">
          <Logo invert />
          <p className="mt-3 max-w-sm text-sm text-brand-200 md:mt-4 md:max-w-xs">{t('El marketplace global que conecta compradores y vendedores de todo el mundo en un solo lugar.')}</p>
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
          <span className="break-words">© {new Date().getFullYear()} {cfg?.name || 'NEXOVAX'}. {t('Todos los derechos reservados.')}{cfg?.supportEmail && <> · {t('Soporte:')}{' '}<a href={`mailto:${cfg.supportEmail}`} className="hover:text-white" data-support-email>{cfg.supportEmail}</a></>}</span>
          <span className="flex flex-wrap justify-center gap-x-4 gap-y-2 md:justify-end">
            <Link href="/ayuda#terminos">{t('Términos y condiciones')}</Link>
            <Link href="/ayuda#privacidad">{t('Privacidad')}</Link>
            <Link href="/ayuda#cookies">{t('Cookies')}</Link>
            <button type="button" onClick={openConsent} className="hover:text-white" data-cookie-prefs>{t('Preferencias de cookies')}</button>
            <a href="https://www.geonames.org" target="_blank" rel="noopener noreferrer" title="CC BY 4.0">{t('Datos geográficos: GeoNames')}</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
