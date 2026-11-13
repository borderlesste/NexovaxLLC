import Link from 'next/link';
import { AlertCircle, BookOpen, CreditCard, HelpCircle, Package, RotateCcw, Shield, Store, Truck } from 'lucide-react';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Centro de ayuda' };

const FAQ = [
  ['¿Cómo compro en RD Marketplace?', 'Agrega productos al carrito desde cualquier tienda, ve a "Finalizar compra", elige tu dirección, el método de envío por tienda y paga con tarjeta o transferencia bancaria.'],
  ['¿Qué métodos de pago aceptan?', 'Tarjetas de crédito y débito, y transferencias bancarias. Con transferencia reservamos tu inventario por 72 horas mientras validamos el pago.'],
  ['¿Cuánto cuesta el envío?', 'Envío estándar (2 a 5 días hábiles), express (24 a 48 horas) o retiro gratis en la tienda del vendedor. Cada tienda despacha su parte del pedido.'],
  ['¿Cómo sigo mi pedido?', 'En "Mi cuenta → Mis pedidos" verás el estado, la transportadora, el número de guía y el historial de eventos de cada envío.'],
  ['¿Puedo devolver un producto?', 'Sí, según la política de cada tienda (hasta 30 días). Escríbele al vendedor desde tu pedido o reporta un problema.'],
  ['¿Cómo vendo en RD Marketplace?', 'Crea una cuenta, completa el registro de tu tienda con tus datos fiscales (RNC o cédula) y espera la verificación. Luego publica tus productos; pasan por moderación antes de mostrarse.'],
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 lg:px-8">
      <Breadcrumbs items={[{ label: 'Ayuda' }]} />
      <div className="mt-4 rounded-3xl bg-gradient-to-r from-brand-50 to-brand-100 p-8">
        <h1 className="text-4xl font-extrabold">Centro de ayuda</h1>
        <p className="mt-2 text-lg text-muted">Guías, políticas y respuestas para compradores y vendedores.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild><Link href="/ayuda/reportar"><AlertCircle /> Reportar un problema</Link></Button>
          <Button variant="outline" asChild className="bg-white"><Link href="/mensajes"><HelpCircle /> Mis conversaciones</Link></Button>
        </div>
      </div>
      <div id="guias" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[[Package, 'Pedidos', 'Estados, cancelaciones y seguimiento de envíos.'], [CreditCard, 'Pagos', 'Tarjetas, transferencias y comprobantes.'], [Truck, 'Envíos', 'Tarifas, tiempos y cobertura nacional.'], [RotateCcw, 'Devoluciones', 'Cómo solicitar cambios y reembolsos.'], [Store, 'Vendedores', 'Registro, productos, comisiones y retiros.'], [Shield, 'Seguridad', 'Protección al comprador y de tu cuenta.']].map(([I, t, d]: any) => (
          <div key={t} className="card p-5"><I className="size-8 text-brand-600" /><p className="mt-3 text-lg font-bold">{t}</p><p className="text-sm text-muted">{d}</p></div>
        ))}
      </div>
      <section id="faq" className="card mt-8 p-6">
        <h2 className="flex items-center gap-2 text-2xl font-extrabold"><BookOpen className="size-6 text-brand-600" /> Preguntas frecuentes</h2>
        <div className="mt-4 divide-y divide-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-4">
              <summary className="cursor-pointer list-none font-semibold group-open:text-brand-700">{q}</summary>
              <p className="mt-2 text-sm text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>
      <section id="vendedores" className="card mt-6 p-6">
        <h2 id="comisiones" className="text-2xl font-extrabold">Comisiones y pagos a vendedores</h2>
        <p className="mt-2 text-muted">La plataforma cobra una comisión por venta sobre el valor de los productos (sin envío ni impuestos), configurada por la administración y visible en tu panel de finanzas. Los fondos de cada pedido se liberan a tu saldo disponible cuando el pedido se entrega; luego puedes solicitar un retiro a tu cuenta bancaria verificada.</p>
      </section>
      <section id="terminos" className="card mt-6 p-6">
        <h2 className="text-2xl font-extrabold">Términos y condiciones</h2>
        <p className="mt-2 text-sm text-muted">Al usar RD Marketplace aceptas comprar y vender de buena fe, cumplir las leyes de la República Dominicana y las políticas de contenido del marketplace. Los vendedores son responsables de la veracidad de sus publicaciones, precios, inventario y del despacho de sus pedidos.</p>
      </section>
      <section id="privacidad" className="card mt-6 p-6">
        <h2 className="text-2xl font-extrabold">Política de privacidad</h2>
        <p className="mt-2 text-sm text-muted">Usamos tus datos únicamente para operar tu cuenta, procesar pedidos y pagos, y dar soporte. Los datos sensibles (identificación fiscal y cuentas bancarias de vendedores) se almacenan cifrados. No vendemos tus datos a terceros.</p>
      </section>
      <section id="cookies" className="card mt-6 p-6">
        <h2 className="text-2xl font-extrabold">Cookies</h2>
        <p className="mt-2 text-sm text-muted">Usamos cookies esenciales para mantener tu sesión iniciada y preferencias locales (como borradores de formularios). No usamos cookies de publicidad.</p>
      </section>
    </div>
  );
}
