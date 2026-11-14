import Link from 'next/link';
import { AlertCircle, BookOpen, CreditCard, HelpCircle, Package, RotateCcw, Shield, Store, Truck } from 'lucide-react';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Centro de ayuda') };
}

const FAQ = [
  ['¿Cómo compro en NEXOVAX?', 'Agrega productos al carrito desde cualquier tienda, ve a "Finalizar compra", elige tu dirección, el método de envío de cada tienda y paga con tarjeta o transferencia bancaria.'],
  ['¿Qué métodos de pago aceptan?', 'Tarjetas de crédito y débito, y transferencias bancarias. Con transferencia reservamos tu inventario por 72 horas mientras validamos el pago.'],
  ['¿Cuánto cuesta el envío?', 'Depende del origen de la tienda y de tu dirección. Mostramos tarifas en vivo de transportadoras (USPS, UPS, DHL Express y otras) o las tarifas del marketplace, y el retiro en tienda cuando está disponible.'],
  ['¿Hacen envíos internacionales?', 'Sí. Las tiendas despachan desde distintos países; en el checkout verás las transportadoras disponibles para tu país. Los envíos internacionales pueden estar sujetos a impuestos y aranceles de importación del país de destino.'],
  ['¿Cómo se calculan los impuestos?', 'Aplicamos el impuesto al consumo del país de destino (IVA, VAT, GST, ITBIS…) sobre el precio de los productos. Verás el detalle antes de confirmar la compra.'],
  ['¿Cómo sigo mi pedido?', 'En "Mi cuenta → Mis pedidos" verás el estado, la transportadora, el número de guía y el historial de eventos de cada envío. Los envíos con etiqueta se actualizan automáticamente.'],
  ['¿Puedo devolver un producto?', 'Sí, según la política de cada tienda (hasta 30 días). Escríbele al vendedor desde tu pedido o reporta un problema.'],
  ['¿Cómo vendo en NEXOVAX?', 'Crea una cuenta, completa el registro de tu tienda con tu país y tu identificación fiscal, y espera la verificación. Luego publica tus productos; pasan por moderación antes de mostrarse.'],
];

const TOPICS = [
  [Package, 'Pedidos', 'Estados, cancelaciones y seguimiento de envíos.'],
  [CreditCard, 'Pagos', 'Tarjetas, transferencias y comprobantes.'],
  [Truck, 'Envíos', 'Tarifas, tiempos, transportadoras y envíos internacionales.'],
  [RotateCcw, 'Devoluciones', 'Cómo solicitar cambios y reembolsos.'],
  [Store, 'Vendedores', 'Registro, productos, comisiones y retiros.'],
  [Shield, 'Seguridad', 'Protección al comprador y de tu cuenta.'],
] as const;

export default async function HelpPage() {
  const t = await getT();
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
      <div id="guias" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOPICS.map(([I, title, d]) => (
          <div key={title} className="card p-5"><I className="size-8 text-brand-600" /><p className="mt-3 text-lg font-bold">{t(title)}</p><p className="text-sm text-muted">{t(d)}</p></div>
        ))}
      </div>
      <section id="faq" className="card mt-8 p-6">
        <h2 className="flex items-center gap-2 text-2xl font-extrabold"><BookOpen className="size-6 text-brand-600" /> {t('Preguntas frecuentes')}</h2>
        <div className="mt-4 divide-y divide-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-4">
              <summary className="cursor-pointer list-none font-semibold group-open:text-brand-700">{t(q)}</summary>
              <p className="mt-2 text-sm text-muted">{t(a)}</p>
            </details>
          ))}
        </div>
      </section>
      <section id="vendedores" className="card mt-6 p-6">
        <h2 id="comisiones" className="text-2xl font-extrabold">{t('Comisiones y pagos a vendedores')}</h2>
        <p className="mt-2 text-muted">{t('La plataforma cobra una comisión por venta sobre el valor de los productos (sin envío ni impuestos), configurada por la administración y visible en tu panel de finanzas. Los fondos de cada pedido se liberan a tu saldo disponible cuando el pedido se entrega; luego puedes solicitar un retiro a tu cuenta bancaria verificada.')}</p>
      </section>
      <section id="terminos" className="card mt-6 p-6">
        <h2 className="text-2xl font-extrabold">{t('Términos y condiciones')}</h2>
        <p className="mt-2 text-sm text-muted">{t('Al usar NEXOVAX aceptas comprar y vender de buena fe, cumplir las leyes aplicables en tu país y en el país de destino de cada envío, y las políticas de contenido del marketplace. Los vendedores son responsables de la veracidad de sus publicaciones, precios, inventario, del despacho de sus pedidos y del cumplimiento aduanero de sus envíos internacionales.')}</p>
      </section>
      <section id="privacidad" className="card mt-6 p-6">
        <h2 className="text-2xl font-extrabold">{t('Política de privacidad')}</h2>
        <p className="mt-2 text-sm text-muted">{t('Usamos tus datos únicamente para operar tu cuenta, procesar pedidos, pagos y envíos, y dar soporte. Compartimos con las transportadoras solo los datos necesarios para entregar tus pedidos. Los datos sensibles (identificación fiscal y cuentas bancarias de vendedores) se almacenan cifrados. No vendemos tus datos a terceros.')}</p>
      </section>
      <section id="cookies" className="card mt-6 p-6">
        <h2 className="text-2xl font-extrabold">{t('Cookies')}</h2>
        <p className="mt-2 text-sm text-muted">{t('Usamos cookies esenciales para mantener tu sesión iniciada y tus preferencias (como el idioma y borradores de formularios). No usamos cookies de publicidad.')}</p>
      </section>
    </div>
  );
}
