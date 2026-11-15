import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { AppError, badRequest, conflict, notFound } from '../common/errors';
import { forbiddenFor, isStaff, RequestUser } from '../auth/auth';
import { cancellationRef, orderRef, refundRef } from '../common/refs';
import { MailService } from '../mail/mail.service';
import { StripeService } from '../payments/stripe.service';
import { PaypalService } from '../payments/paypal.service';
import { ReturnPolicyService } from '../returns/return-policy.service';

export type CancelRole = 'CUSTOMER' | 'SELLER' | 'STAFF';

/** Reasons each party may give (OTHER always needs a note). */
export const CANCEL_REASONS: Record<CancelRole, string[]> = {
  CUSTOMER: ['CHANGED_MIND', 'ORDERED_BY_MISTAKE', 'FOUND_BETTER_PRICE', 'DELIVERY_TOO_SLOW', 'WRONG_ADDRESS', 'OTHER'],
  SELLER: ['OUT_OF_STOCK', 'CANNOT_SHIP_TO_ADDRESS', 'PRICING_ERROR', 'CUSTOMER_REQUEST', 'OTHER'],
  STAFF: ['CUSTOMER_REQUEST', 'FRAUD_SUSPECTED', 'SELLER_UNRESPONSIVE', 'OUT_OF_STOCK', 'OTHER'],
};

/**
 * Whether a seller order can still be cancelled: paid, nothing shipped, no label bought,
 * no refunds or returns yet. Shared by the order detail and every cancel action.
 */
export const CANCELLABLE_SQL = (so: string, o: string) => `(
  ${so}.lifecycle_status not in ('CANCELLED','CLOSED','COMPLETED')
  and ${o}.payment_status in ('PAID','PARTIALLY_REFUNDED')
  and not exists (select 1 from public.order_items x where x.seller_order_id = ${so}.id and (x.shipped_quantity > 0 or x.refunded_quantity > 0 or x.cancelled_quantity > 0))
  and not exists (select 1 from public.shipments x where x.seller_order_id = ${so}.id and x.status not in ('CANCELLED','NOT_READY','READY_TO_SHIP'))
  and not exists (select 1 from public.shipping_labels l join public.shipments x on x.id = l.shipment_id
                   where x.seller_order_id = ${so}.id and l.status in ('QUEUED','PURCHASED','VOID_REQUESTED'))
  and not exists (select 1 from public.return_requests x where x.seller_order_id = ${so}.id)
)`;

const OPEN = ['REQUESTED', 'APPROVED'];

/**
 * Cancellation of paid orders before they ship (per store / seller order):
 *  - customer: instant while the store hasn't prepared it; afterwards the store accepts or rejects;
 *  - seller and support: cancel directly (out of stock, fraud, …);
 *  - on approval the fulfillment is undone and stock returns; the order can no longer ship;
 *  - an admin issues the full refund (products, tax, shipping, fees) through the refund engine,
 *    reversing the commission and the seller's pending earnings. Admin approvals refund at once.
 */
@Injectable()
export class CancellationsService {
  private readonly logger = new Logger(CancellationsService.name);

  constructor(
    private readonly db: DbService,
    private readonly mail: MailService,
    private readonly stripe: StripeService,
    private readonly paypal: PaypalService,
    private readonly policies: ReturnPolicyService,
  ) {}

  // ------------------------------------------------------------------ open / decide
  /** Customer asks to cancel one store's part of an order. */
  async request(user: RequestUser, orderId: string, input: { sellerOrderId: string; reasonCode: string; note?: string }) {
    const so = await this.db.one(
      `select so.id, so.order_id, so.fulfillment_status, o.customer_id from public.seller_orders so join public.orders o on o.id = so.order_id
        where so.id = $1 and so.order_id = $2`,
      [input.sellerOrderId, orderId],
    );
    if (!so || so.customer_id !== user.id) throw notFound('Pedido');
    this.checkReason('CUSTOMER', input.reasonCode, input.note);
    // Not prepared yet: nothing to undo at the store, the cancellation is immediate.
    const instant = so.fulfillment_status === 'UNFULFILLED';
    const id = await this.open(user, so.id, 'CUSTOMER', input.reasonCode, input.note, instant);
    if (!instant) this.mail.fire(() => this.mail.orderCancellationEvent(id, 'REQUESTED'));
    return this.view(id, 'customer');
  }

