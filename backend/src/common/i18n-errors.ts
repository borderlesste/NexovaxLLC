import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { FR, HT } from './i18n-fr-ht';

/** English versions of API error messages (keyed by the Spanish source text). */
const EN: Record<string, string> = {
  "La lista de destacados cambió. Recarga la página e inténtalo de nuevo.": "The featured list changed. Reload the page and try again.",
  "La fecha de entrada en vigor no es válida (como máximo un año).": "The effective date isn’t valid (up to one year ahead).",
  "Ya hay una versión programada para esta política. Cancélala antes de programar otra.": "There’s already a scheduled version of this policy. Cancel it before scheduling another.",
  "Esa versión ya no está programada.": "That version is no longer scheduled.",
  "La política de disputas no está configurada.": "The dispute policy isn’t configured.",
  "Elige quién paga.": "Choose who pays.",
  "En el reparto compartido, la parte de la tienda va de 1 % a 99 % (hasta 2 decimales).": "In a shared split, the store’s part goes from 1 % to 99 % (up to 2 decimals).",
  "No hay cambios respecto a la política vigente.": "There are no changes compared to the current policy.",
  "Esta disputa ya no espera respuesta de la tienda.": "This dispute no longer awaits the store’s answer.",
  "Explica lo ocurrido en 20 a 5000 caracteres.": "Explain what happened in 20 to 5000 characters.",
  "Indica el motivo (mínimo 5 caracteres).": "Give the reason (at least 5 characters).",
  "Adjunta como máximo 4 archivos.": "Attach up to 4 files.",
  "Solo se aceptan PDF, JPG o PNG.": "Only PDF, JPG or PNG are accepted.",
  "Cada archivo puede pesar hasta 4 MB.": "Each file can be up to 4 MB.",
  "Entre todos los archivos no pueden pasar de 4,5 MB.": "All files together can’t exceed 4.5 MB.",
  "PayPal no aceptó las pruebas.": "PayPal didn’t accept the evidence.",
  "Política no encontrada.": "Policy not found.",
  "El texto en español es obligatorio.": "The Spanish text is required.",
  "No hay cambios respecto a la versión vigente.": "There are no changes compared to the current version.",
  "Debes aceptar los términos y la política de privacidad.": "You must accept the terms and the privacy policy.",
  "Debes aceptar los términos para vendedores.": "You must accept the seller terms.",
  "Las políticas cambiaron. Vuelve a cargar la página y acéptalas de nuevo.": "The policies changed. Reload the page and accept them again.",
  "Activa «Producto destacado» en Configuración para destacar productos.": "Turn on “Featured product” in Settings to feature products.",
  "Solo se pueden destacar productos publicados.": "Only published products can be featured.",
  "Puedes destacar hasta 12 productos. Quita alguno antes de agregar otro.": "You can feature up to 12 products. Remove one before adding another.",
  "El reembolso del procesador no coincide con el pago.": "The processor refund doesn’t match the payment.",
  "Esta incidencia ya está resuelta.": "This incident is already resolved.",
  "Solo las disputas se pueden reintentar.": "Only disputes can be retried.",
  "La disputa sigue abierta con el procesador: se cerrará sola cuando haya resultado.": "The dispute is still open with the processor: it will close on its own once there’s an outcome.",
  "No se pudo contabilizar el resultado de la disputa. Revisa el detalle del error.": "The dispute outcome couldn’t be booked. Check the error details.",
  "Las disputas se resuelven con el procesador.": "Disputes are resolved with the processor.",
  "El reembolso no cubre todo el pedido: resuélvelo con la tienda (devolución o ajuste) y márcalo como revisado.": "The refund doesn’t cover the whole order: settle it with the store (return or adjustment) and mark it as reviewed.",
  "El pedido ya se envió o tiene devoluciones: no se puede registrar como cancelación. Resuélvelo con la tienda y márcalo como revisado.": "The order has already shipped or has returns: it can’t be recorded as a cancellation. Settle it with the store and mark it as reviewed.",
  "Las disputas se cierran solas cuando el procesador da el resultado.": "Disputes close on their own when the processor gives the outcome.",
  "Explica cómo se resolvió (mínimo 5 caracteres).": "Explain how it was resolved (at least 5 characters).",
  "PayPal rechazó el pago. Prueba con otro medio de pago.": "PayPal declined the payment. Try another payment method.",
  "El producto debe estar publicado para enviar una oferta.": "The product must be published to send an offer.",
  "Elige a quién enviar la oferta.": "Choose who to send the offer to.",
  "El mensaje admite hasta 280 caracteres y no puede incluir enlaces.": "The message allows up to 280 characters and can’t include links.",
  "Ya enviaste una oferta de este producto en los últimos 7 días. Podrás enviar otra después.": "You already sent an offer for this product in the last 7 days. You can send another one later.",
  "No hay personas a quienes enviar esta oferta en este momento.": "There’s no one to send this offer to right now.",
  "El cupón debe estar activo y aplicar a este producto.": "The coupon must be active and apply to this product.",
  "El descuento debe ser de 1 % a 90 % y durar de 1 a 30 días.": "The discount must be 1 % to 90 % and last 1 to 30 days.",
  "Elige un cupón o crea uno para esta oferta.": "Choose a coupon or create one for this offer.",
  "La variante no pertenece a este producto.": "The variant doesn’t belong to this product.",
  "Este producto ya está disponible: puedes comprarlo ahora.": "This product is already available: you can buy it now.",
  "No puedes pedir avisos de tus propios productos.": "You can’t request alerts for your own products.",
  "Ese código ya existe en el marketplace. Elige otro.": "That code already exists in the marketplace. Choose another one.",
  "El código debe tener de 3 a 24 caracteres: letras, números, guion o guion bajo.": "The code must have 3 to 24 characters: letters, numbers, hyphen or underscore.",
  "Elige el tipo de descuento.": "Choose the discount type.",
  "Indica el valor del descuento.": "Enter the discount value.",
  "El porcentaje debe estar entre 0,01 y 90.": "The percentage must be between 0.01 and 90.",
  "El monto fijo debe ser mayor que 0 y con máximo 2 decimales.": "The fixed amount must be greater than 0 with at most 2 decimals.",
  "La compra mínima no es válida.": "The minimum purchase isn’t valid.",
  "El descuento máximo debe ser mayor que 0.": "The maximum discount must be greater than 0.",
  "Las fechas no son válidas.": "The dates aren’t valid.",
  "La fecha de fin debe ser posterior a la de inicio.": "The end date must be after the start date.",
  "Los límites de uso deben ser números enteros mayores que 0.": "Usage limits must be whole numbers greater than 0.",
  "Selecciona como máximo 200 productos.": "Select at most 200 products.",
  "Algunos productos no pertenecen a tu tienda.": "Some products don’t belong to your store.",
  "La comisión debe estar entre 0,5 % y 50 %.": "The commission must be between 0.5 % and 50 %.",
  "La vigencia del enlace debe ser de 1 a 90 días.": "The link validity must be 1 to 90 days.",
  "No puedes ser afiliado de tu propia tienda.": "You can’t be an affiliate of your own store.",
  "Esta tienda no tiene un programa de afiliados activo.": "This store doesn’t have an active affiliate program.",
  "No se pudo generar tu enlace. Inténtalo de nuevo.": "Your link couldn’t be generated. Please try again.",
  "Indica el correo de tu cuenta PayPal.": "Enter your PayPal account email.",
  "Completa el titular, el banco, el número de cuenta y el país.": "Fill in the account holder, bank, account number and country.",
  "Elige cómo quieres cobrar.": "Choose how you want to get paid.",
  "Indica la referencia del pago realizado.": "Enter the reference of the payment made.",
  "Este afiliado no tiene comisiones disponibles para pagar.": "This affiliate has no commissions available to pay.",
  "El cupón no existe.": "The coupon doesn’t exist.",
  "El cupón no está activo.": "The coupon isn’t active.",
  "El cupón aún no está vigente.": "The coupon isn’t valid yet.",
  "El cupón venció.": "The coupon has expired.",
  "El cupón ya alcanzó su límite de usos.": "The coupon has reached its usage limit.",
  "Ya usaste este cupón el máximo de veces permitido.": "You’ve already used this coupon the maximum number of times.",
  "El cupón no es válido.": "The coupon isn’t valid.",
  "Solo puedes usar un cupón por tienda.": "You can only use one coupon per store.",
  "El cupón no aplica a los productos de tu carrito.": "The coupon doesn’t apply to the products in your cart.",
  "el cupón ya alcanzó su límite de usos.": "the coupon has reached its usage limit.",
  "ya usaste este cupón el máximo de veces permitido.": "you’ve already used this coupon the maximum number of times.",
  "el cupón no está vigente.": "the coupon isn’t valid.",
  "el cupón no se pudo aplicar.": "the coupon couldn’t be applied.",
  "Elige un motivo de la lista.": "Choose a reason from the list.",
  "Describe el motivo de la cancelación.": "Describe the reason for the cancellation.",
  "Esta solicitud ya fue resuelta.": "This request has already been resolved.",
  "Explica al cliente por qué no se puede cancelar.": "Explain to the customer why it can’t be cancelled.",
  "Esta solicitud ya no se puede retirar.": "This request can no longer be withdrawn.",
  "La cancelación aún no está aprobada.": "The cancellation hasn’t been approved yet.",
  "Ya hay una solicitud de cancelación pendiente para esta compra.": "There is already a pending cancellation request for this purchase.",
  "Esta compra ya fue cancelada.": "This purchase has already been cancelled.",
  "Esta compra ya no se puede cancelar: ya salió a envío, tiene etiqueta comprada, un reembolso o una devolución. Si ya la recibiste, pide una devolución.": "This purchase can no longer be cancelled: it has shipped, has a purchased label, a refund or a return. If you already received it, request a return.",
  "El cliente pidió cancelar esta compra: acepta o rechaza la solicitud antes de prepararla o enviarla.": "The customer asked to cancel this purchase: accept or reject the request before preparing or shipping it.",
  "Esta compra fue cancelada: no la prepares ni la envíes.": "This purchase was cancelled: don’t prepare or ship it.",
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
  'Solo el propietario de la tienda puede gestionar los métodos de cobro y los retiros.': 'Only the store owner can manage payout methods and withdrawals.',
  'Tu tienda no está activa: los retiros están en pausa. Contacta a soporte.': 'Your store isn’t active: withdrawals are paused. Contact support.',
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
  'Revisa los atributos del producto.': 'Check the product attributes.',
  'Un atributo no corresponde a la categoría seleccionada.': 'An attribute does not belong to the selected category.',
  'Solo los atributos de texto admiten lista de opciones.': 'Only text attributes support an option list.',
  'Cada opción necesita un nombre con letras o números.': 'Each option needs a name with letters or numbers.',
  'Hay opciones repetidas.': 'There are duplicate options.',
  'Una lista cerrada necesita al menos una opción.': 'A closed list needs at least one option.',
  'Hay productos con valores que no están en la lista. Agrégalos como opciones o usa una lista abierta.': 'Some products use values that are not in the list. Add them as options or use an open list.',
  'El código de la opción solo puede contener minúsculas, números y guiones bajos.': 'The option code can only contain lowercase letters, numbers and underscores.',
  'Selecciona un estado o provincia de la lista del país.': 'Select a state or province from the country’s list.',
  'La ciudad no pertenece al estado o provincia seleccionado.': 'The city doesn’t belong to the selected state or province.',
  'El teléfono debe tener 10 dígitos (código de área + número).': 'The phone number must have 10 digits (area code + number).',
  'El teléfono tiene demasiados dígitos para el país seleccionado.': 'The phone number has too many digits for the selected country.',
  'Búsqueda inválida.': 'Invalid search.',
  'Esta contraseña apareció en filtraciones de datos y es fácil de adivinar. Elige una diferente.': 'This password has appeared in data breaches and is easy to guess. Choose a different one.',
  'No pudimos verificar que eres una persona. Completa la verificación e inténtalo de nuevo.': 'We couldn’t verify that you’re a person. Complete the check and try again.',
  'La verificación de seguridad no está disponible. Inténtalo más tarde.': 'The security check isn’t available. Please try again later.',
  'Los envíos internacionales de más de US$ 2.500 desde EE. UU. requieren un número ITN de exportación (AES). Registra este envío con guía manual.': 'International shipments over US$ 2,500 from the US require an export ITN (AES). Record this shipment with a manual tracking number.',
};

