import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/** English versions of API error messages (keyed by the Spanish source text). */
const EN: Record<string, string> = {
  'El pago aún no se ha completado.': 'The payment hasn’t been completed yet.',
  'PayPal aún no confirma el pago.': 'PayPal hasn’t confirmed the payment yet.',
  'El monto cobrado no coincide con el pedido.': 'The charged amount doesn’t match the order.',
  'El pago no corresponde a una tarjeta.': 'This payment isn’t a card payment.',
  'El pago no corresponde a PayPal.': 'This payment isn’t a PayPal payment.',
  'El pago con tarjeta se está procesando. Espera unos segundos.': 'The card payment is being processed. Please wait a few seconds.',
  'PayPal rechazó el método de pago. Elige otro método en PayPal.': 'PayPal declined the payment method. Choose another method in PayPal.',
  'PayPal no pudo procesar la operación.': 'PayPal could not process the operation.',
  'PayPal no respondió. Inténtalo de nuevo.': 'PayPal didn’t respond. Please try again.',
  'Firma de webhook inválida.': 'Invalid webhook signature.',
  'Tu cuenta está restringida. Contacta a soporte.': 'Your account is restricted. Please contact support.',
  'Indica el banco y un número de cuenta o IBAN válido.': 'Enter the bank and a valid account number or IBAN.',
  'Completa banco, titular y número de cuenta para habilitar transferencias.': 'Fill in bank, account holder and account number to enable bank transfers.',
  'El CVV no es válido.': 'The CVV is not valid.',
  'La tarjeta fue rechazada por el emisor (tarjeta de prueba de rechazo).': 'The card was declined by the issuer (test decline card).',
  'La tarjeta está vencida.': 'The card has expired.',
  'El número de tarjeta no es válido.': 'The card number is not valid.',
  'Ingresa el nombre que aparece en la tarjeta.': 'Enter the name shown on the card.',
  'Ingresa los datos de la tarjeta.': 'Enter your card details.',
  'Selecciona una transportadora válida.': 'Select a valid carrier.',
  'Indica el nombre de la transportadora.': 'Enter the carrier name.',
  'Tu carrito está vacío.': 'Your cart is empty.',
  'Archiva primero las subcategorías.': 'Archive the subcategories first.',
  'Selecciona un tipo de problema.': 'Select a problem type.',
  'Selecciona una categoría válida.': 'Select a valid category.',
  'La categoría tiene productos. Muévelos antes de archivarla.': 'The category has products. Move them before archiving it.',
  'Tienes un pago en proceso. Complétalo o espera su confirmación antes de modificar el carrito.': 'You have a payment in progress. Complete it or wait for confirmation before changing your cart.',
  'Selecciona una dirección de envío válida.': 'Select a valid shipping address.',
  'Indica la ciudad.': 'Enter the city.',
  'Código de seguimiento inválido.': 'Invalid tracking code.',
  'La comisión debe estar entre 0 % y 50 %.': 'The commission must be between 0% and 50%.',
  'Otra operación modificó los datos. Inténtalo de nuevo.': 'Another operation changed the data. Please try again.',
  'Selecciona un país válido.': 'Select a valid country.',
  'Moneda no soportada.': 'Unsupported currency.',
  'La descripción debe tener al menos 10 caracteres.': 'The description must be at least 10 characters.',
  'La descripción admite máximo 5,000 caracteres.': 'The description allows up to 5,000 characters.',
  'Ya existe un registro con esos datos.': 'A record with those details already exists.',
  'Correo de la cuenta inválido.': 'Invalid account e-mail.',
  'Ya existe una cuenta con ese correo.': 'An account with that e-mail already exists.',
  'Clave de cifrado inválida.': 'Invalid encryption key.',
  'El cifrado de datos sensibles no está configurado.': 'Sensitive-data encryption is not configured.',
  'Tipo de entidad inválido.': 'Invalid entity type.',
  'No tienes permiso para acceder a esta sección.': 'You don’t have permission to access this section.',
  'Solo un super administrador puede asignar este rol.': 'Only a super administrator can assign this role.',
  'Falta la clave de idempotencia.': 'Missing idempotency key.',
  'La imagen supera 8 MB.': 'The image exceeds 8 MB.',
  'Selecciona una imagen.': 'Select an image.',
  'No hay suficiente inventario para uno de los productos de tu carrito.': 'There isn’t enough stock for one of the products in your cart.',
  'Acción inválida.': 'Invalid action.',
  'El archivo no es una imagen válida.': 'The file is not a valid image.',
  'Cantidad inválida.': 'Invalid quantity.',
  'Acción no válida para el estado actual de la tienda.': 'Action not valid for the store’s current status.',
  'No se puede aplicar esta acción al producto en su estado actual.': 'This action can’t be applied to the product in its current status.',
  'Archivo inválido.': 'Invalid file.',
  'Idioma no soportado.': 'Unsupported language.',
  'El recurso está ocupado. Inténtalo de nuevo.': 'The resource is busy. Please try again.',
  'Archivo no encontrado.': 'File not found.',
  'Escribe un mensaje.': 'Write a message.',
  'Escribe una respuesta.': 'Write a reply.',
  'El mensaje es demasiado largo.': 'The message is too long.',
  'Este pedido ya fue preparado.': 'This order has already been prepared.',
  'Primero marca el pedido como "En preparación".': 'First mark the order as "Preparing".',
  'Podrás opinar cuando recibas el producto.': 'You can review it once you receive the product.',
  'El producto no está pendiente de revisión.': 'The product is not pending review.',
  'El retiro no está en procesamiento.': 'The payout is not being processed.',
  'Selecciona al menos una imagen.': 'Select at least one image.',
  'Configura tu almacén antes de crear productos.': 'Set up your warehouse before creating products.',
  'Aún no tienes una tienda. Crea tu tienda para continuar.': 'You don’t have a store yet. Create your store to continue.',
  'El pedido está cerrado o cancelado.': 'The order is closed or cancelled.',
  'Categoría padre inválida.': 'Invalid parent category.',
  'Método de pago no disponible.': 'Payment method not available.',
  'El pago ya fue procesado.': 'The payment was already processed.',
  'El procesador de pagos no está disponible.': 'The payment processor is unavailable.',
  'Este método tiene retiros en curso.': 'This method has payouts in progress.',
  'El método de cobro debe estar verificado por el equipo del marketplace antes de retirar.': 'The payout method must be verified by the marketplace team before withdrawing.',
  'El código postal no es válido para el país seleccionado.': 'The postal code is not valid for the selected country.',
  'Indica el código postal.': 'Enter the postal code.',
  'El producto está archivado.': 'The product is archived.',
  'Agrega al menos una imagen antes de enviar a revisión.': 'Add at least one image before submitting for review.',
  'Tu cuenta aún no está activa en el marketplace.': 'Your account is not active on the marketplace yet.',
  'Indica el motivo para el vendedor.': 'Enter the reason for the seller.',
  'Indica el motivo.': 'Enter the reason.',
  'Referencia inválida o en uso.': 'Invalid or already used reference.',
  'Indica la referencia bancaria recibida.': 'Enter the bank reference received.',
  'Indica la referencia de la transferencia bancaria.': 'Enter the bank transfer reference.',
  'Usa el código de 2 letras del estado (ej. FL, CA, NY).': 'Use the 2-letter state code (e.g. FL, CA, NY).',
  'Indica el estado o provincia.': 'Enter the state or province.',
  'No puedes escribirte a tu propia tienda.': 'You can’t message your own store.',
  'No puedes quitarte tu propio rol de administrador.': 'You can’t remove your own administrator role.',
  'No puedes cambiar el estado de tu propia cuenta.': 'You can’t change your own account status.',
  'Ya tienes una tienda registrada.': 'You already have a registered store.',
  'Aprueba primero la tienda del vendedor.': 'Approve the seller’s store first.',
  'Tu tienda no puede publicar productos en este momento.': 'Your store can’t publish products right now.',
  'La tienda no tiene una dirección de despacho configurada.': 'The store has no ship-from address configured.',
  'El registro de vendedores está cerrado temporalmente.': 'Seller registration is temporarily closed.',
  'Indica la tienda.': 'Specify the store.',
  'Faltan datos del envío (direcciones o paquete).': 'Shipment data is missing (addresses or package).',
  'El envío no está listo para generar etiqueta.': 'The shipment is not ready for a label.',
  'Indica peso (kg) y dimensiones (largo, ancho y alto en cm) del paquete para calcular el envío.': 'Enter the package weight (kg) and dimensions (length, width and height in cm) to calculate shipping.',
  'La transportadora no ofrece servicio para esta ruta en este momento.': 'The carrier doesn’t serve this route at the moment.',
  'Una opción de envío ya no está disponible. Revisa los métodos de envío.': 'A shipping option is no longer available. Please review the shipping methods.',
  'El proveedor de envíos no respondió. Inténtalo de nuevo.': 'The shipping provider didn’t respond. Please try again.',
  'Shippo no está configurado.': 'Shippo is not configured.',
  'Revisa las tarifas de envío.': 'Review the shipping rates.',
  'Cada variante necesita un SKU.': 'Each variant needs a SKU.',
  'El stock debe ser un número entero positivo.': 'Stock must be a positive whole number.',
  'Esta tienda aún no tiene productos publicados.': 'This store has no published products yet.',
  'Ingresa un número de identificación fiscal válido.': 'Enter a valid tax identification number.',
  'La tasa debe estar entre 0 % y 99 %.': 'The rate must be between 0% and 99%.',
  'El nombre del producto es obligatorio.': 'The product name is required.',
  'Máximo 8 imágenes por producto.': 'Up to 8 images per product.',
  'Máximo 100 variantes por producto.': 'Up to 100 variants per product.',
  'Este envío se actualiza manualmente por el vendedor.': 'This shipment is updated manually by the seller.',
  'Indica el número de guía de la transportadora.': 'Enter the carrier tracking number.',
  'Debes iniciar sesión.': 'You need to sign in.',
  'Tu sesión no es válida o expiró.': 'Your session is invalid or has expired.',
  'Formato no permitido. Usa JPG, PNG, WebP o AVIF.': 'Format not allowed. Use JPG, PNG, WebP or AVIF.',
  'Los datos enviados no son válidos.': 'The submitted data is not valid.',
  'Revisa los datos del formulario.': 'Please review the form.',
  'Agrega al menos una variante con precio y stock.': 'Add at least one variant with price and stock.',
  'Hay variantes con la misma combinación de opciones.': 'Some variants have the same option combination.',
  'La contraseña debe tener al menos 8 caracteres, con letras y números.': 'The password must be at least 8 characters, with letters and numbers.',
  'La contraseña no cumple los requisitos de seguridad.': 'The password doesn’t meet the security requirements.',
  'Teléfono inválido.': 'Invalid phone number.',
  'Correo electrónico inválido.': 'Invalid e-mail address.',
  'Ocurrió un error inesperado.': 'An unexpected error occurred.',
  'Demasiadas solicitudes. Espera un momento.': 'Too many requests. Please wait a moment.',
  'La entrega la confirma el cliente, la transportista o el equipo de soporte.': 'Delivery is confirmed by the customer, the carrier or the support team.',
  'Este envío se actualiza automáticamente con la transportista.': 'This shipment is updated automatically by the carrier.',
  'Este envío ya fue entregado.': 'This shipment has already been delivered.',
  'No se pudo cancelar el pago con el procesador. Inténtalo de nuevo.': 'The payment could not be cancelled with the processor. Please try again.',
  'Este pago no es una transferencia bancaria.': 'This payment is not a bank transfer.',
  'Solo un super administrador puede modificar cuentas o roles de administrador.': 'Only a super administrator can modify administrator accounts or roles.',
  'Debe quedar al menos un super administrador activo.': 'At least one active super administrator must remain.',
  'Confirma tu correo electrónico para continuar.': 'Confirm your e-mail address to continue.',
  'Tu carrito cambió mientras confirmabas el pedido. Revisa el resumen e inténtalo de nuevo.': 'Your cart changed while you were placing the order. Review the summary and try again.',
  'El enlace de rastreo debe ser una dirección https válida.': 'The tracking link must be a valid https address.',
  'La imagen es demasiado grande (máximo 8000 px por lado).': 'The image is too large (maximum 8000 px per side).',
  'No se permiten imágenes animadas ni de varias páginas.': 'Animated or multi-page images are not allowed.',
  'El nombre es demasiado corto.': 'The name is too short.',
  'El nombre es demasiado largo.': 'The name is too long.',
  'El nombre solo puede contener letras, espacios, apóstrofos y guiones.': 'The name can only contain letters, spaces, apostrophes and hyphens.',
  'El nombre del lugar es demasiado corto.': 'The place name is too short.',
  'El nombre del lugar es demasiado largo.': 'The place name is too long.',
  'La ciudad o región solo puede contener letras.': 'The city or region can only contain letters.',
  'La dirección es demasiado corta.': 'The address is too short.',
  'La dirección es demasiado larga.': 'The address is too long.',
  'La dirección contiene caracteres no permitidos.': 'The address contains characters that are not allowed.',
  'El teléfono solo puede contener números (7 a 15 dígitos) y los signos + ( ) -.': 'The phone can only contain numbers (7 to 15 digits) and the signs + ( ) -.',
  'Código de país inválido.': 'Invalid country code.',
  'Código de moneda inválido.': 'Invalid currency code.',
  'Código postal inválido.': 'Invalid postal code.',
  'El texto contiene caracteres o etiquetas no permitidos.': 'The text contains characters or tags that are not allowed.',
  "El nombre solo puede contener letras, números y los signos & . , ' - ( ).": "The name can only contain letters, numbers and the signs & . , ' - ( ).",
  "El titular solo puede contener letras, números y los signos & . , ' - ( ).": "The account holder can only contain letters, numbers and the signs & . , ' - ( ).",
  'El identificador fiscal solo puede contener letras, números, puntos y guiones (mínimo 3 dígitos).': 'The tax ID can only contain letters, numbers, dots and hyphens (at least 3 digits).',
  'Número de documento inválido.': 'Invalid document number.',
  'Número de cuenta inválido: usa solo números (o el IBAN).': 'Invalid account number: use digits only (or the IBAN).',
  'Código SWIFT/BIC (8 u 11 caracteres) o número de ruta (9 dígitos) inválido.': 'Invalid SWIFT/BIC (8 or 11 characters) or routing number (9 digits).',
  'El SKU solo puede contener letras, números, puntos, guiones y guiones bajos.': 'The SKU can only contain letters, numbers, dots, hyphens and underscores.',
  'La URL amigable solo puede contener minúsculas, números y guiones.': 'The URL slug can only contain lowercase letters, numbers and hyphens.',
  'El número de guía solo puede contener letras, números y guiones.': 'The tracking number can only contain letters, numbers and hyphens.',
  'Número de pedido inválido (ej. NX-123456).': 'Invalid order number (e.g. NX-123456).',
  'La referencia solo puede contener letras, números y - / _ . #': 'The reference can only contain letters, numbers and - / _ . #',
  'El enlace es demasiado largo.': 'The link is too long.',
  'Ingresa un enlace válido que empiece por https://': 'Enter a valid link starting with https://',
  'Zona horaria inválida.': 'Invalid time zone.',
  'El color debe tener el formato #RRGGBB.': 'The color must use the #RRGGBB format.',
  'El monto debe ser un número con máximo 2 decimales.': 'The amount must be a number with at most 2 decimals.',
  'El stock debe ser un número entero.': 'Stock must be a whole number.',
  'El stock no puede ser negativo.': 'Stock can’t be negative.',
  'La cantidad debe ser un número entero.': 'The quantity must be a whole number.',
  'El stock mínimo debe ser un número entero.': 'The minimum stock must be a whole number.',
  'Transportadora inválida.': 'Invalid carrier.',
  'Tipo de reporte inválido.': 'Invalid report type.',
  'La calificación debe ser de 1 a 5 estrellas.': 'The rating must be 1 to 5 stars.',
  'El orden debe ser un número entero.': 'The order must be a whole number.',
  'La comisión debe ser un número.': 'The commission must be a number.',
  'La tasa debe ser un número.': 'The rate must be a number.',
  'Número de tarjeta inválido.': 'Invalid card number.',
  'CVC inválido.': 'Invalid CVC.',
  'Valor inválido.': 'Invalid value.',
  'Ajuste desconocido.': 'Unknown setting.',
  'El nombre del marketplace no es válido.': 'The marketplace name is not valid.',
  'Revisa las tarifas de envío: nombre con letras, montos numéricos (máx. 2 decimales) y días enteros (0 a 120).': 'Check the shipping rates: a name with letters, numeric amounts (max. 2 decimals) and whole days (0 to 120).',
  'Revisa los datos de transferencia bancaria.': 'Check the bank transfer details.',
  'El nombre del banco no es válido.': 'The bank name is not valid.',
  'El titular de la cuenta no es válido.': 'The account holder is not valid.',
  'Las instrucciones no son válidas.': 'The instructions are not valid.',
  'Selecciona una opción válida.': 'Select a valid option.',
  'Identificador inválido.': 'Invalid identifier.',
  'Debe ser un número entero.': 'Must be a whole number.',
  'Debe ser un número.': 'Must be a number.',
  'El valor es menor que el mínimo permitido.': 'The value is below the allowed minimum.',
  'El valor supera el máximo permitido.': 'The value exceeds the allowed maximum.',
  'Debe ser un texto.': 'Must be text.',
  'Agrega al menos un elemento.': 'Add at least one item.',
  'Hay demasiados elementos.': 'Too many items.',
  'El texto es demasiado corto.': 'The text is too short.',
  'El texto es demasiado largo.': 'The text is too long.',
  'La longitud del texto no es válida.': 'The text length is not valid.',
  'El formato no es válido.': 'The format is not valid.',
  'Campo no permitido.': 'Field not allowed.',
};