  /** Seller cancels its own part (can't fulfil it). */
  async sellerCancel(user: RequestUser, sellerId: string, sellerOrderId: string, input: { reasonCode: string; note?: string }) {
    const so = await this.db.one(`select id, seller_id from public.seller_orders where id = $1`, [sellerOrderId]);
    if (!so || so.seller_id !== sellerId) throw notFound('Pedido');
    this.checkReason('SELLER', input.reasonCode, input.note);
    const id = await this.open(user, so.id, 'SELLER', input.reasonCode, input.note, true);
    return this.view(id, 'seller');
  }

  /** Support / admin cancel a store's part of an order. Admins refund it right away. */
  async staffCancel(user: RequestUser, sellerOrderId: string, input: { reasonCode: string; note?: string; manualReference?: string }) {
    this.checkReason('STAFF', input.reasonCode, input.note);
    const so = await this.db.one(`select id from public.seller_orders where id = $1`, [sellerOrderId]);
    if (!so) throw notFound('Pedido');
    const id = await this.open(user, so.id, 'STAFF', input.reasonCode, input.note, true);
    await this.autoRefund(user, id, input.manualReference);
    return this.view(id, 'staff');
  }

  /** Seller (own store) or staff accepts a customer's request. */
  async approve(user: RequestUser, id: string, as: { sellerId?: string; staff?: boolean }, input: { note?: string; manualReference?: string } = {}) {
    await this.db.tx(async (c) => {
      const row = await this.lockOwned(c, id, as);
      if (row.status !== 'REQUESTED') throw conflict('CANCELLATION_NOT_PENDING', 'Esta solicitud ya fue resuelta.');
      await this.db.exec(
        `update public.nx_order_cancellations set status = 'APPROVED', decided_by = $2, decided_at = now(), decision_note = $3, updated_at = now() where id = $1`,
        [id, user.id, input.note?.trim() || null],
        c,
      );
      await this.undoFulfillment(c, row.seller_order_id, user.id, id);
    });
    this.mail.fire(() => this.mail.orderCancellationEvent(id, 'APPROVED'));
    if (as.staff) await this.autoRefund(user, id, input.manualReference);
    return this.view(id, as.staff ? 'staff' : 'seller');
  }

  async reject(user: RequestUser, id: string, as: { sellerId?: string; staff?: boolean }, note: string) {
    if (!note?.trim()) throw badRequest('CANCELLATION_REASON_REQUIRED', 'Explica al cliente por qué no se puede cancelar.');
    await this.db.tx(async (c) => {
      const row = await this.lockOwned(c, id, as);
      if (row.status !== 'REQUESTED') throw conflict('CANCELLATION_NOT_PENDING', 'Esta solicitud ya fue resuelta.');
      await this.db.exec(
        `update public.nx_order_cancellations set status = 'REJECTED', decided_by = $2, decided_at = now(), decision_note = $3, updated_at = now() where id = $1`,
        [id, user.id, note.trim()],
        c,
      );
    });
    this.mail.fire(() => this.mail.orderCancellationEvent(id, 'REJECTED'));
    return this.view(id, as.staff ? 'staff' : 'seller');
  }

  /** The customer takes back a request the store hasn't answered. */
  async withdraw(user: RequestUser, id: string) {
    const r = await this.db.one(
      `update public.nx_order_cancellations set status = 'WITHDRAWN', updated_at = now() where id = $1 and customer_id = $2 and status = 'REQUESTED' returning id`,
      [id, user.id],
    );
    if (!r) throw conflict('CANCELLATION_NOT_PENDING', 'Esta solicitud ya no se puede retirar.');
    return this.view(id, 'customer');
  }