const NOUNS: Record<string, string> = {
  Aviso: 'Alert', Archivo: 'File', 'Artículo del carrito': 'Cart item', Artículo: 'Item', Categoría: 'Category', Compra: 'Purchase', Conversación: 'Conversation',
  'Dirección de despacho': 'Ship-from address', Dirección: 'Address', Envío: 'Shipment', Imagen: 'Image', Impuesto: 'Tax rate',
  'Método de cobro': 'Payout method', Pago: 'Payment', Pedido: 'Order', Producto: 'Product', Reporte: 'Report', Retiro: 'Payout',
  Tienda: 'Store', Variante: 'Variant', Vendedor: 'Seller',
};

export type ApiLocale = 'es' | 'en' | 'fr' | 'ht';

/** Same sentence shapes as translateMessage, for French (fr) and Haitian Creole (ht). */
function translateFrHt(msg: string, l: 'fr' | 'ht'): string {
  const dict = l === 'fr' ? FR : HT;
  if (dict[msg]) return dict[msg];
  const fr = l === 'fr';
  const NOUN_FR: Record<string, string> = { Archivo: 'Fichier', Categoría: 'Catégorie', Conversación: 'Conversation', Cuenta: 'Compte', Dirección: 'Adresse', Envío: 'Envoi', Imagen: 'Image', Pago: 'Paiement', Pedido: 'Commande', Producto: 'Produit', Reporte: 'Signalement', Tienda: 'Boutique', Variante: 'Variante', Vendedor: 'Vendeur', Usuario: 'Utilisateur', Incidencia: 'Incident' };
  const NOUN_HT: Record<string, string> = { Archivo: 'Fichye', Categoría: 'Kategori', Conversación: 'Konvèsasyon', Cuenta: 'Kont', Dirección: 'Adrès', Envío: 'Livrezon', Imagen: 'Imaj', Pago: 'Peman', Pedido: 'Kòmand', Producto: 'Pwodwi', Reporte: 'Rapò', Tienda: 'Boutik', Variante: 'Varyant', Vendedor: 'Machann', Usuario: 'Itilizatè', Incidencia: 'Ensidan' };
  let m = /^(.+) no encontrado\.$/.exec(msg);
  if (m) return fr ? `${NOUN_FR[m[1]] ?? m[1]} introuvable.` : `Nou pa jwenn ${(NOUN_HT[m[1]] ?? m[1]).toLowerCase()} an.`;
  m = /^(.+): (debe ser un número|elige Sí o No|elige una opción de la lista|el valor no es válido|es obligatorio)\.$/.exec(msg);
  if (m) {
    const F: Record<string, [string, string]> = { 'debe ser un número': ['doit être un nombre', 'dwe yon nonb'], 'elige Sí o No': ['choisissez Oui ou Non', 'chwazi Wi oswa Non'], 'elige una opción de la lista': ['choisissez une option dans la liste', 'chwazi yon opsyon nan lis la'], 'el valor no es válido': ['la valeur n’est pas valable', 'valè a pa valab'], 'es obligatorio': ['est obligatoire', 'obligatwa'] };
    return `${m[1]} : ${F[m[2]][fr ? 0 : 1]}.`.replace(' :', fr ? ' :' : ':');
  }
  m = /^Debe tener al menos (\d+) caracteres\.$/.exec(msg);
  if (m) return fr ? `Doit contenir au moins ${m[1]} caractères.` : `Dwe gen omwen ${m[1]} karaktè.`;
  m = /^Admite máximo (\d+) caracteres\.$/.exec(msg);
  if (m) return fr ? `${m[1]} caractères maximum.` : `${m[1]} karaktè maksimòm.`;
  m = /^El monto mínimo es ([\d.]+)\.$/.exec(msg);
  if (m) return fr ? `Le montant minimum est ${m[1]}.` : `Montan minimòm lan se ${m[1]}.`;
  m = /^El monto máximo es ([\d.]+)\.$/.exec(msg);
  if (m) return fr ? `Le montant maximum est ${m[1]}.` : `Montan maksimòm lan se ${m[1]}.`;
  m = /^(El peso|El largo|El ancho|El alto|La medida) (debe ser un número|debe ser mayor que 0|supera el máximo permitido \((\d+)\))\.$/.exec(msg);
  if (m) {
    const W: Record<string, [string, string]> = { 'El peso': ['Le poids', 'Pwa a'], 'El largo': ['La longueur', 'Longè a'], 'El ancho': ['La largeur', 'Lajè a'], 'El alto': ['La hauteur', 'Wotè a'], 'La medida': ['La mesure', 'Mezi a'] };
    const what = W[m[1]][fr ? 0 : 1];
    if (m[2].startsWith('debe ser un')) return fr ? `${what} doit être un nombre.` : `${what} dwe yon nonb.`;
    if (m[2].startsWith('debe ser mayor')) return fr ? `${what} doit être supérieur(e) à 0.` : `${what} dwe pi gran pase 0.`;
    return fr ? `${what} dépasse le maximum autorisé (${m[3]}).` : `${what} depase maksimòm ki otorize a (${m[3]}).`;
  }
  m = /^Tu rol \((.+)\) no permite esta acción\. Requiere: (.+)\.$/.exec(msg);
  if (m) {
    const R: Record<string, [string, string]> = { Cliente: ['Client', 'Kliyan'], Vendedor: ['Vendeur', 'Machann'], Soporte: ['Support', 'Sipò'], Moderador: ['Modérateur', 'Moderatè'], Administrador: ['Administrateur', 'Administratè'], 'Super administrador': ['Super administrateur', 'Super administratè'] };
    const tr = (x: string) => x.split(/(, | o )/).map((p) => (p === ' o ' ? (fr ? ' ou ' : ' oswa ') : R[p]?.[fr ? 0 : 1] ?? p)).join('');
    return fr ? `Votre rôle (${tr(m[1])}) ne permet pas cette action. Requis : ${tr(m[2])}.` : `Wòl ou (${tr(m[1])}) pa pèmèt aksyon sa a. Li mande: ${tr(m[2])}.`;
  }
  m = /^El cupón requiere una compra mínima de ([\d.]+) en esa tienda\.$/.exec(msg);
  if (m) return fr ? `Le coupon exige un achat minimum de ${m[1]} dans cette boutique.` : `Koupon an mande yon acha minimòm ${m[1]} nan boutik sa a.`;
  m = /^([A-Z0-9][A-Z0-9_-]{2,23}): (.+)$/.exec(msg);
  if (m) return `${m[1]}: ${translateFrHt(m[2].charAt(0).toUpperCase() + m[2].slice(1), l)}`;
  const P: [RegExp, string, string][] = [
    [/^No se pudo subir la imagen: (.*)$/, 'L’image n’a pas pu être importée : ', 'Nou pa t ka monte imaj la: '],
    [/^No se pudo crear la cuenta: (.*)$/, 'Le compte n’a pas pu être créé : ', 'Nou pa t ka kreye kont lan: '],
    [/^No se pudo completar el pago: (.*)$/, 'Le paiement n’a pas pu être finalisé : ', 'Peman an pa t ka fini: '],
    [/^Shippo no pudo generar la etiqueta: (.*)$/, 'Shippo n’a pas pu créer l’étiquette : ', 'Shippo pa t ka kreye etikèt la: '],
  ];
  for (const [re, f, h] of P) {
    const x = re.exec(msg);
    if (x) return `${fr ? f : h}${x[1]}`;
  }
  return msg;
}

