import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { fromMinor, toMinor } from '../common/money';

/**
 * Settles the shipping the customer paid (SHIPPING_COLLECTED) against what the shipment
 * really cost, through the domain's shipping-scope model (one economic event per settlement):
 *
 *  LABEL  (platform bought a Shippo label)
 *    DEBIT  SHIPPING_COLLECTED                 customer shipping of the scope
 *    CREDIT SHIPPING_PAYABLE                   label cost owed to the label provider
 *    CREDIT PLATFORM_SHIPPING_REVENUE          customer paid more than the label cost
 *    DEBIT  PLATFORM_SHIPPING_SUBSIDY_EXPENSE  label cost above what the customer paid
 *
 *  MANUAL (the seller ships and pays the carrier)
 *    DEBIT  SHIPPING_COLLECTED                 customer shipping of the scope
 *    CREDIT SELLER_PENDING (seller)            reimbursed to the seller; released with the order funds
 *
 * Idempotent per shipment; never breaks the shipping operation (failures are logged and
 * retried by the hourly job).
 */
@Injectable()
export class ShippingSettlementService {
  private readonly logger = new Logger(ShippingSettlementService.name);
  constructor(private readonly db: DbService) {}

  async settle(shipmentId: string, actorUserId: string | null) {
    try {
      return await this.db.tx((c) => this.settleIn(c, shipmentId, actorUserId));
    } catch (e: any) {
      this.logger.warn(`shipping settlement ${shipmentId}: ${e?.message}`);
      return null;
    }
  }

  /** Shipments dispatched but not yet settled (retries after transient failures). */
  async settlePending(limit = 50) {
    const rows = await this.db.many(
      `select sh.id from public.shipments sh join public.order_shipping_groups g on g.id = sh.order_shipping_group_id
        where sh.status not in ('DRAFT','READY_TO_SHIP','CANCELLED') and g.customer_shipping_amount > 0
          and exists (select 1 from public.shipment_trackings t where t.shipment_id = sh.id)
          and not exists (select 1 from public.shipping_label_settlements s where s.shipment_id = sh.id)
          and not exists (select 1 from public.shipping_label_settlements s join public.shipments x on x.id = s.shipment_id where x.order_shipping_group_id = g.id)
        order by sh.created_at limit $1`,
      [limit],
    );
    let n = 0;
    for (const r of rows) if (await this.settle(r.id, null)) n++;
    return n;
  }

