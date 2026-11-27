import Link from 'next/link';
import { AlertCircle, BookOpen, CreditCard, HelpCircle, Package, RotateCcw, Shield, Store, Truck } from 'lucide-react';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getHas, getServerLocale, getT } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';
import { POLICY_PAGES, type PublicPolicyCode } from '@/components/legal/policy-page';

export async function generateMetadata() {
  const t = await getT();
  return pageMetadata({ title: t('Centro de ayuda'), path: '/ayuda' });
}

const TOPICS = [
  [Package, 'Pedidos', 'Estados, cancelaciones y seguimiento de envíos.'],
  [CreditCard, 'Pagos', 'Métodos de pago, transferencias y recibos de compra.'],
  [Truck, 'Envíos', 'Destinos, tarifas, tiempos y envíos internacionales.'],
  [RotateCcw, 'Devoluciones', 'Plazo, cómo devolver un producto y reembolsos.'],
  [Store, 'Vendedores', 'Registro, productos, comisiones y retiros.'],
  [Shield, 'Seguridad', 'Protección al comprador y de tu cuenta.'],
] as const;

type Help = {
  faq: { q: string; a: string; qEn?: string; aEn?: string; qFr?: string; aFr?: string; qHt?: string; aHt?: string }[];
  sellers: { title: string; body: string; titleEn?: string; bodyEn?: string; titleFr?: string; bodyFr?: string; titleHt?: string; bodyHt?: string }[];
  commissions: { body: string; bodyEn?: string | null; bodyFr?: string | null; bodyHt?: string | null; rate: number | null; payoutMinimum: string | null; holdDays: number | null; currency: string };
};