  // ------------------------------------------------------------------ refund (admin)
  async refund(user: RequestUser, id: string, input: { manualReference?: string; external?: { providerRefundId: string; providerStatus: string } } = {}) {
    if (!isStaff(user)) throw forbiddenFor(user, ['ADMIN']);
    const c = await this.db.one(`select * from public.nx_order_cancellations where id = $1`, [id]);
    if (!c) throw notFound('Pedido');
    if (c.status === 'REFUNDED') return this.view(id, 'staff');
    if (c.status !== 'APPROVED') throw conflict('CANCELLATION_NOT_APPROVED', 'La cancelación aún no está aprobada.');
    const pay = await this.db.one(
      `select p.id, p.provider_code, pc.external_charge_id
         from public.payments p left join lateral (select external_charge_id from public.payment_charges x where x.payment_id = p.id order by x.created_at desc limit 1) pc on true
        where p.order_id = $1 and p.status in ('PAID','PARTIALLY_REFUNDED') order by p.created_at desc limit 1`,
      [c.order_id],
    );
    if (!pay) throw conflict('PAYMENT_NOT_FOUND', 'No se encontró el pago original del pedido.');
    const policy = await this.policies.resolve(c.seller_id);
    const identity = `cancellation-refund:${id}`;
    const prior = await this.db.one(`select id, correlation_id from public.refunds where idempotency_key = $1`, [identity]);
    const corr: string = prior?.correlation_id ?? randomUUID();
    try {
      const refundId: string = await this.db.tx(async (tx) => {
        const rid = (await this.db.one(`select public.nx_create_cancellation_refund($1,$2,$3,$4,$5,$6) as id`, [id, pay.id, policy.versionId, user.id, identity, corr], tx))!.id;
        const st = (await this.db.one(`select status from public.refunds where id = $1`, [rid], tx))!.status;
        if (['REQUESTED', 'APPROVAL_REQUIRED', 'FAILED'].includes(st)) await this.db.exec(`select public.approve_refund($1,$2)`, [rid, user.id], tx);
        const st2 = (await this.db.one(`select status from public.refunds where id = $1`, [rid], tx))!.status;
        if (st2 === 'APPROVED') await this.db.exec(`select public.start_refund_processing($1)`, [rid], tx);
        return rid;
      });
      const r = await this.db.one(`select status, refund_amount::text as amount, currency_code from public.refunds where id = $1`, [refundId]);
      let providerId: string | null = null;
      let providerStatus: string | null = null;
      if (r!.status !== 'COMPLETED' && input.external) {
        // The money already went back from the provider's dashboard: record it, don't refund twice.
        providerId = input.external.providerRefundId;
        providerStatus = input.external.providerStatus;
      } else if (r!.status !== 'COMPLETED') {
        if (pay.provider_code === 'STRIPE') {
          if (!pay.external_charge_id) throw conflict('CHARGE_NOT_FOUND', 'No se encontró el cargo de la tarjeta.');
          const sr = await this.stripe.refund({ chargeOrIntent: pay.external_charge_id, amount: r!.amount, currency: r!.currency_code, refundId });
          if (sr.status === 'failed' || sr.status === 'canceled') throw new AppError('REFUND_PROVIDER_FAILED', 'Stripe rechazó el reembolso.', HttpStatus.BAD_GATEWAY, { status: sr.status });
          providerId = sr.id;
          providerStatus = sr.status ?? 'succeeded';
        } else if (pay.provider_code === 'PAYPAL') {
          if (!pay.external_charge_id) throw conflict('CHARGE_NOT_FOUND', 'No se encontró la captura de PayPal.');
          const pr = await this.paypal.refundCapture(pay.external_charge_id, r!.amount, r!.currency_code, refundId, `Cancelación ${cancellationRef(c.public_number)}`);
          if (!['COMPLETED', 'PENDING'].includes(pr?.status)) throw new AppError('REFUND_PROVIDER_FAILED', 'PayPal rechazó el reembolso.', HttpStatus.BAD_GATEWAY, { status: pr?.status });
          providerId = pr.id;
          providerStatus = pr.status;
        } else {
          const ref = input.manualReference?.trim();
          if (!ref) throw badRequest('REFUND_REFERENCE_REQUIRED', 'Este pedido se pagó por transferencia: indica la referencia de la devolución del dinero.');
          providerId = `manual:${ref}`;
          providerStatus = 'MANUAL';
        }
      }
      await this.db.tx(async (tx) => {
        if (r!.status !== 'COMPLETED') await this.db.exec(`select public.execute_referral_refund($1,$2,$3,$4,$5,null)`, [refundId, user.id, corr, providerId, providerStatus], tx);
        await this.db.exec(`select public.nx_finish_order_cancellation($1)`, [id], tx);
      });
    } catch (e: any) {
      await this.db.exec(`update public.nx_order_cancellations set last_error = $2, updated_at = now() where id = $1`, [id, String(e?.message ?? e).slice(0, 300)]).catch(() => undefined);
      throw e;
    }
    this.mail.fire(() => this.mail.orderCancellationEvent(id, 'REFUNDED'));
    return this.view(id, 'staff');
  }

