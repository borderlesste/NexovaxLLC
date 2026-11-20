import { config } from '../config';

/** True once the marketplace takes real money: LIVE payment environment or a live Stripe key. */
export const paymentsLive = () => config.paymentEnvironment === 'LIVE' || !!config.stripeSecretKey?.startsWith('sk_live_');

/**
 * SQL condition: the order was not paid in the TEST environment (Stripe test mode, sandbox).
 * Once payments are live, TEST orders stay in the history but never count as sales and never
 * release money to a store. While the marketplace still runs in test mode every order counts.
 * `orderId` is a SQL expression for the order id (e.g. `o.id`, `so.order_id`).
 */
export function realOrder(orderId: string) {
  if (!paymentsLive()) return 'true';
  return `coalesce((select pe.environment from public.payments pe where pe.order_id = ${orderId} order by pe.created_at desc limit 1), 'LIVE') = 'LIVE'`;
}

/** SQL: pending store balance that comes from TEST orders (subtracted from the shown balance once payments are live). */
export function TEST_PENDING(sellerId: string) {
  if (!paymentsLive()) return '0';
  return `(select coalesce(sum(public.seller_order_pending_ledger_balance(x.id)),0) from public.seller_orders x
            where x.seller_id = ${sellerId} and not ${realOrder('x.order_id')})`;
}