export default async function HelpPage() {
  const t = await getT();
  const locale = await getServerLocale();
  const en = locale === 'en';
  const has = await getHas();
  const [help, returns] = await Promise.all([serverGet<Help>('/help', 30), serverGet<{ windowDays: number; labelPayer: string }>('/returns/policy', 300)]);
  // Returns and shipping have their own public pages (linked from the topic cards).
  const policies = await serverGet<any[]>('/policies', 300);
  // English: the admin's own translation, else the automatic one.
  // French / Creole: our translation when the text is the stock one, else the English version, else Spanish.
  const tr = (es: string, eng?: string | null, own?: string | null) => (locale === 'es' ? es : en ? eng || t(es) : own || (has(es) ? t(es) : eng || es));
  const L = locale === 'fr' ? 'Fr' : locale === 'ht' ? 'Ht' : 'En';
  const numLocale = ({ es: 'es-US', en: 'en-US', fr: 'fr-FR', ht: 'fr-HT' } as const)[locale];
  const fmt = (v: string, cur: string) => new Intl.NumberFormat(numLocale, { style: 'currency', currency: cur }).format(Number(v));
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 lg:px-8">
      <Breadcrumbs items={[{ label: t('Ayuda') }]} />
      <div className="mt-4 rounded-3xl bg-gradient-to-r from-brand-50 to-brand-100 p-8">
        <h1 className="text-4xl font-extrabold">{t('Centro de ayuda')}</h1>
        <p className="mt-2 text-lg text-muted">{t('Guías, políticas y respuestas para compradores y vendedores.')}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild><Link href="/ayuda/reportar"><AlertCircle /> {t('Reportar un problema')}</Link></Button>
          <Button variant="outline" asChild className="bg-white"><Link href="/cuenta/mensajes"><HelpCircle /> {t('Mis conversaciones')}</Link></Button>
        </div>
      </div>
      <div id="guias" className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOPICS.map(([I, title, d]) => {
          // Returns: the window and who pays the return shipping come from the return rules in force.
          const desc = title === 'Devoluciones' && returns?.windowDays
            ? t(returns.labelPayer === 'CUSTOMER' ? '{n} días desde la entrega. El cliente paga el envío de vuelta. Reembolso tras la inspección.' : returns.labelPayer === 'BY_REASON' ? '{n} días desde la entrega. Si el problema es de la tienda, ella paga el envío de vuelta. Reembolso tras la inspección.' : '{n} días desde la entrega. Cómo devolver un producto y reembolsos.', { n: returns.windowDays })
            : t(d);
          const body = <><I className="size-8 text-brand-600" /><p className="mt-3 text-lg font-bold">{t(title)}</p><p className="text-sm text-muted">{desc}</p></>;
          const href = title === 'Envíos' ? '/politica-de-envios' : title === 'Devoluciones' ? '/politica-de-devoluciones' : title === 'Seguridad' ? '/proteccion-al-comprador' : null;
          return href ? <Link key={title} href={href} className="card block p-5 hover:border-brand-300">{body}</Link> : <div key={title} className="card p-5">{body}</div>;
        })}
      </div>
      <section id="faq" className="card mt-8 scroll-mt-24 p-6">
        <h2 className="flex items-center gap-2 text-2xl font-extrabold"><BookOpen className="size-6 text-brand-600" /> {t('Preguntas frecuentes')}</h2>
        <div className="mt-4 divide-y divide-line">
          {(help?.faq ?? []).map((f, i) => (
            <details key={i} className="group py-4" data-faq-item>
              <summary className="cursor-pointer list-none font-semibold group-open:text-brand-700">{tr(f.q, f.qEn, (f as any)[`q${L}`])}</summary>
              <p className="mt-2 whitespace-pre-line text-sm text-muted">{tr(f.a, f.aEn, (f as any)[`a${L}`])}</p>
            </details>
          ))}
        </div>
      </section>
      <section id="vendedores" className="card mt-6 scroll-mt-24 p-6">
        <h2 className="flex items-center gap-2 text-2xl font-extrabold"><Store className="size-6 text-brand-600" /> {t('Ayuda para vendedores')}</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2" data-seller-help>
          {(help?.sellers ?? []).map((x, i) => (
            <div key={i} className="rounded-xl bg-surface p-4">
              <p className="font-bold">{tr(x.title, x.titleEn, (x as any)[`title${L}`])}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-muted">{tr(x.body, x.bodyEn, (x as any)[`body${L}`])}</p>
            </div>
          ))}
        </div>
        <Button asChild className="mt-4"><Link href="/vendedor/registro"><Store /> {t('Vender en NEXOVAX')}</Link></Button>
      </section>
      {help?.commissions && (
        <section id="comisiones" className="card mt-6 scroll-mt-24 p-6" data-commissions>
          <h2 className="text-2xl font-extrabold">{t('Comisiones y pagos a vendedores')}</h2>
          {(help.commissions.rate != null || help.commissions.payoutMinimum != null || help.commissions.holdDays != null) && (
            <div className="mt-4 flex flex-wrap gap-3">
              {help.commissions.rate != null && <div className="rounded-xl bg-brand-50 px-4 py-3"><p className="text-xs text-muted">{t('Comisión por venta')}</p><p className="text-2xl font-extrabold text-brand-700">{(help.commissions.rate * 100).toLocaleString(numLocale, { maximumFractionDigits: 2 })} %</p></div>}
              {help.commissions.payoutMinimum != null && <div className="rounded-xl bg-brand-50 px-4 py-3"><p className="text-xs text-muted">{t('Retiro mínimo')}</p><p className="text-2xl font-extrabold text-brand-700">{fmt(help.commissions.payoutMinimum, help.commissions.currency)}</p></div>}
              {help.commissions.holdDays != null && <div className="rounded-xl bg-brand-50 px-4 py-3"><p className="text-xs text-muted">{t('Retención tras la entrega')}</p><p className="text-2xl font-extrabold text-brand-700">{help.commissions.holdDays === 0 ? t('Sin retención') : t('{n} días', { n: help.commissions.holdDays })}</p></div>}
            </div>
          )}
          <p className="mt-3 whitespace-pre-line text-muted">{tr(help.commissions.body, help.commissions.bodyEn, (help.commissions as any)[`body${L}`])}</p>
        </section>
      )}
      {/* Legal texts: each one has its own crawlable page; the old anchors (#terminos, #privacidad…) stay as entry points. */}
      <section className="card mt-6 scroll-mt-24 p-6" data-legal-links>
        <h2 className="text-2xl font-extrabold">{t('Documentos legales')}</h2>
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(Object.keys(POLICY_PAGES) as PublicPolicyCode[]).map((c) => {
            const p = policies?.find((x: any) => x.code === c);
            const slug = POLICY_PAGES[c].path.slice(1);
            return (
              <li key={c} id={slug === 'privacidad' ? undefined : slug} className="scroll-mt-24">
                <Link href={POLICY_PAGES[c].path} className="block rounded-xl border border-line px-4 py-3 hover:border-brand-400" data-policy={c}>
                  <span className="font-semibold text-brand-700">{p?.title || t(POLICY_PAGES[c].label)}</span>
                  {p?.version && p?.effectiveAt && <span className="mt-0.5 block text-xs text-muted">{t('Versión {n} · vigente desde {d}', { n: p.version, d: new Date(p.effectiveAt).toLocaleDateString(numLocale) })}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
        <p id="privacidad" className="mt-3 scroll-mt-24 text-sm text-muted"><span id="cookies" /><span id="ubicacion" />{t('El uso de cookies y del país de entrega se explica en')} <Link href="/privacidad#cookies" className="font-semibold text-brand-700 hover:underline">{t('Privacidad y cookies')}</Link>.</p>
      </section>
    </div>
  );
}
