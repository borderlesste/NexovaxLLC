import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertCircle, BadgeCheck, Building2, Clock, FileText, Lock, Mail, MapPin, Phone, RotateCcw, Scale, ShieldCheck, Store, Truck, User } from 'lucide-react';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getServerLocale, getT } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';
import { CookiesSection } from './cookies-section';

export type PublicPolicyCode = 'TERMS_OF_SERVICE' | 'PRIVACY_POLICY' | 'SELLER_TERMS' | 'RETURN_POLICY' | 'SHIPPING_POLICY' | 'ABOUT_US' | 'BUYER_PROTECTION';
type Policy = { code: string; slug: string; title: string; text: string; version: number | null; effectiveAt: string | null };
type Company = { legalName?: string; jurisdiction?: string; address?: string; registrationNumber?: string; phone?: string; supportHours?: string; [k: string]: string | undefined };
type ReturnFacts = { windowDays: number; labelPayer: string; shippingRefund: string; restockingFeePercent: number; inspectionRequired: boolean };

/** Each legal text has its own crawlable page (the paths match the policy slugs in Admin → Políticas legales). */
export const POLICY_PAGES: Record<PublicPolicyCode, { path: string; label: string }> = {
  TERMS_OF_SERVICE: { path: '/terminos', label: 'Términos y condiciones' },
  PRIVACY_POLICY: { path: '/privacidad', label: 'Privacidad y cookies' },
  SELLER_TERMS: { path: '/terminos-vendedores', label: 'Términos para vendedores' },
  RETURN_POLICY: { path: '/politica-de-devoluciones', label: 'Política de devoluciones' },
  SHIPPING_POLICY: { path: '/politica-de-envios', label: 'Política de envíos' },
  ABOUT_US: { path: '/sobre-nosotros', label: 'Sobre nosotros' },
  BUYER_PROTECTION: { path: '/proteccion-al-comprador', label: 'Protección al comprador' },
};

/** The current published version, in the visitor's language (Spanish when missing). */
async function load(code: PublicPolicyCode) {
  const all = await serverGet<Policy[]>('/policies', 300);
  return all?.find((p) => p.code === code) ?? null;
}

export async function policyMetadata(code: PublicPolicyCode) {
  const t = await getT();
  const p = await load(code);
  return pageMetadata({ title: p?.title || t(POLICY_PAGES[code].label), description: p?.text?.slice(0, 300), path: POLICY_PAGES[code].path });
}

const LABEL_PAYER: Record<string, string> = {
  CUSTOMER: 'El cliente envía el producto y paga el envío de vuelta',
  BY_REASON: 'Etiqueta pagada por la tienda si el problema es de la tienda',
  STORE: 'Etiqueta prepagada, la paga la tienda',
  MARKETPLACE: 'Etiqueta prepagada, la paga el marketplace',
};
const SHIPPING_REFUND: Record<string, string> = {
  NONE: 'No se reembolsa el envío original',
  FULL_IF_ALL_RETURNED: 'Se reembolsa si se devuelve todo el pedido',
  FULL: 'Siempre se reembolsa el envío original',
};

/**
 * Public policy page (returns or shipping). The text is the version published in
 * Admin → Ajustes → Políticas legales; the returns page also lists the conditions in force
 * from the marketplace return rules, so both always agree.
 */