  private async settleIn(c: PoolClient, shipmentId: string, actor: string | null) {
    const sh = await this.db.one(
      `select sh.id, sh.order_id, sh.seller_id, sh.seller_order_id, sh.actual_carrier_code, sh.actual_carrier_name, sh.actual_service_name,
              g.id as group_id, g.customer_shipping_amount::text as charged, g.currency_code
         from public.shipments sh join public.order_shipping_groups g on g.id = sh.order_shipping_group_id
        where sh.id = $1 for update of g`,
      [shipmentId],
      c,
    );
    if (!sh) return null;
    const done = await this.db.one(`select id from public.shipping_label_settlements where shipment_id = $1`, [shipmentId], c);
    if (done) return done.id as string;
    const allocated = await this.db.one<{ a: string }>(
      `select coalesce(sum(st.customer_shipping_amount),0)::text as a from public.shipping_label_settlements st join public.shipments x on x.id = st.shipment_id
        where x.order_shipping_group_id = $1`,
      [sh.group_id],
      c,
    );
    const alloc = toMinor(sh.charged) - toMinor(allocated!.a);
    let label = await this.db.one(
      `select id, provider_transaction_id, actual_cost_amount::text as cost, currency_code, shipping_provider_code as provider from public.shipping_labels
        where shipment_id = $1 and status = 'PURCHASED' order by purchased_at desc limit 1`,
      [shipmentId],
      c,
    );
    const manual = !label;
    if (manual) {
      if (alloc <= 0n) return null; // free shipping / pickup: nothing to reimburse
      label = await this.db.one(
        `insert into public.shipping_labels (shipment_id, shipping_provider_code, status, idempotency_key, carrier_code, carrier_name, service_name,
                 actual_cost_amount, currency_code, correlation_id, provider_messages)
         values ($1,'SELLER_MANUAL','REQUESTED',$2,$3,$4,$5,$6,$7,$8,'{"settlement":"SELLER_ARRANGED_SHIPPING"}'::jsonb)
         returning id`,
        [shipmentId, `seller-manual:${shipmentId}`, sh.actual_carrier_code, sh.actual_carrier_name, sh.actual_service_name, fromMinor(alloc), sh.currency_code, randomUUID()],
        c,
      );
      await this.db.exec(
        `update public.shipping_labels set status = 'PURCHASED', provider_transaction_id = $2, provider_status = 'SELLER_ARRANGED', purchased_at = now() where id = $1`,
        [label!.id, `seller-manual:${shipmentId}`],
        c,
      );
      label = { id: label!.id, provider_transaction_id: `seller-manual:${shipmentId}`, cost: fromMinor(alloc), currency_code: sh.currency_code, provider: 'SELLER_MANUAL' };
    }
    if (label!.currency_code !== sh.currency_code) {
      this.logger.warn(`shipping settlement ${shipmentId}: label currency ${label!.currency_code} ≠ order ${sh.currency_code}; left for manual reconciliation`);
      return null;
    }
    const cost = toMinor(label!.cost ?? 0);
    const customer = alloc > 0n ? alloc : 0n;
    const revenue = manual ? 0n : customer > cost ? customer - cost : 0n;
    const support = manual ? 0n : cost > customer ? cost - customer : 0n;
    if (customer === 0n && cost === 0n) return null;
    const corr = randomUUID();
    const batch = await this.db.one(
      `insert into public.ledger_batches (batch_type, status, currency_code, source_type, source_id, idempotency_key, order_id, seller_order_id,
               actor_user_id, correlation_id, description, metadata)
       values ('SHIPPING_SETTLEMENT','DRAFT',$1,'SHIPPING_LABEL',$2,$3,$4,$5,$6,$7,$8,$9::jsonb) returning id`,
      [sh.currency_code, label!.id, `shipping-settlement:${shipmentId}`, sh.order_id, sh.seller_order_id, actor, corr,
       manual ? 'Envío despachado por el vendedor: se le reembolsa el envío cobrado' : 'Liquidación de etiqueta de envío',
       JSON.stringify({ economicScope: { completesScope: true }, mode: manual ? 'SELLER_ARRANGED' : 'PLATFORM_LABEL' })],
      c,
    );
    const line = async (code: string, side: 'DEBIT' | 'CREDIT', amount: bigint, key: string, owner: { seller?: string; external?: string } = {}) => {
      if (amount <= 0n) return;
      const acc = await this.db.one<{ id: string }>(`select public.get_or_create_ledger_account($1,$2,$3,null,$4) as id`, [code, sh.currency_code, owner.seller ?? null, owner.external ?? null], c);
      await this.db.exec(`select public.add_ledger_entry($1,$2,$3,$4,$5,null,null,$6,$7::jsonb)`,
        [batch!.id, acc!.id, side, fromMinor(amount), `shipping-settlement:${shipmentId}:${key}`, key, JSON.stringify({ shipmentId })], c);
    };
    await line('SHIPPING_COLLECTED', 'DEBIT', customer, 'collected');
    if (manual) await line('SELLER_PENDING', 'CREDIT', customer, 'seller', { seller: sh.seller_id });
    else {
      await line('SHIPPING_PAYABLE', 'CREDIT', cost, 'carrier', { external: label!.provider ?? 'SHIPPO' });
      await line('PLATFORM_SHIPPING_REVENUE', 'CREDIT', revenue, 'revenue');
      await line('PLATFORM_SHIPPING_SUBSIDY_EXPENSE', 'DEBIT', support, 'subsidy');
    }
    await this.db.exec(`select public.post_ledger_batch($1)`, [batch!.id], c);
    const st = await this.db.one(
      `insert into public.shipping_label_settlements (shipping_label_id, shipment_id, seller_id, seller_order_id, order_id, ledger_batch_id, provider_transaction_id,
               currency_code, customer_shipping_amount, actual_shipping_cost, shipping_delta, platform_revenue_amount, seller_charge_amount, platform_support_amount, settled_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,now()) returning id`,
      [label!.id, shipmentId, sh.seller_id, sh.seller_order_id, sh.order_id, batch!.id, label!.provider_transaction_id, sh.currency_code,
       fromMinor(customer), fromMinor(cost), fromMinor(customer - cost), fromMinor(revenue), fromMinor(support)],
      c,
    );
    await this.db.exec(`select public.record_shipping_settlement_scope_event($1, true)`, [st!.id], c);
    // Order funds already released (late settlement): the reimbursement goes straight to available.
    if (manual) {
      const released = await this.db.one(`select 1 from public.payout_eligibility_records where seller_order_id = $1 and status = 'RELEASED' limit 1`, [sh.seller_order_id], c);
      if (released)
        await this.db.exec(
          `select public.move_seller_funds($1,$2,'SELLER_PENDING','SELLER_AVAILABLE',$3,'SELLER_FUNDS_RELEASE_AVAILABLE',$4,$5,$6,$7,$8,'Envío reembolsado al vendedor tras la liberación del pedido.')`,
          [sh.seller_id, sh.currency_code, fromMinor(customer), `shipping-settlement:${shipmentId}:release`, sh.order_id, sh.seller_order_id, actor, corr],
          c,
        );
    }
    return st!.id as string;
  }
}
