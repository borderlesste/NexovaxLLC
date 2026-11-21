import { conflict } from '../common/errors';

/**
 * How to refund a card/PayPal payment given the environment it was paid in and the provider key the API
 * runs with now.
 * - Same environment: refund at the provider.
 * - Paid in TEST, API now LIVE (orders from before launch): the charge doesn't exist for the live key and no
 *   real money was taken, so the refund is only booked in NEXOVAX.
 * - Paid in LIVE, API in TEST: real money can't be returned from here; refuse instead of marking it refunded.
 */
export function providerRefundMode(paymentEnvironment: string | null | undefined, providerEnvironment: 'TEST' | 'LIVE'): 'PROVIDER' | 'BOOK_ONLY' {
  const paid = paymentEnvironment === 'LIVE' ? 'LIVE' : 'TEST';
  if (paid === providerEnvironment) return 'PROVIDER';
  if (paid === 'TEST') return 'BOOK_ONLY';
  throw conflict('REFUND_ENVIRONMENT_MISMATCH', 'Este pago se hizo con dinero real y los pagos están en modo de prueba: no se puede reembolsar desde aquí.');
}

/** Provider reference recorded for a test payment refunded only in NEXOVAX. */
export const testRefundReference = (refundId: string) => ({ providerId: `test:${refundId}`, providerStatus: 'TEST_PAYMENT' });