  /**
   * A refund of the whole order made outside NEXOVAX (Stripe/PayPal dashboard), confirmed by an
   * admin: cancels every store's part that can still be cancelled and books the refunds with the
   * provider's reference, without calling the provider again. Returns false when it doesn't fit.
   */
  async cancelForExternalRefund(user: RequestUser, orderId: string, ext: { providerRefundId: string; providerStatus: string; label: string }) {
    const sos = await this.db.many(
      `select so.id, ${CANCELLABLE_SQL('so', 'o')} as ok from public.seller_orders so join public.orders o on o.id = so.order_id
        where so.order_id = $1 and so.lifecycle_status <> 'CANCELLED' order by so.created_at, so.id`,
      [orderId],
    );
    if (!sos.length || sos.some((x) => !x.ok)) return false;
    let n = 0;
    for (const so of sos) {
      const existing = await this.db.one(`select id, status from public.nx_order_cancellations where seller_order_id = $1 and status = any($2::text[])`, [so.id, OPEN]);
      let id: string;
      if (existing?.status === 'APPROVED') id = existing.id;
      else if (existing?.status === 'REQUESTED') {
        // The customer had asked to cancel: the external refund settles that request.
        id = existing.id;
        await this.db.tx(async (c) => {
          await this.lockOwned(c, id, { staff: true });
          await this.db.exec(`update public.nx_order_cancellations set status = 'APPROVED', decided_by = $2, decided_at = now(), decision_note = $3, updated_at = now() where id = $1`,
            [id, user.id, `Reembolso hecho desde ${ext.label}`], c);
          await this.undoFulfillment(c, so.id, user.id, id);
        });
      } else id = await this.open(user, so.id, 'STAFF', 'OTHER', `Reembolso hecho desde ${ext.label}`, true);
      n += 1;
      await this.refund(user, id, { external: { providerRefundId: n === 1 ? ext.providerRefundId : `${ext.providerRefundId}#${n}`, providerStatus: ext.providerStatus } });
    }
    return true;
  }

  // ------------------------------------------------------------------ reads
  /** Cancellations of an order (latest per seller order) for the order detail. */
  async forOrder(orderId: string, kind: 'customer' | 'seller' | 'staff') {
    const rows = await this.db.many(`select distinct on (seller_order_id) id from public.nx_order_cancellations where order_id = $1 order by seller_order_id, created_at desc`, [orderId]);
    const out: Record<string, any> = {};
    for (const r of rows) {
      const v = await this.view(r.id, kind);
      out[v.sellerOrderId] = v;
    }
    return out;
  }

