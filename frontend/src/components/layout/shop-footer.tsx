'use client';
import Link from 'next/link';
import { Logo } from './logo';
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
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)_auto] lg:px-8">
        <div>
          <Logo invert />
          <p className="mt-4 max-w-xs text-sm text-brand-200">{t('El marketplace global que conecta compradores y vendedores de todo el mundo en un solo lugar.')}</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <p className="mb-3 font-bold text-white">{t(c.title)}</p>
            <ul className="space-y-1.5 text-sm">
              {c.links.map(([l, h]) => (
                <li key={l}><Link href={h} className="text-brand-200 hover:text-white">{t(l)}</Link></li>
              ))}
            </ul>
          </div>
        ))}
        {social.length > 0 ? (
          <div data-footer-social>
            <p className="mb-3 font-bold text-white">{t('Síguenos')}</p>
            <div className="flex flex-wrap gap-3 text-brand-200">
              {social.map((l) => (
                <a key={l.network} href={l.url} target="_blank" rel="noopener noreferrer" aria-label={SOCIAL_NAMES[l.network]} title={SOCIAL_NAMES[l.network]} className="hover:text-white">{SOCIAL_ICONS[l.network]}</a>
              ))}
            </div>
          </div>
        ) : <div />}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1400px] flex-wrap justify-between gap-2 px-4 py-4 text-xs text-brand-300 lg:px-8">
          <span>© {new Date().getFullYear()} {t('NEXOVAX.')}{' '}{t('Todos los derechos reservados.')}</span>
          <span className="flex gap-4">
            <Link href="/ayuda#terminos">{t('Términos y condiciones')}</Link>
            <Link href="/ayuda#privacidad">{t('Privacidad')}</Link>
            <Link href="/ayuda#cookies">{t('Cookies')}</Link>
            <a href="https://www.geonames.org" target="_blank" rel="noopener noreferrer" title="CC BY 4.0">{t('Datos geográficos: GeoNames')}</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
