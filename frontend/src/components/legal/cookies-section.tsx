import { getT } from '@/lib/i18n/server';

/** Cookies and delivery-country notice, shown on /privacidad (linked from the cookie banner and the country selector). */
export async function CookiesSection() {
  const t = await getT();
  return (
        <section id="cookies" className="card mt-6 scroll-mt-24 p-6" data-cookies>
          <h2 className="text-2xl font-extrabold">{t('Cookies')}</h2>
          <p className="mt-2 text-sm text-muted">{t('Usamos cookies esenciales para mantener tu sesión iniciada y tus preferencias (como el idioma y borradores de formularios). Si agregas productos sin haber iniciado sesión, tu carrito se guarda solo en este navegador y pasa a tu cuenta cuando inicias sesión. No usamos cookies de publicidad.')}</p>
          <p className="mt-2 scroll-mt-24 text-sm text-muted" id="ubicacion">{t('País de entrega: para sugerirte un destino usamos solo el país que nuestro proveedor de alojamiento estima a partir de tu conexión. No guardamos tu dirección IP ni pedimos tu ubicación exacta. Si eliges otro país, lo recordamos en una cookie funcional (nx_delivery_country) y, si iniciaste sesión, en tu cuenta. Es solo una referencia para navegar: el envío, los impuestos y la disponibilidad se confirman con la dirección que indiques al pagar.')}</p>
          <p className="mt-2 text-sm text-muted">{t('Con tu permiso usamos cookies de analítica: registramos qué productos visitas y cuánto tiempo, para mejorar las recomendaciones y dar a las tiendas estadísticas totales (visitas, favoritos, ventas). Las tiendas nunca ven quién eres. El detalle se borra a los 90 días y puedes cambiar tu decisión en «Preferencias de cookies», al pie de la página. Si no aceptas, solo contamos visitas de forma anónima.')}</p>
          <p className="mt-2 text-sm text-muted">{t('Google Analytics: si lo aceptas, también medimos de forma agregada cómo se navega el sitio (páginas vistas, productos, carritos y compras) con Google Analytics, mediante sus cookies _ga. No activamos la publicidad ni los anuncios personalizados de Google. Si no aceptas o retiras tu permiso, no se carga y borramos esas cookies.')}</p>
        </section>
  );
}
