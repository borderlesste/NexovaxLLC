import Link from 'next/link';
import { BarChart3, Check, FileSpreadsheet, MessageSquare, Package, RotateCcw, Store, TicketPercent, Truck, Users, Wallet, Zap } from 'lucide-react';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getHas, getServerLocale, getT } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';

export async function generateMetadata() {
  const t = await getT();
  return pageMetadata({
    title: t('Vende en NEXOVAX'),
    description: t('Abre tu tienda en NEXOVAX: cuánto cuesta vender, cómo recibes tu dinero y cómo funcionan los envíos.'),
    path: '/vende-en-nexovax',
  });
}

type Help = {
  sellers: { title: string; body: string; titleEn?: string; bodyEn?: string; titleFr?: string; bodyFr?: string; titleHt?: string; bodyHt?: string }[];
  commissions: { body: string; bodyEn?: string | null; bodyFr?: string | null; bodyHt?: string | null; rate: number | null; payoutMinimum: string | null; holdDays: number | null; currency: string };
};

const STEPS = [
  [Store, 'Crea tu cuenta y tu tienda', 'Nombre, contacto y dirección de despacho. Los datos fiscales son opcionales al empezar y tu tienda queda activa al instante.'],
  [Package, 'Publica tus productos', 'Con fotos, variantes, precio e inventario, uno por uno o importándolos desde un archivo.'],
  [Truck, 'Recibe pedidos y envía', 'Te avisamos de cada pedido. Las tarifas de envío se calculan desde tu dirección de despacho y registras el envío desde tu panel.'],
  [Wallet, 'Recibe tu dinero', 'Agrega una cuenta de cobro; la verificamos antes de habilitar los retiros. Luego retiras tus ganancias desde Finanzas.'],
] as const;

const TOOLS = [
  [FileSpreadsheet, 'Importación de productos', 'Sube tu catálogo completo desde un archivo.'],
  [MessageSquare, 'Chat con clientes', 'Responde preguntas, con respuestas guardadas y mensaje automático fuera de horario.'],
  [TicketPercent, 'Cupones', 'Crea descuentos para tu tienda.'],
  [Zap, 'Ofertas relámpago', 'Promociones por tiempo limitado.'],
  [Users, 'Equipo', 'Invita a tu personal y decide qué puede ver cada uno.'],
  [BarChart3, 'Estadísticas', 'Ventas, pedidos y productos más vendidos.'],
  [RotateCcw, 'Devoluciones', 'Gestiona solicitudes de devolución desde tu panel.'],
] as const;

