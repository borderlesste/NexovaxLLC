import { HttpException, HttpStatus } from '@nestjs/common';

/** Domain error carrying a stable machine code and a Spanish user message. */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ code, message, details, statusCode: status }, status);
  }
}

export const notFound = (what = 'Recurso') => new AppError('NOT_FOUND', `${what} no encontrado.`, HttpStatus.NOT_FOUND);
export const forbidden = (msg = 'No tienes permiso para realizar esta acción.') =>
  new AppError('FORBIDDEN', msg, HttpStatus.FORBIDDEN);
export const badRequest = (code: string, msg: string, details?: unknown) =>
  new AppError(code, msg, HttpStatus.BAD_REQUEST, details);
export const conflict = (code: string, msg: string) => new AppError(code, msg, HttpStatus.CONFLICT);

/** Spanish messages for the domain exception codes raised by PostgreSQL functions. */
const DOMAIN_MESSAGES: Record<string, [number, string]> = {
  CART_NOT_FOUND: [404, 'El carrito no existe.'],
  CART_NOT_MUTABLE: [409, 'El carrito está en proceso de pago y no puede modificarse.'],
  CART_EXPIRED: [409, 'El carrito expiró.'],
  CART_EMPTY: [409, 'Tu carrito está vacío.'],
  VARIANT_NOT_FOUND: [404, 'La variante del producto no existe.'],
  PRODUCT_NOT_PURCHASABLE: [409, 'Este producto no está disponible para la venta.'],
  PRICE_NOT_AVAILABLE_FOR_CURRENCY: [409, 'Este producto no tiene precio vigente.'],
  CHECKOUT_CONTAINS_NON_PURCHASABLE_ITEM: [409, 'Tu carrito contiene productos que ya no están disponibles.'],
  CHECKOUT_PRICE_UNAVAILABLE: [409, 'Uno de los productos no tiene precio vigente.'],
  CHECKOUT_EXPIRED: [409, 'La sesión de pago expiró. Vuelve a iniciar la compra.'],
  CHECKOUT_NOT_FOUND: [404, 'La sesión de pago no existe.'],
  CHECKOUT_INVENTORY_NOT_FULLY_RESERVED: [409, 'No hay suficiente inventario para completar la compra.'],
  CHECKOUT_SHIPPING_ADDRESS_REQUIRED: [409, 'Debes indicar una dirección de envío.'],
  CHECKOUT_SHIPPING_SELECTION_INCOMPLETE: [409, 'Debes elegir un método de envío para cada tienda.'],
  CHECKOUT_MUST_BE_READY_FOR_PAYMENT: [409, 'La compra no está lista para el pago.'],
  INSUFFICIENT_INVENTORY: [409, 'No hay suficiente inventario disponible.'],
  INVENTORY_INSUFFICIENT_AVAILABLE: [409, 'No hay suficiente inventario disponible.'],
  PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH: [409, 'El monto del pago no coincide con el pedido.'],
  INSUFFICIENT_AVAILABLE_BALANCE: [409, 'Saldo disponible insuficiente para el retiro.'],
  PAYOUT_BELOW_MINIMUM: [409, 'El monto es menor al mínimo permitido para retiros.'],
};

/** Converts PostgreSQL errors into API errors without leaking internals. */
export function translateDbError(e: any): Error {
  if (e instanceof HttpException) return e;
  const msg: string = e?.message ?? '';
  const code: string | undefined = e?.code;
  const firstToken = msg.split(/[:\s]/)[0];
  if (firstToken && /^[A-Z][A-Z0-9_]+$/.test(firstToken)) {
    const known = DOMAIN_MESSAGES[firstToken];
    if (known) return new AppError(firstToken, known[1], known[0]);
    const status =
      code === 'P0002' ? 404 : code === '42501' ? 403 : code === '22023' || code === '23514' ? 400 : 409;
    return new AppError(firstToken, humanize(firstToken), status);
  }
  if (code === '23505') return new AppError('DUPLICATE', 'Ya existe un registro con esos datos.', 409);
  if (code === '23503') return new AppError('REFERENCE_INVALID', 'Referencia inválida o en uso.', 409);
  if (code === '23514' || code === '22P02' || code === '22023')
    return new AppError('VALIDATION_FAILED', 'Los datos enviados no son válidos.', 400, { db: msg });
  if (code === '40001' || code === '40P01')
    return new AppError('CONCURRENT_UPDATE', 'Otra operación modificó los datos. Inténtalo de nuevo.', 409);
  if (code === '55P03') return new AppError('LOCKED', 'El recurso está ocupado. Inténtalo de nuevo.', 409);
  return e instanceof Error ? e : new Error(String(e));
}

function humanize(code: string) {
  return `No se pudo completar la operación (${code.toLowerCase().replace(/_/g, ' ')}).`;
}
