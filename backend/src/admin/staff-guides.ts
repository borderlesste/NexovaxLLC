import type { ApiLocale } from '../common/i18n-errors';
import { STAFF_GUIDES_I18N } from './staff-guides.i18n';

/**
 * Guías de uso del panel de administración por rol del equipo (Soporte, Moderador, Administrador).
 * Viven en la API (no en el bundle público de la web): solo el equipo las recibe, por GET /admin/guides.
 * Describen lo que cada rol puede hacer hoy en /admin; si cambian los permisos
 * (frontend/src/lib/permissions.ts) o las pantallas, actualiza también este texto y staff-guides.i18n.ts.
 */
export type GuideRole = 'SUPPORT' | 'MODERATOR' | 'ADMIN';

export type GuideSection = {
  id: string;
  title: string;
  /** Pantalla del panel donde se hace (se muestra como botón "Abrir"). */
  href?: string;
  intro?: string;
  steps?: string[];
  tips?: string[];
};

export type Guide = { role: GuideRole; title: string; summary: string; sections: GuideSection[] };

const START: GuideSection = {
  id: 'inicio',
  title: 'Cómo entrar al panel',
  intro: 'Tu cuenta de NEXOVAX es la misma con la que compras; el rol de equipo solo añade el acceso al panel de administración.',
  steps: [
    'Inicia sesión con tu correo y contraseña en nexovax.com.',
    'Abre Mi cuenta y pulsa "Administración" en el menú lateral (o entra directamente en /admin/dashboard).',
    'En el menú del panel solo verás las secciones que tu rol permite. Si abres una sección sin permiso, el panel te muestra qué puedes y qué no puedes hacer.',
    'Todo lo que haces en el panel queda registrado con tu usuario y la fecha. Escribe motivos claros cuando el sistema te los pida.',
  ],
  tips: ['Si necesitas un permiso que no tienes, pídeselo a un administrador: los roles se asignan en Usuarios.'],
};

const DASHBOARD_OPS: GuideSection = {
  id: 'dashboard',
  title: 'Dashboard: tu lista de pendientes',
  href: '/admin/dashboard',
  intro: 'El dashboard muestra los pedidos recientes y las colas de trabajo de tu rol. Las cifras de ventas solo las ven los administradores.',
  steps: [
    'Revisa el bloque "Actividad que requiere atención" al empezar el turno: cada tarjeta indica cuántos casos esperan y lleva a la sección correspondiente.',
    'Usa "Pedidos recientes" para abrir rápidamente el detalle de una compra.',
    'Cuando aparezca "Todo al día" no tienes casos pendientes en tus colas.',
  ],
};

const ORDERS_LOOKUP: GuideSection = {
  id: 'pedidos',
  title: 'Consultar pedidos',
  href: '/admin/pedidos',
  steps: [
    'Busca por número de pedido, cliente o tienda, o filtra por estado.',
    'Abre "Ver detalle" para ver productos, pagos, envíos por tienda, dirección y el historial de estados.',
    'Usa el detalle para responder dudas de clientes o tiendas con información exacta (fechas, transportadora, número de rastreo).',
  ],
};

const TICKETS: GuideSection = {
  id: 'reportes',
  title: 'Reportes y tickets de soporte',
  href: '/admin/reportes',
  intro: 'Aquí llegan los problemas que reportan compradores y vendedores desde el Centro de ayuda.',
  steps: [
    'En la bandeja, filtra por estado, prioridad, plataforma o tipo. Atiende primero los de prioridad Crítica y Alta, y los que estén cerca de "Primera respuesta antes de".',
    'Selecciona un reporte para ver la descripción, la conversación, el pedido relacionado, la página afectada y el navegador del usuario.',
    'Asígnalo a tu equipo o a ti para que el resto sepa quién lo lleva.',
    '"Responder al usuario" envía el mensaje al cliente (con adjuntos si hace falta). "Nota interna" solo la ve el equipo.',
    'Cambia el estado según avance: Pendiente → Revisión interna o Esperando usuario → Resuelto o Cerrado.',
    'Si el caso necesita a otro equipo (por ejemplo, un producto prohibido), usa "Escalar": pasa a moderación.',
  ],
  tips: ['Antes de cerrar, confirma con el usuario que el problema quedó resuelto y deja una nota interna con lo que se hizo.'],
};