/** API message in the requested language (Spanish is the source). */
export function localizeMessage(msg: string, l: ApiLocale): string {
  if (l === 'en') return translateMessage(msg);
  if (l === 'fr' || l === 'ht') return translateFrHt(msg, l);
  return msg;
}

export function translateMessage(msg: string): string {
  if (EN[msg]) return EN[msg];
  const xm = /^Esas unidades suman ([\d.]+) y el procesador reembolsó ([\d.]+)\. Elige las unidades que cubren exactamente el reembolso\.$/.exec(msg);
  if (xm) return `Those units add up to ${xm[1]} and the processor refunded ${xm[2]}. Choose the units that cover the refund exactly.`;
  const dm = /^El procesador no aceptó la respuesta: (.*)$/.exec(msg);
  if (dm) return `The processor didn’t accept the answer: ${dm[1]}`;
  const pm = /^Revisa el texto en ([A-Z]{2}): título de 3 a 120 caracteres y texto de 30 a 20 000, sin etiquetas HTML\.$/.exec(msg);
  if (pm) return `Check the ${pm[1]} text: title of 3 to 120 characters and text of 30 to 20,000, no HTML tags.`;
  let m = /^(.+) no encontrado\.$/.exec(msg);
  if (m) return `${NOUNS[m[1]] ?? m[1]} not found.`;
  m = /^(.+): (debe ser un número|elige Sí o No|elige una opción de la lista|el valor no es válido|es obligatorio)\.$/.exec(msg);
  if (m) return `${m[1]}: ${({ 'debe ser un número': 'must be a number', 'elige Sí o No': 'choose Yes or No', 'elige una opción de la lista': 'choose an option from the list', 'el valor no es válido': 'the value is not valid', 'es obligatorio': 'is required' } as Record<string, string>)[m[2]]}.`;
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
  m = /^Tu rol \((.+)\) no permite esta acción\. Requiere: (.+)\.$/.exec(msg);
  if (m) {
    const R: Record<string, string> = { Cliente: 'Customer', Vendedor: 'Seller', Soporte: 'Support', Moderador: 'Moderator', Administrador: 'Administrator', 'Super administrador': 'Super administrator' };
    const tr = (x: string) => x.split(/(, | o )/).map((p) => (p === ' o ' ? ' or ' : R[p] ?? p)).join('');
    return `Your role (${tr(m[1])}) doesn’t allow this action. Requires: ${tr(m[2])}.`;
  }
  m = /^El cupón requiere una compra mínima de ([\d.]+) en esa tienda\.$/.exec(msg);
  if (m) return `The coupon requires a minimum purchase of ${m[1]} in that store.`;
  m = /^([A-Z0-9][A-Z0-9_-]{2,23}): (.+)$/.exec(msg);
  if (m) return `${m[1]}: ${translateMessage(m[2].charAt(0).toUpperCase() + m[2].slice(1))}`;
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

export function requestLocale(req: any): ApiLocale {
  const h = (req?.headers?.['x-locale'] ?? '') as string;
  if (h === 'en' || h === 'es' || h === 'fr' || h === 'ht') return h;
  const al = String(req?.headers?.['accept-language'] ?? '');
  return /^ht\b/i.test(al) ? 'ht' : /^fr\b/i.test(al) ? 'fr' : /^en\b/i.test(al) ? 'en' : 'es';
}

/** Translates error messages to English when the client asked for English (x-locale / Accept-Language). */
@Catch(HttpException)
export class LocalizedExceptionFilter extends BaseExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest();
    const l = requestLocale(req);
    if (l !== 'es') {
      const body: any = exception.getResponse();
      if (body && typeof body === 'object' && typeof body.message === 'string') {
        const translated = { ...body, message: localizeMessage(body.message, l) };
        if (Array.isArray(body.details))
          translated.details = body.details.map((d: any) => (d && Array.isArray(d.errors) ? { ...d, errors: d.errors.map((e: string) => localizeMessage(e, l)) } : d));
        const res = host.switchToHttp().getResponse();
        return res.status(exception.getStatus()).json(translated);
      }
    }
    return super.catch(exception, host);
  }
}