  /** Admin queue: approved cancellations waiting for the refund. */
  async pending() {
    const rows = await this.db.many(
      `select c.id from public.nx_order_cancellations c where c.status = 'APPROVED' order by c.decided_at limit 100`,
    );
    return Promise.all(rows.map((r: any) => this.view(r.id, 'staff')));
  }

  async view(id: string, kind: 'customer' | 'seller' | 'staff') {
    const c = await this.db.one(
      `select c.*, o.public_number as order_number, o.currency_code, f.public_number as refund_number, f.refund_amount::text as refund_amount, f.status as refund_status,
              sofs.customer_total::text as total, coalesce(ssp.display_name, s.slug) as store
         from public.nx_order_cancellations c join public.orders o on o.id = c.order_id
         join public.sellers s on s.id = c.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         left join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = c.seller_order_id
         left join public.refunds f on f.id = c.refund_id
        where c.id = $1`,
      [id],
    );
    if (!c) throw notFound('Pedido');
    return {
      id: c.id,
      number: cancellationRef(c.public_number),
      orderId: c.order_id,
      orderNumber: orderRef(c.order_number),
      sellerOrderId: c.seller_order_id,
      store: c.store,
      status: c.status,
      requestedByRole: c.requested_by_role,
      reasonCode: c.reason_code,
      note: c.note,
      decisionNote: c.decision_note,
      createdAt: c.created_at,
      decidedAt: c.decided_at,
      refundedAt: c.refunded_at,
      amount: c.total,
      currency: c.currency_code,
      refund: c.refund_number && c.refund_status === 'COMPLETED' ? { number: refundRef(c.refund_number), amount: c.refund_amount } : null,
      lastError: kind === 'staff' ? c.last_error : undefined,
    };
  }

  // ------------------------------------------------------------------ helpers
  private checkReason(role: CancelRole, code: string, note?: string) {
    if (!CANCEL_REASONS[role].includes(code)) throw badRequest('CANCELLATION_REASON_INVALID', 'Elige un motivo de la lista.');
    if (code === 'OTHER' && !note?.trim()) throw badRequest('CANCELLATION_NOTE_REQUIRED', 'Describe el motivo de la cancelación.');
  }

