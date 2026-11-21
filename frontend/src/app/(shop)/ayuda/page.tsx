import Link from 'next/link';
import { AlertCircle, BookOpen, CreditCard, HelpCircle, Package, RotateCcw, Shield, Store, Truck } from 'lucide-react';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getHas, getServerLocale, getT } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';

export async function generateMetadata() {
  const t = await getT();
  return pageMetadata({ title: t('Centro de ayuda'), path: '/ayuda' });
}

const TOPICS = [
  [Package, 'Pedidos', 'Estados, cancelaciones y seguimiento de envíos.'],
  [CreditCard, 'Pagos', 'Tarjetas, transferencias y comprobantes.'],
  [Truck, 'Envíos', 'Tarifas, tiempos, transportadoras y envíos internacionales.'],
  [RotateCcw, 'Devoluciones', 'Cómo solicitar cambios y reembolsos.'],
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
  const help = await serverGet<Help>('/help', 30);
  // Returns and shipping have their own public pages (linked from the topic cards).
  const policies = (await serverGet<any[]>('/policies', 300))?.filter((p) => !['RETURN_POLICY', 'SHIPPING_POLICY'].includes(p.code));
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
          const body = <><I className="size-8 text-brand-600" /><p className="mt-3 text-lg font-bold">{t(title)}</p><p className="text-sm text-muted">{t(d)}</p></>;
          const href = title === 'Envíos' ? '/politica-de-envios' : title === 'Devoluciones' ? '/politica-de-devoluciones' : null;
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
          {(help.commissions.rate != null || help.commissions.payoutMinimum != null) && (
            <div className="mt-4 flex flex-wrap gap-3">
              {help.commissions.rate != null && <div className="rounded-xl bg-brand-50 px-4 py-3"><p className="text-xs text-muted">{t('Comisión por venta')}</p><p className="text-2xl font-extrabold text-brand-700">{(help.commissions.rate * 100).toLocaleString(numLocale, { maximumFractionDigits: 2 })} %</p></div>}
              {help.commissions.payoutMinimum != null && <div className="rounded-xl bg-brand-50 px-4 py-3"><p className="text-xs text-muted">{t('Retiro mínimo')}</p><p className="text-2xl font-extrabold text-brand-700">{fmt(help.commissions.payoutMinimum, help.commissions.currency)}</p></div>}
            </div>
          )}
          <p className="mt-3 whitespace-pre-line text-muted">{tr(help.commissions.body, help.commissions.bodyEn, (help.commissions as any)[`body${L}`])}</p>
        </section>
      )}
      {/* Legal texts: the exact published versions people accept at sign-up and store registration. */}
      {(policies?.length ? policies : [
        { code: 'TERMS_OF_SERVICE', slug: 'terminos', title: t('Términos y condiciones'), text: t('Al usar NEXOVAX aceptas comprar y vender de buena fe, cumplir las leyes aplicables en tu país y en el país de destino de cada envío, y las políticas de contenido del marketplace. Los vendedores son responsables de la veracidad de sus publicaciones, precios, inventario, del despacho de sus pedidos y del cumplimiento aduanero de sus envíos internacionales.'), version: null, effectiveAt: null },
        { code: 'PRIVACY_POLICY', slug: 'privacidad', title: t('Política de privacidad'), text: t('Usamos tus datos únicamente para operar tu cuenta, procesar pedidos, pagos y envíos, y dar soporte. Compartimos con las transportadoras solo los datos necesarios para entregar tus pedidos. Los datos sensibles (identificación fiscal y cuentas bancarias de vendedores) se almacenan cifrados. No vendemos tus datos a terceros.'), version: null, effectiveAt: null },
      ]).map((p: any) => (
        <section key={p.code} id={p.slug} className="card mt-6 scroll-mt-24 p-6" data-policy={p.code}>
          <h2 className="text-2xl font-extrabold">{p.title}</h2>
          {p.version && <p className="mt-1 text-xs text-muted">{t('Versión {n} · vigente desde {d}', { n: p.version, d: new Date(p.effectiveAt).toLocaleDateString(numLocale) })}</p>}
          <p className="mt-2 whitespace-pre-line text-sm text-muted">{p.text}</p>
        </section>
      ))}
      <section id="cookies" className="card mt-6 p-6">
        <h2 className="text-2xl font-extrabold">{t('Cookies')}</h2>
        <p className="mt-2 text-sm text-muted">{t('Usamos cookies esenciales para mantener tu sesión iniciada y tus preferencias (como el idioma y borradores de formularios). No usamos cookies de publicidad.')}</p>
        <p className="mt-2 text-sm text-muted" id="ubicacion">{t('País de entrega: para sugerirte un destino usamos solo el país que nuestro proveedor de alojamiento estima a partir de tu conexión. No guardamos tu dirección IP ni pedimos tu ubicación exacta. Si eliges otro país, lo recordamos en una cookie funcional (nx_delivery_country) y, si iniciaste sesión, en tu cuenta. Es solo una referencia para navegar: el envío, los impuestos y la disponibilidad se confirman con la dirección que indiques al pagar.')}</p>
        <p className="mt-2 text-sm text-muted">{t('Con tu permiso usamos cookies de analítica: registramos qué productos visitas y cuánto tiempo, para mejorar las recomendaciones y dar a las tiendas estadísticas totales (visitas, favoritos, ventas). Las tiendas nunca ven quién eres. El detalle se borra a los 90 días y puedes cambiar tu decisión en «Preferencias de cookies», al pie de la página. Si no aceptas, solo contamos visitas de forma anónima.')}</p>
        <p className="mt-2 text-sm text-muted">{t('Google Analytics: si lo aceptas, también medimos de forma agregada cómo se navega el sitio (páginas vistas, productos, carritos y compras) con Google Analytics, mediante sus cookies _ga. No activamos la publicidad ni los anuncios personalizados de Google. Si no aceptas o retiras tu permiso, no se carga y borramos esas cookies.')}</p>
      </section>
    </div>
  );
}