/** banner: optional block shown under the breadcrumbs (e.g. the Haiti Tracking banner on the shipping policy). */
export async function PolicyPage({ code, banner }: { code: PublicPolicyCode; banner?: React.ReactNode }) {
  const t = await getT();
  const locale = await getServerLocale();
  const numLocale = ({ es: 'es-US', en: 'en-US', fr: 'fr-FR', ht: 'fr-HT' } as const)[locale];
  const [p, facts, cfg] = await Promise.all([
    load(code),
    code === 'RETURN_POLICY' || code === 'BUYER_PROTECTION' ? serverGet<ReturnFacts>('/returns/policy', 300) : null,
    serverGet<{ name?: string; supportEmail?: string; company?: Company }>('/config/public', 60),
  ]);
  if (!p) notFound();
  // Buyer protection: the figures in force (store payout hold, support response times) come from the live rules.
  const [help, support] = code === 'BUYER_PROTECTION'
    ? await Promise.all([
        serverGet<{ commissions?: { holdDays: number | null } }>('/help', 300),
        serverGet<{ priorities?: { code: string; first_response_seconds: number | null }[] }>('/support/catalogs', 300),
      ])
    : [null, null];
  const Icon = ({ RETURN_POLICY: RotateCcw, ABOUT_US: Building2, BUYER_PROTECTION: ShieldCheck, SHIPPING_POLICY: Truck, TERMS_OF_SERVICE: FileText, PRIVACY_POLICY: Lock, SELLER_TERMS: Store } as const)[code];
  // Who operates the site, on every legal page: company data from Admin → Configuración → Ayuda y redes → Empresa.
  const L = locale === 'fr' ? 'Fr' : locale === 'ht' ? 'Ht' : locale === 'en' ? 'En' : '';
  const co = cfg?.company ?? {};
  const hours = (L && co[`supportHours${L}`]) || co.supportHours;
  const about = code === 'ABOUT_US';
  const companyRows = cfg
    ? ([
        [Building2, t('Razón social'), co.legalName],
        [Scale, t('Constituida en'), co.jurisdiction],
        [MapPin, t('Domicilio'), co.address],
        [Building2, t('Número de registro'), co.registrationNumber],
        [BadgeCheck, t('Identificación fiscal (EIN)'), about ? co.taxId : undefined],
        [User, t('Representante legal'), about ? co.legalRepresentative : undefined],
        [Mail, t('Correo de soporte'), cfg.supportEmail, 'mail'],
        [Phone, t('Teléfono'), co.phone],
        [Clock, t('Horario de atención'), about ? hours : undefined],
      ] as [any, string, string | undefined, string?][]).filter((r) => !!r[2])
    : [];
  const dur = (sec?: number | null) => (!sec ? null : sec < 3600 ? t('{n} min', { n: Math.round(sec / 60) }) : t('{n} h', { n: Math.round(sec / 3600) }));
  const firstResponse = (c: string) => dur(support?.priorities?.find((x) => x.code === c)?.first_response_seconds);
  const hold = help?.commissions?.holdDays;
  const rows = code === 'BUYER_PROTECTION'
    ? ([
        facts && [t('Plazo para reportar o devolver'), t('{n} días desde la entrega', { n: facts.windowDays })],
        facts && [t('Envío de la devolución'), t(LABEL_PAYER[facts.labelPayer] ?? facts.labelPayer)],
        hold != null && [t('Pago a la tienda'), hold === 0 ? t('Al confirmarse la entrega') : t('{n} días después de la entrega, y nunca con una devolución o disputa abierta', { n: hold })],
        firstResponse('NORMAL') && [t('Primera respuesta de soporte'), [firstResponse('NORMAL') && t('Normal: {a}', { a: firstResponse('NORMAL')! }), firstResponse('HIGH') && t('Alta: {a}', { a: firstResponse('HIGH')! }), firstResponse('CRITICAL') && t('Crítica: {a}', { a: firstResponse('CRITICAL')! })].filter(Boolean).join(' · ')],
      ].filter(Boolean) as [string, string][])
    : facts
    ? [
        [t('Plazo para devolver'), t('{n} días desde la entrega', { n: facts.windowDays })],
        [t('Envío de la devolución'), t(LABEL_PAYER[facts.labelPayer] ?? facts.labelPayer)],
        [t('Envío original'), t(SHIPPING_REFUND[facts.shippingRefund] ?? facts.shippingRefund)],
        [t('Cargo por reposición'), facts.restockingFeePercent ? `${facts.restockingFeePercent} %` : t('Sin cargo')],
        [t('Reembolso'), facts.inspectionRequired ? t('Después de que la tienda recibe e inspecciona el producto') : t('Cuando la tienda confirma la recepción del producto')],
      ]
    : [];
  return (
    <div className="mx-auto max-w-[900px] px-4 py-6 lg:px-8" data-public-policy={code}>
      <Breadcrumbs items={about ? [{ label: POLICY_PAGES[code].label }] : [{ label: 'Ayuda', href: '/ayuda' }, { label: POLICY_PAGES[code].label }]} />
      {banner && <div className="mt-4">{banner}</div>}
      <div className="mt-4 rounded-3xl bg-gradient-to-r from-brand-50 to-brand-100 p-6 sm:p-8">
        <Icon className="size-9 text-brand-600" />
        <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">{p.title}</h1>
        {p.version && p.effectiveAt && (
          <p className="mt-2 text-sm text-muted">{t('Versión {n} · vigente desde {d}', { n: p.version, d: new Date(p.effectiveAt).toLocaleDateString(numLocale) })}</p>
        )}
      </div>
      {rows.length > 0 && (
        <section className="card mt-6 p-6" data-return-facts>
          <h2 className="text-xl font-extrabold">{t('Condiciones vigentes')}</h2>
          <dl className="mt-3 divide-y divide-line text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[220px_1fr] sm:gap-4">
                <dt className="font-semibold">{k}</dt>
                <dd className="text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <article className="card mt-6 p-6">
        <p className="whitespace-pre-line leading-relaxed text-ink/90">{p.text}</p>
      </article>
      {code === 'PRIVACY_POLICY' && <CookiesSection />}
      {companyRows.length > 0 && (
        <section className="card mt-6 p-6" data-company-info>
          <h2 className="text-xl font-extrabold">{about ? t('Datos de la empresa') : t('Quién opera este sitio')}</h2>
          <dl className="mt-3 divide-y divide-line text-sm">
            {companyRows.map(([I, k, v, kind]) => (
              <div key={k} className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[220px_1fr] sm:gap-4">
                <dt className="flex items-center gap-2 font-semibold"><I className="size-4 text-brand-600" /> {k}</dt>
                <dd className="break-words text-muted">{kind === 'mail' ? <a href={`mailto:${v}`} className="text-brand-700 hover:underline">{v}</a> : v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <nav className="card mt-6 p-6" aria-label={t('Documentos legales')} data-legal-nav>
        <h2 className="text-xl font-extrabold">{t('Documentos legales')}</h2>
        <ul className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {(Object.keys(POLICY_PAGES) as PublicPolicyCode[]).filter((c) => c !== code).map((c) => (
            <li key={c}><Link href={POLICY_PAGES[c].path} className="font-semibold text-brand-700 hover:underline">{t(POLICY_PAGES[c].label)}</Link></li>
          ))}
        </ul>
      </nav>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild><Link href="/ayuda/reportar"><AlertCircle /> {t('Reportar un problema')}</Link></Button>
      </div>
    </div>
  );
}