const SUPPORT_ORDERS: GuideSection = {
  id: 'envios',
  title: 'Seguimiento de envíos y cancelaciones',
  href: '/admin/pedidos',
  steps: [
    'Abre el pedido y localiza el envío de la tienda en cuestión.',
    'Si el envío usa rastreo automático (Shippo), pulsa "Actualizar rastreo" para consultar el estado más reciente de la transportadora.',
    'Si el envío no tiene rastreo automático, pulsa "Actualizar seguimiento" y registra el evento (estado, fecha y detalle). El cliente lo verá en su pedido.',
    'Para cancelar una compra que aún no se ha enviado, usa "Cancelar compra" e indica el motivo. El stock vuelve al inventario.',
    'El reembolso de una cancelación lo emite un administrador desde su panel; tú no mueves dinero.',
  ],
};

const SUPPORT_RETURNS: GuideSection = {
  id: 'devoluciones',
  title: 'Devoluciones',
  href: '/admin/devoluciones',
  intro: 'Gestionas las devoluciones de principio a fin, salvo el reembolso, que emite un administrador.',
  steps: [
    'Abre una solicitud desde la lista y revisa el motivo, las fotos y la política de devolución vigente (aparece en la misma página).',
    '"Aprobar devolución" si cumple la política, o "Rechazar devolución" explicando el motivo al cliente.',
    'Al aprobar, genera la etiqueta prepagada con "Generar etiqueta de devolución", o registra el envío si el cliente lo manda por su cuenta.',
    'Cuando el paquete llega a la tienda, pulsa "Marcar como recibida".',
    'Usa "Registrar inspección" para dejar constancia del estado en que llegó el producto, con notas.',
    'Con la inspección registrada, la devolución queda en "Reembolso pendiente" para que un administrador emita el reembolso.',
  ],
};

const MOD_PRODUCTS: GuideSection = {
  id: 'moderacion',
  title: 'Moderar productos nuevos',
  href: '/admin/moderacion',
  intro: 'Si la moderación obligatoria está activa, ningún producto ni cambio importante se publica sin tu revisión.',
  steps: [
    'Abre la cola "Pendientes" y selecciona un producto.',
    'Revisa título, descripción, categoría, imágenes, precio, stock y variantes.',
    'Recorre el "Checklist de revisión": información completa, imágenes reales y de calidad, precio y stock válidos, y cumplimiento de las políticas.',
    '"Aprobar" publica el producto en el catálogo.',
    '"Solicitar cambios" lo devuelve a la tienda con tu nota para que lo corrija.',
    '"Rechazar" no lo publica; la nota de moderación es obligatoria y la tienda la recibe.',
  ],
  tips: [
    'Escribe notas concretas ("La foto 2 es de otro producto", "Falta la talla en la variante M") para que la tienda sepa qué cambiar.',
    'Las pestañas Aprobados y Rechazados sirven para revisar decisiones anteriores.',
  ],
};

const MOD_CATALOG: GuideSection = {
  id: 'productos',
  title: 'Supervisar el catálogo publicado',
  href: '/admin/productos',
  steps: [
    'Busca por nombre, SKU o vendedor, y filtra por estado (Publicados, En revisión, Borradores, Rechazados, Suspendidos) o por categoría.',
    'Si un producto publicado incumple las políticas, pulsa "Suspender" y escribe el motivo: deja de mostrarse en la tienda.',
    'Cuando la tienda lo corrija, usa "Reactivar" con el motivo de la reactivación.',
    '"Revisar" abre el producto para comprobar su contenido.',
  ],
};

const MOD_SELLERS: GuideSection = {
  id: 'vendedores',
  title: 'Aprobar y supervisar tiendas',
  href: '/admin/vendedores',
  steps: [
    'Filtra por "Pendientes" para ver las solicitudes de tiendas nuevas.',
    'Pulsa "Gestionar" y revisa propietario, correo, teléfono, tipo de entidad, dirección de despacho y descripción.',
    '"Aprobar tienda" la activa: el vendedor ya puede publicar productos.',
    '"Rechazar" o "Suspender" piden un motivo que queda en el historial. Al suspender, los productos publicados de la tienda se pausan.',
    '"Reactivar" devuelve una tienda suspendida a la actividad.',
  ],
  tips: ['Crear vendedores y verificar sus métodos de cobro corresponde solo a administradores.'],
};

