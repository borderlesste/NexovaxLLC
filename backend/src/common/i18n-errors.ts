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