const NOUNS: Record<string, string> = {
  Archivo: 'File', 'Artículo del carrito': 'Cart item', Artículo: 'Item', Categoría: 'Category', Compra: 'Purchase', Conversación: 'Conversation',
  'Dirección de despacho': 'Ship-from address', Dirección: 'Address', Envío: 'Shipment', Imagen: 'Image', Impuesto: 'Tax rate',
  'Método de cobro': 'Payout method', Pago: 'Payment', Pedido: 'Order', Producto: 'Product', Reporte: 'Report', Retiro: 'Payout',
  Tienda: 'Store', Variante: 'Variant', Vendedor: 'Seller',
};

export function translateMessage(msg: string): string {
  if (EN[msg]) return EN[msg];
  let m = /^(.+) no encontrado\.$/.exec(msg);
  if (m) return `${NOUNS[m[1]] ?? m[1]} not found.`;
  m = /^Debe tener al menos (\d+) caracteres\.$/.exec(msg);
  if (m) return `Must be at least ${m[1]} characters.`;
  m = /^Admite máximo (\d+) caracteres\.$/.exec(msg);
  if (m) return `Allows up to ${m[1]} characters.`;
  m = /^El monto mínimo es ([\d.]+)\.$/.exec(msg);
  if (m) return `The minimum amount is ${m[1]}.`;
  m = /^El monto máximo es ([\d.]+)\.$/.exec(msg);
  if (m) return `The maximum amount is ${m[1]}.`;
  m = /^(El peso|El largo|El ancho|El alto|La medida) (debe ser un número|debe ser mayor que 0|supera el máximo permitido \((\d+)\))\.$/.exec(msg);
  if (m) {
    const what = ({ 'El peso': 'The weight', 'El largo': 'The length', 'El ancho': 'The width', 'El alto': 'The height', 'La medida': 'The measure' } as Record<string, string>)[m[1]];
    return m[2].startsWith('debe ser un') ? `${what} must be a number.` : m[2].startsWith('debe ser mayor') ? `${what} must be greater than 0.` : `${what} exceeds the maximum allowed (${m[3]}).`;
  }
  m = /^No se pudo subir la imagen: (.*)$/.exec(msg);
  if (m) return `The image could not be uploaded: ${m[1]}`;
  m = /^No se pudo crear la cuenta: (.*)$/.exec(msg);
  if (m) return `The account could not be created: ${m[1]}`;
  m = /^No se pudo completar el pago: (.*)$/.exec(msg);
  if (m) return `The payment could not be completed: ${m[1]}`;
  m = /^Shippo no pudo generar la etiqueta: (.*)$/.exec(msg);
  if (m) return `Shippo could not create the label: ${m[1]}`;
  return msg;
}

export function requestLocale(req: any): 'es' | 'en' {
  const h = (req?.headers?.['x-locale'] ?? '') as string;
  if (h === 'en' || h === 'es') return h;
  return /^en\b/i.test(String(req?.headers?.['accept-language'] ?? '')) ? 'en' : 'es';
}

/** Translates error messages to English when the client asked for English (x-locale / Accept-Language). */
@Catch(HttpException)
export class LocalizedExceptionFilter extends BaseExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest();
    if (requestLocale(req) === 'en') {
      const body: any = exception.getResponse();
      if (body && typeof body === 'object' && typeof body.message === 'string') {
        const translated = { ...body, message: translateMessage(body.message) };
        if (Array.isArray(body.details))
          translated.details = body.details.map((d: any) => (d && Array.isArray(d.errors) ? { ...d, errors: d.errors.map((e: string) => translateMessage(e)) } : d));
        const res = host.switchToHttp().getResponse();
        return res.status(exception.getStatus()).json(translated);
      }
    }
    return super.catch(exception, host);
  }
}
