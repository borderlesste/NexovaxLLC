import { realOrder } from './live-orders';

/**
 * One definition of "a sale" for every money figure in the seller and admin panels, so the
 * dashboards, finance pages and commission reports always reconcile:
 * - only orders whose payment was captured count (unpaid, failed, cancelled and fully refunded
 *   orders are left out);
 * - completed partial refunds are subtracted;
 * - the affiliate commission is funded by the store, so it is subtracted from what the store
 *   earns (and given back when a refund claws it back from the affiliate).
 * `o` is the orders alias and `so` the seller_orders alias.
 */
export function soldOrder(o = 'o') {
  return `${o}.payment_status in ('PAID','PARTIALLY_REFUNDED','DISPUTED') and ${o}.lifecycle_status not in ('PENDING_PAYMENT','CANCELLED') and ${realOrder(`${o}.id`)}`;
}

export function soldSellerOrder(so = 'so', o = 'o') {
  return `${soldOrder(o)} and ${so}.lifecycle_status <> 'CANCELLED'`;
}

/** Calendar window shared by the KPIs and the daily series (today plus the N-1 previous days). */
export function inWindow(col: string, daysParam: string) {
  return `${col} >= current_date - (${daysParam}::int - 1)`;
}

/** Same length window right before `inWindow` (for the "vs. previous period" change). */
export function inPreviousWindow(col: string, daysParam: string) {
  return `${col} >= current_date - (${daysParam}::int * 2 - 1) and ${col} < current_date - (${daysParam}::int - 1)`;
}

const REFUND_SUMS = `coalesce(sum(f.refund_amount),0) as total, coalesce(sum(f.platform_commission_reversal_amount),0) as commission,
                    coalesce(sum(f.seller_clawback_amount),0) as seller, coalesce(sum(f.referral_clawback_amount),0) as referral,
                    coalesce(sum(f.product_refund_amount),0) as products, coalesce(sum(f.tax_refund_amount),0) as tax,
                    coalesce(sum(f.shipping_refund_amount),0) as shipping`;

/** Completed refunds of one seller order, as `rf`. */
export function sellerOrderRefunds(so = 'so') {
  return `left join lateral (select ${REFUND_SUMS} from public.refunds f where f.seller_order_id = ${so}.id and f.status = 'COMPLETED') rf on true`;
}

/** Completed refunds of one order, as `rf`. */
export function orderRefunds(o = 'o') {
  return `left join lateral (select ${REFUND_SUMS} from public.refunds f where f.order_id = ${o}.id and f.status = 'COMPLETED') rf on true`;
}

/** What the store keeps from one seller order: products − platform commission − affiliate commission, net of refunds. */
export function sellerNetExpr(s = 'sofs', rf = 'rf') {
  return `(${s}.seller_entitlement_estimate - ${s}.referral_commission_total - ${rf}.seller + ${rf}.referral)`;
}

/** Same as `sellerNetExpr` on the order snapshot (all stores of the order). */
export function orderSellerNetExpr(s = 'ofs', rf = 'rf') {
  return `(${s}.seller_entitlement_estimate_total - ${s}.referral_commission_total - ${rf}.seller + ${rf}.referral)`;
}
