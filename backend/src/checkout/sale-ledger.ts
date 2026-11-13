import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';

/**
 * Posts the SALE allocation for a captured payment: moves the customer funds
 * held at capture into their economic destinations, per seller order:
 *   SOURCE       CUSTOMER_FUNDS_HELD            grand total
 *   DESTINATION  SELLER_PENDING (seller)        product net − platform commission  [SELLER_PRODUCT_ENTITLEMENT]
 *   DESTINATION  PLATFORM_COMMISSION_REVENUE    per applied commission rule         [PLATFORM_COMMISSION]
 *   DESTINATION  TAX_PAYABLE                    ITBIS                               [TAX]
 *   DESTINATION  SHIPPING_COLLECTED             customer shipping                    [SHIPPING]
 * Amounts come exclusively from the immutable order financial snapshots and
 * order applied rules. Idempotent per payment.
 */
export async function postSaleAllocation(db: DbService, c: PoolClient, paymentId: string, actorUserId: string | null, correlationId: string) {
  const pay = await db.one(
    `select p.id, p.order_id, p.currency_code, p.status, ofs.grand_total::text as total
       from public.payments p join public.order_financial_snapshots ofs on ofs.order_id = p.order_id
      where p.id = $1`,
    [paymentId],
    c,
  );
  if (!pay || !pay.order_id || pay.status !== 'PAID') return null;
  const existing = await db.one(
    `select id, status from public.financial_allocation_sets where payment_id = $1 and purpose_code = 'SALE' and status <> 'VOIDED'`,
    [paymentId],
    c,
  );
  if (existing?.status === 'POSTED') return existing.id;
  if (existing) await db.exec(`update public.financial_allocation_sets set status = 'VOIDED', voided_at = now() where id = $1 and status = 'DRAFT'`, [existing.id], c);

  const set = await db.one(
    `insert into public.financial_allocation_sets (purpose_code, currency_code, payment_id, order_id, expected_total, idempotency_key, correlation_id, metadata)
     values ('SALE', $1, $2, $3, $4, $5, $6, $7::jsonb) returning id`,
    [pay.currency_code, paymentId, pay.order_id, pay.total, `sale:${paymentId}:${existing ? Date.now() : 0}`, correlationId, JSON.stringify({ engine: 'rd-sale-1.0' })],
    c,
  );
  const add = (row: {
    direction: 'SOURCE' | 'DESTINATION';
    type: string;
    account: string;
    amount: string;
    sellerId?: string | null;
    sellerOrderId?: string | null;
    ruleVersionId?: string | null;
    orderAppliedRuleId?: string | null;
    funding?: string | null;
    memo: string;
  }) =>
    db.exec(
      `insert into public.financial_allocations (allocation_set_id, direction, allocation_type_code, ledger_account_definition_code, amount,
               owner_seller_id, seller_order_id, business_rule_version_id, order_applied_rule_id, funding_source_code, memo)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [set!.id, row.direction, row.type, row.account, row.amount, row.sellerId ?? null, row.sellerOrderId ?? null, row.ruleVersionId ?? null,
       row.orderAppliedRuleId ?? null, row.funding ?? null, row.memo],
      c,
    );

  await add({ direction: 'SOURCE', type: 'CUSTOMER_PAYMENT', account: 'CUSTOMER_FUNDS_HELD', amount: pay.total, memo: 'Fondos del cliente retenidos al capturar' });

  const sellerOrders = await db.many(
    `select so.id, so.seller_id, sofs.shipping_amount::text as shipping, sofs.tax_amount::text as tax,
            (select coalesce(sum(f.product_net_amount - f.platform_commission_amount), 0)::text
               from public.order_items oi join public.order_item_financial_snapshots f on f.order_item_id = oi.id
              where oi.seller_order_id = so.id) as entitlement
       from public.seller_orders so join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id
      where so.order_id = $1 order by so.created_at`,
    [pay.order_id],
    c,
  );
  for (const so of sellerOrders) {
    if (Number(so.entitlement) > 0)
      await add({ direction: 'DESTINATION', type: 'SELLER_PRODUCT_ENTITLEMENT', account: 'SELLER_PENDING', amount: so.entitlement, sellerId: so.seller_id, sellerOrderId: so.id, memo: 'Ingreso del vendedor por productos' });
    const rules = await db.many(
      `select id, business_rule_version_id, result_amount::text as amount, funding_source_code
         from public.order_applied_rules where seller_order_id = $1 and rule_type_code = 'PLATFORM_COMMISSION' and result_amount > 0`,
      [so.id],
      c,
    );
    for (const r of rules)
      await add({ direction: 'DESTINATION', type: 'PLATFORM_COMMISSION', account: 'PLATFORM_COMMISSION_REVENUE', amount: r.amount, sellerOrderId: so.id, ruleVersionId: r.business_rule_version_id, orderAppliedRuleId: r.id, funding: r.funding_source_code ?? 'SELLER', memo: 'Comisión de la plataforma' });
    if (Number(so.tax) > 0) await add({ direction: 'DESTINATION', type: 'TAX', account: 'TAX_PAYABLE', amount: so.tax, sellerOrderId: so.id, memo: 'ITBIS por pagar' });
    if (Number(so.shipping) > 0) await add({ direction: 'DESTINATION', type: 'SHIPPING', account: 'SHIPPING_COLLECTED', amount: so.shipping, sellerOrderId: so.id, memo: 'Envío cobrado al cliente' });
  }
  await db.exec(`select public.finalize_financial_allocation_set($1)`, [set!.id], c);
  await db.exec(`select public.post_financial_allocation_set($1, 'SALE', $2, $3, $4)`, [set!.id, `ledger:sale:${paymentId}`, actorUserId, correlationId], c);
  return set!.id;
}