const MOD_CATEGORIES: GuideSection = {
  id: 'categorias',
  title: 'Consultar categorías',
  href: '/admin/categorias',
  steps: [
    'Consulta el árbol de categorías, sus subcategorías y los atributos que piden a los productos (por ejemplo, talla o color).',
    'Úsalo para comprobar que un producto está en la categoría correcta durante la moderación.',
    'Crear, editar o archivar categorías y atributos corresponde a un administrador.',
  ],
};

export const GUIDES: Guide[] = [
  {
    role: 'SUPPORT',
    title: 'Guía de Soporte',
    summary: 'Atiendes a compradores y tiendas: reportes y tickets, seguimiento de pedidos y envíos, cancelaciones antes del envío y devoluciones.',
    sections: [START, DASHBOARD_OPS, TICKETS, ORDERS_LOOKUP, SUPPORT_ORDERS, SUPPORT_RETURNS],
  },
  {
    role: 'MODERATOR',
    title: 'Guía de Moderación',
    summary: 'Cuidas la calidad y la seguridad del catálogo: revisas productos y tiendas antes de que se publiquen y actúas sobre lo que incumple las políticas.',
    sections: [START, DASHBOARD_OPS, MOD_PRODUCTS, MOD_CATALOG, MOD_SELLERS, MOD_CATEGORIES, ORDERS_LOOKUP, TICKETS],
  },
  {
    role: 'ADMIN',
    title: 'Guía de Administración',
    summary:
      'Tienes acceso completo al panel: además de todo lo que hacen Soporte y Moderación, gestionas el dinero (pagos, reembolsos, comisiones y retiros), los usuarios y sus roles, la configuración del marketplace y las políticas legales.',
    sections: [
      { ...START, steps: [...START.steps!.slice(0, 2), 'Como administrador ves todas las secciones del panel.', START.steps![3]] },
      {
        id: 'dashboard',
        title: 'Dashboard y rendimiento',
        href: '/admin/dashboard',
        steps: [
          'Elige el período (7, 30 o 90 días) para ver ventas totales, pedidos, vendedores activos y productos publicados, comparados con el período anterior.',
          'Las gráficas muestran ventas o pedidos por día y la distribución de los pedidos por estado.',
          '"Actividad que requiere atención" reúne todas las colas: productos por revisar, tiendas nuevas, transferencias por confirmar, retiros, métodos de cobro por verificar, cancelaciones por reembolsar, afiliados por pagar, devoluciones, alertas de inventario y reportes abiertos.',
          '"Exportar informe" descarga los datos del período.',
        ],
      },
      { ...MOD_PRODUCTS, title: 'Moderación de productos' },
      {
        ...MOD_CATALOG,
        title: 'Catálogo y productos destacados',
        steps: [...MOD_CATALOG.steps!, '"Destacar en la portada" muestra el producto en la sección de destacados del inicio (si está activada en Configuración); "Quitar de destacados" lo retira.'],
      },
      {
        id: 'categorias',
        title: 'Categorías y atributos',
        href: '/admin/categorias',
        steps: [
          '"Crear categoría" con nombre, categoría padre (o principal) y orden de aparición.',
          'Usa "Atributos" para definir los datos que se piden a los productos de esa categoría (talla, color, material…). Aparecen como filtros en el catálogo.',
          '"Editar" cambia nombre, padre u orden; "Archivar" la oculta del catálogo.',
          'Antes de archivar, revisa cuántos productos y subcategorías tiene.',
        ],
      },
      {
        ...MOD_SELLERS,
        title: 'Vendedores y métodos de cobro',
        steps: [
          ...MOD_SELLERS.steps!,
          '"Nuevo vendedor" crea la cuenta del propietario y la tienda ya aprobada. Si el usuario no tenía cuenta, se genera una contraseña temporal: compártela de forma segura.',
          'En el detalle de la tienda, en "Métodos de cobro", verifica o rechaza cada cuenta bancaria. Sin un método verificado la tienda no puede retirar dinero.',
          'El detalle también muestra ventas de 12 meses, saldo disponible y pendiente, comisión generada e historial de estado.',
        ],
        tips: undefined,
      },
      {
        id: 'pedidos',
        title: 'Pedidos, cancelaciones y reembolsos',
        href: '/admin/pedidos',
        steps: [
          ...ORDERS_LOOKUP.steps!,
          'Puedes actualizar seguimientos y cancelar compras antes del envío, igual que Soporte.',
          'Las compras canceladas quedan en la cola "Cancelaciones por reembolsar": emite el reembolso desde el pedido.',
          '"Reembolsar sin devolución" devuelve el dinero al cliente sin que tenga que enviar el producto (por ejemplo, un paquete perdido). Úsalo con criterio: se revierten el monto de la tienda y la comisión.',
        ],
      },
      {
        ...SUPPORT_RETURNS,
        title: 'Devoluciones y política de devolución',
        intro: 'Ves y gestionas todas las devoluciones y, además, emites los reembolsos y defines la política.',
        steps: [
          ...SUPPORT_RETURNS.steps!.slice(0, 5),
          'Cuando la inspección está registrada, pulsa "Reembolsar al cliente". El reembolso se envía por el mismo medio de pago (Stripe o PayPal).',
          'En la misma página puedes editar la política de devolución del marketplace que ven los compradores.',
        ],
      },
      { ...TICKETS, title: 'Reportes y soporte' },
      {
        id: 'finanzas',
        title: 'Finanzas: ventas, transferencias y retiros',
        href: '/admin/finanzas',
        steps: [
          'Elige el período para ver ventas totales (GMV), comisiones de la plataforma, impuestos recaudados, costos de envío y vendedores activos.',
          'En "Pagos por transferencia pendientes de validación" confirma cada transferencia solo cuando el dinero esté en la cuenta del marketplace: indica la referencia del banco o el número de comprobante. Al confirmar, el pedido se crea y se avisa a la tienda.',
          'Si la transferencia no llega antes de que venza, recházala: se libera el inventario reservado.',
          'La tabla "Retiros de vendedores" muestra las solicitudes de retiro y su estado.',
          '"Exportar" descarga los datos financieros del período.',
        ],
      },
      {
        id: 'comisiones',
        title: 'Comisiones y payouts',
        href: '/admin/comisiones',
        steps: [
          'La pestaña Comisiones muestra, por vendedor, ventas, comisión del marketplace, neto, saldo disponible y pendiente.',
          'En Liquidaciones aparecen los retiros solicitados. Revisa el destino (método de cobro verificado) y el monto, y pulsa "Aprobar".',
          'Haz la transferencia desde la banca de la empresa y pulsa "Liquidar" → "Registrar transferencia" con la referencia bancaria. Si no procede, "Cancelar" el retiro.',
          '"Retiros programados" lista las tiendas con retiro automático y el monto de hoy; "Ejecutar ahora" crea la solicitud, que luego apruebas en la lista.',
          '"Pagos a afiliados": envía el dinero de las comisiones disponibles de cada afiliado y registra la referencia.',
          'Historial de pagos guarda todos los payouts realizados.',
          'Los fondos de una venta solo pasan a disponibles después de la entrega y de los días de liberación configurados.',
        ],
        tips: ['Si un pedido tiene una disputa abierta, el pago a la tienda queda retenido hasta cerrarla (ver Disputas y reembolsos).'],
      },
      {
        id: 'incidencias',
        title: 'Disputas y reembolsos externos',
        href: '/admin/incidencias-pago',
        intro: 'Aquí llegan, por los webhooks de Stripe y PayPal, las disputas (contracargos) de clientes y los reembolsos hechos directamente en esos paneles.',
        steps: [
          'Disputa: pulsa "Responder disputa" y responde en el panel del procesador antes de la fecha límite, con la prueba de entrega (seguimiento, fotos, mensajes). NEXOVAX registra el resultado cuando el procesador la cierra.',
          'Reembolso total hecho fuera de NEXOVAX y pedido aún sin enviar: "Registrar como cancelación". El pedido se cancela, vuelve el stock y se anula la ganancia de la tienda, sin devolver el dinero otra vez.',
          'Reembolso parcial, o pedido ya enviado: "Registrar reembolso parcial" contra las unidades que cubrió, para descontarlo a la tienda.',
          'Si fue un descuento acordado, "Marcar como revisado". Al terminar, "Cerrar incidencia" libera la retención del pago a la tienda.',
        ],
      },
      {
        id: 'usuarios',
        title: 'Usuarios, roles y permisos',
        href: '/admin/usuarios',
        steps: [
          'Busca por nombre o correo, o filtra por rol.',
          'Pulsa "Gestionar" y marca o desmarca los roles: Soporte, Moderador o Administrador.',
          'Da a cada persona solo el rol que necesita. Administrador tiene acceso al dinero y a la configuración.',
          '"Suspender cuenta" impide el acceso de un usuario; "Reactivar" lo devuelve a la actividad.',
        ],
        tips: ['En Configuración → Roles y permisos tienes el resumen de lo que puede y no puede hacer cada rol.'],
      },
      {
        id: 'configuracion',
        title: 'Configuración del marketplace',
        href: '/admin/configuracion',
        intro: 'Cada cambio queda versionado y auditado. Revisa bien antes de pulsar "Guardar cambios".',
        steps: [
          'General: nombre, URL base, moneda, idioma y país predeterminados, y correo de soporte. Cambiar la moneda vacía los carritos activos y obliga a dar precios en la nueva moneda.',
          'Opciones: activa o desactiva los productos destacados, el registro de vendedores, la moderación obligatoria y las notificaciones por correo.',
          'Comisiones y pagos: comisión global por venta (sobre el precio después de descuentos, sin envío ni impuestos), días de liberación de fondos, monto mínimo de retiro y aprobación manual o automática de retiros.',
          'Envíos: activa las tarifas en vivo de Shippo, elige las transportadoras y define las tarifas fijas de respaldo y el retiro en tienda por zona.',
          'Transferencia bancaria: actívala y completa banco, titular, número de cuenta, SWIFT/IBAN e instrucciones. El inventario se reserva durante el plazo fijado en Configuración → Seguridad hasta que confirmes el pago.',
          'Impuestos: agrega la tasa de cada país de destino (IVA, VAT, GST…). Los países sin tasa quedan con 0 %. Confirma las tasas con tu asesor fiscal.',
          'Estado del sistema: comprueba si los servicios (pagos, correo, envíos) están activos o en modo prueba.',
        ],
      },
      {
        id: 'politicas',
        title: 'Políticas legales',
        href: '/admin/politicas',
        steps: [
          'Elige el documento (términos, privacidad o términos para vendedores) y edita el título y el texto en cada idioma. Si dejas un idioma vacío, se muestra el texto en español.',
          'Marca "Pedir que todos la acepten de nuevo" solo para cambios importantes: cada cuenta o tienda verá un aviso para aceptarla.',
          'Deja "Entra en vigor" vacío para publicar de inmediato, o pon una fecha para programarla.',
          'Las versiones publicadas no se pueden modificar: quedan como prueba de lo que se aceptó. En el historial ves cuántas aceptaciones tiene cada una.',
        ],
      },
      {
        id: 'rutina',
        title: 'Rutina diaria recomendada',
        steps: [
          'Dashboard: vacía las colas de "Actividad que requiere atención".',
          'Finanzas: confirma las transferencias recibidas y revisa los retiros solicitados.',
          'Disputas y reembolsos: responde las disputas antes de su fecha límite.',
          'Devoluciones y cancelaciones: emite los reembolsos pendientes.',
          'Moderación y vendedores: que nada quede esperando más de un día.',
        ],
      },
    ],
  },
];


const CHAIN: Record<Exclude<ApiLocale, 'es'>, ('en' | 'fr' | 'ht')[]> = { en: ['en'], fr: ['fr', 'en'], ht: ['ht', 'fr', 'en'] };

/** The guides the given staff roles may read, translated to the request language. */
export function staffGuides(roles: string[], locale: ApiLocale): Guide[] {
  const admin = roles.includes('ADMIN') || roles.includes('SUPER_ADMIN');
  const allowed = GUIDES.filter((g) => admin || roles.includes(g.role));
  if (locale === 'es') return allowed;
  const tr = (s: string) => {
    for (const l of CHAIN[locale]) {
      const v = STAFF_GUIDES_I18N[l][s];
      if (v !== undefined) return v;
    }
    return s;
  };
  const sec = (s: GuideSection): GuideSection => ({
    ...s,
    title: tr(s.title),
    intro: s.intro && tr(s.intro),
    steps: s.steps?.map(tr),
    tips: s.tips?.map(tr),
  });
  return allowed.map((g) => ({ ...g, title: tr(g.title), summary: tr(g.summary), sections: g.sections.map(sec) }));
}