  /** Creates the cancellation (and, when approved now, undoes the fulfillment) atomically. */
  private async open(user: RequestUser, sellerOrderId: string, role: CancelRole, reasonCode: string, note: string | undefined, approveNow: boolean) {
    const id: string = await this.db.tx(async (c) => {
      const so = await this.lockCancellable(c, sellerOrderId);
      const open = await this.db.one(`select status from public.nx_order_cancellations where seller_order_id = $1 and status = any($2::text[])`, [so.id, OPEN], c);
      if (open) throw conflict('CANCELLATION_ALREADY_OPEN', open.status === 'REQUESTED' ? 'Ya hay una solicitud de cancelación pendiente para esta compra.' : 'Esta compra ya fue cancelada.');
      const row = await this.db.one(
        `insert into public.nx_order_cancellations (order_id, seller_order_id, seller_id, customer_id, requested_by, requested_by_role, reason_code, note, status, decided_by, decided_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [so.order_id, so.id, so.seller_id, so.customer_id, user.id, role, reasonCode, note?.trim() || null,
         approveNow ? 'APPROVED' : 'REQUESTED', approveNow ? user.id : null, approveNow ? new Date() : null],
        c,
      );
      if (approveNow) await this.undoFulfillment(c, so.id, user.id, row!.id);
      return row!.id;
    });
    if (approveNow) this.mail.fire(() => this.mail.orderCancellationEvent(id, 'APPROVED'));
    return id;
  }

  private async lockCancellable(c: PoolClient, sellerOrderId: string) {
    const so = await this.db.one(
      `select so.id, so.order_id, so.seller_id, o.customer_id, ${CANCELLABLE_SQL('so', 'o')} as ok
         from public.seller_orders so join public.orders o on o.id = so.order_id where so.id = $1 for update of so`,
      [sellerOrderId],
      c,
    );
    if (!so) throw notFound('Pedido');
    if (!so.ok) throw conflict('ORDER_NOT_CANCELLABLE', 'Esta compra ya no se puede cancelar: ya salió a envío, tiene etiqueta comprada, un reembolso o una devolución. Si ya la recibiste, pide una devolución.');
    return so;
  }

  private async lockOwned(c: PoolClient, id: string, as: { sellerId?: string; staff?: boolean }) {
    const row = await this.db.one(`select * from public.nx_order_cancellations where id = $1 for update`, [id], c);
    if (!row || (!as.staff && row.seller_id !== as.sellerId)) throw notFound('Pedido');
    await this.lockCancellable(c, row.seller_order_id);
    return row;
  }

  /** Cancels prepared fulfillments (and their unshipped shipments) and puts the stock back. */
  private async undoFulfillment(c: PoolClient, sellerOrderId: string, actor: string, cancellationId: string) {
    const fs = await this.db.many(`select id from public.fulfillments where seller_order_id = $1 and status <> 'CANCELLED'`, [sellerOrderId], c);
    for (const f of fs) await this.db.exec(`select public.cancel_fulfillment($1)`, [f.id], c);
    const lines = await this.db.many(
      `select oi.variant_id, oi.seller_id, oi.quantity::int as qty, g.inventory_location_id as location
         from public.order_items oi
         left join public.order_shipping_group_items gi on gi.order_item_id = oi.id
         left join public.order_shipping_groups g on g.id = gi.order_shipping_group_id
        where oi.seller_order_id = $1`,
      [sellerOrderId],
      c,
    );
    const ref = await this.db.one(`select public_number from public.nx_order_cancellations where id = $1`, [cancellationId], c);
    for (const l of lines) {
      const item = await this.db.one(
        `select id, on_hand::int as on_hand from public.inventory_items where variant_id = $1 and seller_id = $2
          order by (location_id = $3) desc nulls last, on_hand desc, created_at limit 1 for update`,
        [l.variant_id, l.seller_id, l.location],
        c,
      );
      if (!item) continue;
      const adj = await this.db.one(
        `insert into public.inventory_adjustments (seller_id, adjustment_type, status, reason_code, reason_text, requested_by_user_id, approved_by_user_id, requested_at, approved_at, correlation_id)
         values ($1,'STOCK_IN','APPROVED','ORDER_CANCELLATION',$2,$3,$3,now(),now(),$4) returning id`,
        [l.seller_id, `Cancelación ${cancellationRef(ref!.public_number)}`, actor, randomUUID()],
        c,
      );
      await this.db.exec(
        `insert into public.inventory_adjustment_items (adjustment_id, inventory_item_id, seller_id, quantity_delta, expected_on_hand) values ($1,$2,$3,$4,$5)`,
        [adj!.id, item.id, l.seller_id, l.qty, item.on_hand],
        c,
      );
      await this.db.exec(`select public.apply_inventory_adjustment($1,$2,$3)`, [adj!.id, actor, randomUUID()], c);
    }
    await this.db.exec(`update public.nx_order_cancellations set restocked_at = now(), updated_at = now() where id = $1`, [cancellationId], c);
  }

  /** Admins refund immediately; for anyone else the refund waits in the admin queue. */
  private async autoRefund(user: RequestUser, id: string, manualReference?: string) {
    if (!isStaff(user)) return;
    try {
      await this.refund(user, id, { manualReference });
    } catch (e: any) {
      this.logger.warn(`Cancellation ${id}: refund deferred (${e?.message})`);
    }
  }
}