/** Public landing for prospective sellers: costs, payouts and shipping come from the admin settings (/help), never hard-coded. */
export default async function SellOnNexovaxPage() {
  const t = await getT();
  const locale = await getServerLocale();
  const has = await getHas();
  const en = locale === 'en';
  const [help, cfg] = await Promise.all([serverGet<Help>('/help', 30), serverGet<{ sellerRegistration?: boolean }>('/config/public', 60)]);
  const tr = (es: string, eng?: string | null, own?: string | null) => (locale === 'es' ? es : en ? eng || t(es) : own || (has(es) ? t(es) : eng || es));
  const L = locale === 'fr' ? 'Fr' : locale === 'ht' ? 'Ht' : 'En';
  const numLocale = ({ es: 'es-US', en: 'en-US', fr: 'fr-FR', ht: 'fr-HT' } as const)[locale];
  const fmt = (v: string, cur: string) => new Intl.NumberFormat(numLocale, { style: 'currency', currency: cur }).format(Number(v));
  const c = help?.commissions;
  const closed = cfg?.sellerRegistration === false;
  const cta = closed ? null : <Button asChild size="lg"><Link href="/vendedor/registro"><Store /> {t('Abrir mi tienda')}</Link></Button>;
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 lg:px-8">
      <Breadcrumbs items={[{ label: t('Vende en NEXOVAX') }]} />
      <section className="mt-4 rounded-3xl bg-gradient-to-r from-brand-50 to-brand-100 p-8 sm:p-10" data-sell-hero>
        <h1 className="text-4xl font-extrabold">{t('Vende en NEXOVAX')}</h1>
        <p className="mt-2 max-w-2xl text-lg text-muted">{t('Abre tu tienda, publica tus productos y llega a clientes en tu país y en el exterior, con pagos y envíos integrados.')}</p>
        {closed && <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{t('El registro de nuevos vendedores está cerrado temporalmente. Vuelve pronto.')}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          {cta}
          <Button asChild size="lg" variant="outline"><Link href="/vendedores">{t('Ver tiendas')}</Link></Button>
        </div>
      </section>

      <section id="comisiones" className="card mt-6 scroll-mt-24 p-6" data-sell-costs>
        <h2 className="text-2xl font-extrabold">{t('Cuánto cuesta vender')}</h2>
        {c && (c.rate != null || c.payoutMinimum != null || c.holdDays != null) && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {c.rate != null && <div className="rounded-xl bg-brand-50 px-4 py-3"><p className="text-xs text-muted">{t('Comisión por venta')}</p><p className="text-2xl font-extrabold text-brand-700">{(c.rate * 100).toLocaleString(numLocale, { maximumFractionDigits: 2 })} %</p></div>}
            {c.payoutMinimum != null && <div className="rounded-xl bg-brand-50 px-4 py-3"><p className="text-xs text-muted">{t('Retiro mínimo')}</p><p className="text-2xl font-extrabold text-brand-700">{fmt(c.payoutMinimum, c.currency)}</p></div>}
            {c.holdDays != null && <div className="rounded-xl bg-brand-50 px-4 py-3"><p className="text-xs text-muted">{t('Retención tras la entrega')}</p><p className="text-2xl font-extrabold text-brand-700">{c.holdDays === 0 ? t('Sin retención') : t('{n} días', { n: c.holdDays })}</p></div>}
          </div>
        )}
        {c?.body && <p className="mt-3 whitespace-pre-line text-muted">{tr(c.body, c.bodyEn, (c as any)[`body${L}`])}</p>}
      </section>

      <section className="mt-6" data-sell-steps>
        <h2 className="text-2xl font-extrabold">{t('Cómo funciona')}</h2>
        <ol className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([I, title, d], i) => (
            <li key={title} className="card p-5">
              <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span><I className="size-6 text-brand-600" /></div>
              <p className="mt-3 font-bold">{t(title)}</p>
              <p className="mt-1 text-sm text-muted">{t(d)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card mt-6 p-6" data-sell-tools>
        <h2 className="text-2xl font-extrabold">{t('Herramientas de tu panel')}</h2>
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map(([I, title, d]) => (
            <li key={title} className="flex gap-3"><I className="size-6 shrink-0 text-brand-600" /><div><p className="font-semibold">{t(title)}</p><p className="text-sm text-muted">{t(d)}</p></div></li>
          ))}
        </ul>
      </section>

      {!!help?.sellers?.length && (
        <section className="card mt-6 p-6" data-sell-faq>
          <h2 className="text-2xl font-extrabold">{t('Preguntas de vendedores')}</h2>
          <div className="mt-4 divide-y divide-line">
            {help.sellers.map((x, i) => (
              <details key={i} className="group py-4">
                <summary className="cursor-pointer list-none font-semibold group-open:text-brand-700">{tr(x.title, x.titleEn, (x as any)[`title${L}`])}</summary>
                <p className="mt-2 whitespace-pre-line text-sm text-muted">{tr(x.body, x.bodyEn, (x as any)[`body${L}`])}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <section className="card mt-6 flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xl font-extrabold">{t('¿Listo para empezar?')}</p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <Link href="/terminos-vendedores" className="font-semibold text-brand-700 hover:underline">{t('Términos para vendedores')}</Link>
            <Link href="/politica-de-envios" className="font-semibold text-brand-700 hover:underline">{t('Política de envíos')}</Link>
            <Link href="/politica-de-devoluciones" className="font-semibold text-brand-700 hover:underline">{t('Política de devoluciones')}</Link>
          </p>
        </div>
        {cta ?? <p className="flex items-center gap-2 text-sm text-muted"><Check className="size-4" /> {t('Te esperamos cuando reabra el registro.')}</p>}
      </section>
    </div>
  );
}
