import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { AppError, badRequest, conflict, forbidden, notFound } from '../common/errors';
import { isStaff, RequestUser } from '../auth/auth';
import { orderRef, refundRef, returnRef } from '../common/refs';
import { mediaUrl } from '../catalog/catalog.sql';
import { money } from '../common/money';
import { SupabaseAdminService } from '../storage/supabase-admin.service';
import { MailService } from '../mail/mail.service';
import { StripeService } from '../payments/stripe.service';
import { PaypalService } from '../payments/paypal.service';
import { MAX_MESSAGE_FILES, UploadedFile } from '../messaging/messaging.service';
import { ResolvedPolicy, ReturnPolicyService, STORE_FAULT_REASONS } from './return-policy.service';
import { ShippingService, Parcel } from '../shipping/shipping.service';
import { fromMinor, toMinor } from '../common/money';

export const RETURN_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Solicitada',
  UNDER_REVIEW: 'En revisión',
  APPROVED: 'Aprobada',
  AWAITING_SHIPMENT: 'Esperando envío del cliente',
  IN_TRANSIT: 'En camino a la tienda',
  RECEIVED: 'Recibida por la tienda',
  INSPECTING: 'En inspección',
  REFUND_PENDING: 'Reembolso pendiente',
  CLOSED: 'Cerrada',
  REJECTED: 'Rechazada',
  CANCELLED: 'Cancelada',
};
const OPEN_STATES = ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'AWAITING_SHIPMENT', 'IN_TRANSIT', 'RECEIVED', 'INSPECTING', 'REFUND_PENDING'];
const CONDITIONS = ['NEW', 'OPENED', 'USED', 'DAMAGED'];

export interface CreateReturnInput {
  sellerOrderId: string;
  comment?: string;
  items: { orderItemId: string; quantity: number; reasonCode: string; comment?: string }[];
}

type Scope = { as: 'customer' } | { as: 'seller'; sellerId: string } | { as: 'staff' };

/**
 * Returns and refunds on top of the domain model:
 *  customer request (reasons + photos) → seller approves/rejects → customer ships it back
 *  → seller receives and inspects (accepted units, restock) → staff refunds through the
 *  original payment (Stripe / PayPal / manual) and the ledger plan is posted → closed.
 */
@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    private readonly db: DbService,
    private readonly storage: SupabaseAdminService,
    private readonly mail: MailService,
    private readonly stripe: StripeService,
    private readonly paypal: PaypalService,
    private readonly policies: ReturnPolicyService,
    private readonly shipping: ShippingService,
  ) {}

  // ------------------------------------------------------------------ policy & eligibility
  async reasons() {
    const rows = await this.db.many(
      `select code, label, description, requires_comment, requires_evidence, metadata->>'labelEn' as label_en
         from public.return_reason_definitions where seller_id is null and status = 'ACTIVE' and customer_selectable order by sort_order`,
    );
    return rows.map((r: any) => ({ code: r.code, label: r.label, labelEn: r.label_en, description: r.description, requiresComment: r.requires_comment, requiresEvidence: r.requires_evidence }));
  }

  /** What the customer can still return from an order, per store. */
  async eligibility(user: RequestUser, orderId: string) {
    const o = await this.db.one(`select id, public_number, currency_code from public.orders where id = $1 and customer_id = $2`, [orderId, user.id]);
    if (!o) throw notFound('Pedido');
    const groups = await this.db.many(
      `select so.id, so.public_number, so.seller_id, coalesce(ssp.display_name, s.slug) as store,
              (select max(sh.delivered_at) from public.shipments sh where sh.seller_order_id = so.id and sh.status <> 'CANCELLED') as delivered_at
         from public.seller_orders so join public.sellers s on s.id = so.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where so.order_id = $1 order by so.created_at`,
      [o.id],
    );
    const items = await this.db.many(
      `select oi.id, oi.seller_order_id, oi.quantity::int as quantity, oi.delivered_quantity::int as delivered, oi.returned_quantity::int as returned,
              coalesce((select sum(ri.requested_quantity) from public.return_items ri join public.return_requests rr on rr.id = ri.return_request_id
                         where ri.order_item_id = oi.id and rr.status = any($2::text[]))::int, 0) as open_qty,
              ois.product_title as title, ois.variant_title, oifs.unit_price::text as unit_price,
              (select pm.asset_id from public.product_media pm where pm.product_id = oi.product_id order by pm.is_primary desc, pm.sort_order limit 1) as image_id
         from public.order_items oi left join public.order_item_snapshots ois on ois.order_item_id = oi.id
         left join public.order_item_financial_snapshots oifs on oifs.order_item_id = oi.id
        where oi.order_id = $1 order by oi.created_at`,
      [o.id, OPEN_STATES],
    );
    const now = Date.now();
    const pols = new Map<string, ResolvedPolicy>();
    for (const g of groups) if (!pols.has(g.seller_id)) pols.set(g.seller_id, await this.policies.resolve(g.seller_id));
    const pol = pols.get(groups[0]?.seller_id) ?? (await this.policies.global());
    const view = (p: ResolvedPolicy) => ({ windowDays: p.windowDays, requireEvidence: p.requireEvidence, inspection: p.inspectionRequired, shippingRefund: p.shippingRefund,
      restockingFeePercent: p.restockingFeePercent, labelPayer: p.labelPayer, storePolicy: p.scope === 'SELLER' });
    return {
      orderId: o.id,
      orderNumber: orderRef(o.public_number),
      currency: o.currency_code,
      policy: view(pol),
      reasons: await this.reasons(),
      sellerOrders: groups.map((g: any) => {
        const gp = pols.get(g.seller_id)!;
        const deadline = g.delivered_at ? new Date(new Date(g.delivered_at).getTime() + gp.windowSeconds * 1000) : null;
        const open = !!deadline && deadline.getTime() > now;
        const its = items
          .filter((i: any) => i.seller_order_id === g.id)
          .map((i: any) => ({
            orderItemId: i.id, title: i.title, variantTitle: i.variant_title, unitPrice: i.unit_price, imageUrl: i.image_id ? mediaUrl(i.image_id) : null,
            quantity: i.quantity, delivered: i.delivered, returnable: Math.max(i.delivered - i.returned - i.open_qty, 0), inProgress: i.open_qty,
          }));
        return {
          sellerOrderId: g.id, number: `V-${g.public_number}`, store: g.store, deliveredAt: g.delivered_at, deadline, policy: view(gp),
          eligible: open && its.some((i) => i.returnable > 0),
          reason: !g.delivered_at ? 'NOT_DELIVERED' : !open ? 'WINDOW_EXPIRED' : its.some((i) => i.returnable > 0) ? null : 'NOTHING_LEFT',
          items: its,
        };
      }),
    };
  }

  // ------------------------------------------------------------------ customer
  async create(user: RequestUser, input: CreateReturnInput, files: UploadedFile[] = [], idempotencyKey?: string) {
    if (files.length > MAX_MESSAGE_FILES) throw badRequest('TOO_MANY_FILES', `Puedes adjuntar hasta ${MAX_MESSAGE_FILES} fotos.`);
    const so = await this.db.one(
      `select so.id, so.order_id, so.seller_id, o.customer_id from public.seller_orders so join public.orders o on o.id = so.order_id where so.id = $1`,
      [input.sellerOrderId],
    );
    if (!so || so.customer_id !== user.id) throw notFound('Pedido');
    const elig = await this.eligibility(user, so.order_id);
    const group = elig.sellerOrders.find((g) => g.sellerOrderId === so.id)!;
    if (group.reason === 'NOT_DELIVERED') throw conflict('RETURN_NOT_DELIVERED', 'Solo puedes devolver productos que ya recibiste.');
    if (group.reason === 'WINDOW_EXPIRED') throw conflict('RETURN_WINDOW_EXPIRED', `El plazo de devolución (${group.policy.windowDays} días desde la entrega) ya venció.`);
    const reasons = new Map(elig.reasons.map((r) => [r.code, r]));
    const wanted = input.items.filter((i) => i.quantity > 0);
    if (!wanted.length) throw badRequest('RETURN_ITEMS_REQUIRED', 'Selecciona al menos un producto y la cantidad a devolver.');
    const seen = new Set<string>();
    for (const w of wanted) {
      const it = group.items.find((i) => i.orderItemId === w.orderItemId);
      if (!it || seen.has(w.orderItemId)) throw badRequest('RETURN_ITEM_INVALID', 'Uno de los productos no pertenece a esta compra.');
      seen.add(w.orderItemId);
      if (!Number.isInteger(w.quantity) || w.quantity > it.returnable)
        throw badRequest('RETURN_QUANTITY_INVALID', `Solo puedes devolver ${it.returnable} unidad(es) de «${it.title}».`);
      const r = reasons.get(w.reasonCode);
      if (!r) throw badRequest('RETURN_REASON_REQUIRED', `Indica el motivo de la devolución de «${it.title}».`);
      if (r.requiresComment && !(w.comment?.trim() || input.comment?.trim()))
        throw badRequest('RETURN_COMMENT_REQUIRED', `Explica el motivo «${r.label}» en el comentario.`);
      if (r.requiresEvidence && !files.length) throw badRequest('RETURN_EVIDENCE_REQUIRED', `Adjunta al menos una foto para el motivo «${r.label}».`);
    }
    const pol = await this.policies.resolve(so.seller_id);
    if (pol.requireEvidence && !files.length) throw badRequest('RETURN_EVIDENCE_REQUIRED', 'La política de devoluciones de esta tienda pide al menos una foto del producto.');
    // Photos are stored first; they only become visible once linked to the request.
    const evidence: { id: string }[] = [];
    for (const f of files) {
      if (f.mimetype === 'application/pdf') throw badRequest('RETURN_EVIDENCE_IMAGE', 'Las evidencias de la devolución deben ser fotos (JPG, PNG o WebP).');
      evidence.push(await this.storage.uploadAttachment(user.id, f));
    }
    const corr = randomUUID();
    const id = await this.db.tx(async (c) => {
      const rid = (await this.db.one(
        `select public.create_return_request($1,$2,$3,$4,$5::jsonb,$6,'CUSTOMER',$7,$8) as id`,
        [so.order_id, so.id, user.id, pol.versionId, JSON.stringify({ windowDays: pol.windowDays, anchor: pol.anchor, inspection: pol.inspectionRequired, labelPayer: pol.labelPayer, shippingRefund: pol.shippingRefund, restockingFeePercent: pol.restockingFeePercent, scope: pol.scope, version: pol.versionId }),
         idempotencyKey || `return:${user.id}:${randomUUID()}`, input.comment?.trim() || null, corr],
        c,
      ))!.id;
      const existing = await this.db.one(`select 1 from public.return_items where return_request_id = $1 limit 1`, [rid], c);
      if (existing) return rid; // idempotent retry
      for (const w of wanted) {
        const reason = await this.db.one(`select id from public.return_reason_definitions where seller_id is null and code = $1`, [w.reasonCode], c);
        await this.db.exec(`select public.add_return_item($1,$2,$3,$4,$5,null,'{}'::jsonb)`, [rid, w.orderItemId, w.quantity, reason!.id, w.comment?.trim() || null], c);
      }
      let i = 0;
      for (const e of evidence) await this.db.exec(`insert into public.nx_return_request_evidence (return_request_id, asset_id, sort_order) values ($1,$2,$3)`, [rid, e.id, i++], c);
      return rid;
    });
    this.mail.fire(() => this.mail.returnEvent(id, 'REQUESTED'));
    return this.detail(user, id, { as: 'customer' });
  }

  async cancel(user: RequestUser, id: string) {
    await this.db.tx(async (c) => {
      const rr = await this.lock(c, id);
      if (rr.customer_id !== user.id) throw notFound('Devolución');
      if (!['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'AWAITING_SHIPMENT'].includes(rr.status))
        throw conflict('RETURN_NOT_CANCELLABLE', 'Esta devolución ya no se puede cancelar.');
      await this.db.exec(`update public.return_requests set status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2, version = version + 1 where id = $1`, [id, user.id], c);
      await this.summary(c, rr);
    });
    return this.detail(user, id, { as: 'customer' });
  }

  async markShipped(user: RequestUser, id: string, input: { carrier: string; trackingNumber?: string }) {
    await this.db.tx(async (c) => {
      const rr = await this.lock(c, id);
      if (rr.customer_id !== user.id) throw notFound('Devolución');
      if (!['APPROVED', 'AWAITING_SHIPMENT'].includes(rr.status)) throw conflict('RETURN_NOT_SHIPPABLE', 'Esta devolución no está esperando tu envío.');
      if (rr.status === 'APPROVED') await this.setStatus(c, id, 'AWAITING_SHIPMENT');
      await this.db.exec(
        `insert into public.nx_return_request_shipping (return_request_id, carrier, tracking_number, created_by) values ($1,$2,$3,$4)
         on conflict (return_request_id) do nothing`,
        [id, input.carrier.trim(), input.trackingNumber?.trim().toUpperCase() || null, user.id],
        c,
      );
      await this.setStatus(c, id, 'IN_TRANSIT');
    });
    this.mail.fire(() => this.mail.returnEvent(id, 'IN_TRANSIT'));
    return this.detail(user, id, { as: 'customer' });
  }

  // ------------------------------------------------------------------ seller / staff review
  private async authorize(c: PoolClient, user: RequestUser, id: string, scope: Scope) {
    const rr = await this.lock(c, id);
    if (scope.as === 'seller' && rr.seller_id !== scope.sellerId) throw notFound('Devolución');
    if (scope.as === 'staff' && !isStaff(user, 'SUPPORT')) throw forbidden();
    if (scope.as === 'customer') throw forbidden();
    return rr;
  }

  async approve(user: RequestUser, id: string, scope: Scope, input: { items?: { returnItemId: string; quantity: number }[]; comment?: string }) {
    await this.db.tx(async (c) => {
      const rr = await this.authorize(c, user, id, scope);
      if (!['REQUESTED', 'UNDER_REVIEW'].includes(rr.status)) throw conflict('RETURN_NOT_REVIEWABLE', 'Esta devolución ya fue revisada.');
      const items = await this.db.many(`select id, requested_quantity::int as qty from public.return_items where return_request_id = $1`, [id], c);
      const approvals = items.map((i: any) => {
        const sel = input.items?.find((x) => x.returnItemId === i.id);
        const q = sel ? sel.quantity : i.qty;
        if (!Number.isInteger(q) || q < 0 || q > i.qty) throw badRequest('RETURN_QUANTITY_INVALID', 'La cantidad aprobada no puede superar la solicitada.');
        return { return_item_id: i.id, approved_quantity: q };
      });
      if (!approvals.some((a) => a.approved_quantity > 0)) throw badRequest('RETURN_APPROVAL_EMPTY', 'Aprueba al menos una unidad o rechaza la devolución.');
      await this.db.exec(`select public.approve_return_request($1,$2,$3::jsonb,$4)`, [id, user.id, JSON.stringify(approvals), input.comment?.trim() || null], c);
      await this.setStatus(c, id, 'AWAITING_SHIPMENT');
      await this.summary(c, rr);
    });
    this.mail.fire(() => this.mail.returnEvent(id, 'APPROVED'));
    if (await this.labelPayer(id)) await this.ensureLabel(user, id).catch((e) => this.logger.warn(`return label ${id}: ${e?.message}`));
    return this.detail(user, id, scope);
  }

  async reject(user: RequestUser, id: string, scope: Scope, input: { reason: string }) {
    await this.db.tx(async (c) => {
      const rr = await this.authorize(c, user, id, scope);
      if (!['REQUESTED', 'UNDER_REVIEW'].includes(rr.status)) throw conflict('RETURN_NOT_REVIEWABLE', 'Esta devolución ya fue revisada.');
      await this.db.exec(`select public.reject_return_request($1,$2,'SELLER_REJECTED',$3)`, [id, user.id, input.reason.trim()], c);
      await this.summary(c, rr);
    });
    this.mail.fire(() => this.mail.returnEvent(id, 'REJECTED'));
    return this.detail(user, id, scope);
  }

  /** The package arrived at the store: every approved unit is received. */
  async receive(user: RequestUser, id: string, scope: Scope) {
    await this.db.tx(async (c) => {
      const rr = await this.authorize(c, user, id, scope);
      if (!['APPROVED', 'AWAITING_SHIPMENT', 'IN_TRANSIT'].includes(rr.status)) throw conflict('RETURN_NOT_RECEIVABLE', 'Esta devolución no está pendiente de recepción.');
      const items = await this.db.many(`select id, approved_quantity::int as qty from public.return_items where return_request_id = $1 and approved_quantity > 0`, [id], c);
      for (const i of items) await this.db.exec(`select public.record_return_item_receipt($1,$2)`, [i.id, i.qty], c);
      await this.summary(c, rr);
    });
    this.mail.fire(() => this.mail.returnEvent(id, 'RECEIVED'));
    const pinned = await this.pinnedPolicy(id);
    if (pinned && !pinned.inspectionRequired) {
      const recv = await this.db.many(`select id, received_quantity::int as q from public.return_items where return_request_id = $1 and received_quantity > 0`, [id]);
      return this.inspect(user, id, scope, { items: recv.map((r: any) => ({ returnItemId: r.id, accepted: r.q, restock: r.q, condition: 'OPENED' })), notes: 'Aceptada al recibir (la política no exige inspección).' });
    }
    return this.detail(user, id, scope);
  }

  /**
   * Inspection: accepted units are refunded; restocked units go back to inventory.
   * Leaves the return REFUND_PENDING for the finance team.
   */
  async inspect(user: RequestUser, id: string, scope: Scope, input: { items: { returnItemId: string; accepted: number; restock: number; condition: string }[]; notes?: string }) {
    await this.db.tx(async (c) => {
      const rr = await this.authorize(c, user, id, scope);
      if (!['RECEIVED', 'INSPECTING'].includes(rr.status)) throw conflict('RETURN_NOT_INSPECTABLE', 'Primero marca la devolución como recibida.');
      const items = await this.db.many(
        `select ri.id, ri.received_quantity::int as received, oi.variant_id, oi.seller_id from public.return_items ri join public.order_items oi on oi.id = ri.order_item_id
          where ri.return_request_id = $1 and ri.received_quantity > 0`,
        [id],
        c,
      );
      if (!items.length) throw conflict('RETURN_NOTHING_RECEIVED', 'No hay unidades recibidas para inspeccionar.');
      const insp = await this.db.one(
        `insert into public.return_inspections (return_request_id, status, inspected_by, started_at, notes) values ($1,'OPEN',$2,now(),$3) returning id`,
        [id, user.id, input.notes?.trim() || null],
        c,
      );
      const restocks: { variantId: string; sellerId: string; qty: number }[] = [];
      for (const i of items) {
        const sel = input.items.find((x) => x.returnItemId === i.id);
        if (!sel) throw badRequest('INSPECTION_INCOMPLETE', 'Indica el resultado de cada producto recibido.');
        if (!Number.isInteger(sel.accepted) || sel.accepted < 0 || sel.accepted > i.received) throw badRequest('INSPECTION_QUANTITY_INVALID', 'Las unidades aceptadas no pueden superar las recibidas.');
        if (!Number.isInteger(sel.restock) || sel.restock < 0 || sel.restock > sel.accepted) throw badRequest('INSPECTION_RESTOCK_INVALID', 'Solo puedes reponer al inventario unidades aceptadas.');
        if (!CONDITIONS.includes(sel.condition)) throw badRequest('INSPECTION_CONDITION_INVALID', 'Selecciona el estado del producto.');
        await this.db.exec(
          `insert into public.return_inspection_items (inspection_id, return_item_id, inspected_quantity, accepted_quantity, rejected_quantity, restock_quantity, condition_code, disposition_code)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [insp!.id, i.id, i.received, sel.accepted, i.received - sel.accepted, sel.restock, sel.condition, sel.restock > 0 ? 'RESTOCK' : sel.accepted > 0 ? 'NO_RESTOCK' : 'REJECTED'],
          c,
        );
        if (sel.restock > 0) restocks.push({ variantId: i.variant_id, sellerId: i.seller_id, qty: sel.restock });
      }
      await this.db.exec(`select public.complete_return_inspection($1,$2)`, [insp!.id, user.id], c);
      for (const r of restocks) await this.restock(c, user.id, r.sellerId, r.variantId, r.qty, rr.public_number);
    });
    this.mail.fire(() => this.mail.returnEvent(id, 'INSPECTED'));
    return this.detail(user, id, scope);
  }

  private async restock(c: PoolClient, actor: string, sellerId: string, variantId: string, qty: number, returnNumber: unknown) {
    const item = await this.db.one(
      `select id, on_hand::int as on_hand from public.inventory_items where variant_id = $1 and seller_id = $2 order by on_hand desc, created_at limit 1 for update`,
      [variantId, sellerId],
      c,
    );
    if (!item) return;
    const adj = await this.db.one(
      `insert into public.inventory_adjustments (seller_id, adjustment_type, status, reason_code, reason_text, requested_by_user_id, approved_by_user_id, requested_at, approved_at, correlation_id)
       values ($1,'RETURN_RESTOCK','APPROVED','RETURN_RESTOCK',$2,$3,$3,now(),now(),$4) returning id`,
      [sellerId, `Devolución ${returnRef(returnNumber)}`, actor, randomUUID()],
      c,
    );
    await this.db.exec(
      `insert into public.inventory_adjustment_items (adjustment_id, inventory_item_id, seller_id, quantity_delta, expected_on_hand) values ($1,$2,$3,$4,$5)`,
      [adj!.id, item.id, sellerId, qty, item.on_hand],
      c,
    );
    await this.db.exec(`select public.apply_inventory_adjustment($1,$2,$3)`, [adj!.id, actor, randomUUID()], c);
  }

  // ------------------------------------------------------------------ refund (finance staff)
  /**
   * Refunds the accepted units through the original payment. Steps are idempotent:
   * the refund row (same identity + correlation), the provider call (idempotency key =
   * refund id) and the ledger posting can all be retried after a failure.
   */
  async refund(user: RequestUser, id: string, input: { manualReference?: string } = {}) {
    if (!isStaff(user)) throw forbidden();
    const rr = await this.db.one(`select * from public.return_requests where id = $1`, [id]);
    if (!rr) throw notFound('Devolución');
    if (rr.status !== 'REFUND_PENDING') throw conflict('RETURN_NOT_REFUNDABLE', 'La devolución debe estar inspeccionada antes de reembolsar.');
    const selection = (
      await this.db.many(`select id, accepted_quantity::int as qty from public.return_items where return_request_id = $1 and accepted_quantity > 0`, [id])
    ).map((r: any) => ({ returnItemId: r.id, quantity: r.qty }));
    if (!selection.length) {
      await this.db.tx(async (c) => {
        await this.setStatus(c, id, 'CLOSED');
        await this.summary(c, rr);
      });
      this.mail.fire(() => this.mail.returnEvent(id, 'CLOSED_NO_REFUND'));
      return this.detail(user, id, { as: 'staff' });
    }
    const pay = await this.db.one(
      `select p.id, p.provider_code, p.status, pc.external_charge_id
         from public.payments p left join lateral (select external_charge_id from public.payment_charges x where x.payment_id = p.id order by x.created_at desc limit 1) pc on true
        where p.order_id = $1 and p.status in ('PAID','PARTIALLY_REFUNDED','REFUNDED') order by p.created_at desc limit 1`,
      [rr.order_id],
    );
    if (!pay) throw conflict('PAYMENT_NOT_FOUND', 'No se encontró el pago original del pedido.');
    const identity = `return-refund:${id}`;
    const prior = await this.db.one(`select id, status, correlation_id, requested_by from public.refunds where idempotency_key = $1`, [identity]);
    const corr: string = prior?.correlation_id ?? randomUUID();
    const actor: string = prior?.requested_by ?? user.id;
    const refundId: string = await this.db.tx(async (c) => {
      const rid = (await this.db.one(`select public.create_historical_return_refund($1,$2,$3::jsonb,$4,$5,$6) as id`, [id, pay.id, JSON.stringify(selection), actor, identity, corr], c))!.id;
      const st = (await this.db.one(`select status from public.refunds where id = $1`, [rid], c))!.status;
      if (['REQUESTED', 'APPROVAL_REQUIRED'].includes(st)) await this.db.exec(`select public.approve_refund($1,$2)`, [rid, user.id], c);
      const st2 = (await this.db.one(`select status from public.refunds where id = $1`, [rid], c))!.status;
      if (st2 === 'APPROVED') await this.db.exec(`select public.start_refund_processing($1)`, [rid], c);
      return rid;
    });
    const r = await this.db.one(`select status, refund_amount::text as amount, currency_code, provider_refund_id, public_number from public.refunds where id = $1`, [refundId]);
    if (r!.status === 'COMPLETED') return this.detail(user, id, { as: 'staff' });
    let providerId: string | null = null;
    let providerStatus: string | null = null;
    if (Number(r!.amount) > 0) {
      try {
        if (pay.provider_code === 'STRIPE') {
          if (!pay.external_charge_id) throw conflict('CHARGE_NOT_FOUND', 'No se encontró el cargo de la tarjeta.');
          const sr = await this.stripe.refund({ chargeOrIntent: pay.external_charge_id, amount: r!.amount, currency: r!.currency_code, refundId });
          if (sr.status === 'failed' || sr.status === 'canceled') throw new AppError('REFUND_PROVIDER_FAILED', 'Stripe rechazó el reembolso.', HttpStatus.BAD_GATEWAY, { status: sr.status });
          providerId = sr.id;
          providerStatus = sr.status ?? 'succeeded';
        } else if (pay.provider_code === 'PAYPAL') {
          if (!pay.external_charge_id) throw conflict('CHARGE_NOT_FOUND', 'No se encontró la captura de PayPal.');
          const pr = await this.paypal.refundCapture(pay.external_charge_id, r!.amount, r!.currency_code, refundId, `Reembolso de la devolución ${returnRef(rr.public_number)}`);
          if (!['COMPLETED', 'PENDING'].includes(pr?.status)) throw new AppError('REFUND_PROVIDER_FAILED', 'PayPal rechazó el reembolso.', HttpStatus.BAD_GATEWAY, { status: pr?.status });
          providerId = pr.id;
          providerStatus = pr.status;
        } else {
          // Bank transfer / sandbox: finance sends the money and records the reference.
          const ref = input.manualReference?.trim();
          if (!ref) throw badRequest('REFUND_REFERENCE_REQUIRED', 'Este pedido se pagó por transferencia: indica la referencia de la devolución del dinero.');
          providerId = `manual:${ref}`;
          providerStatus = 'MANUAL';
        }
      } catch (e: any) {
        await this.db.exec(`update public.refunds set metadata = metadata || jsonb_build_object('last_provider_error', $2::text) where id = $1`, [refundId, String(e?.message ?? e).slice(0, 300)]).catch(() => undefined);
        throw e;
      }
    }
    await this.db.tx(async (c) => {
      await this.db.exec(`select public.execute_referral_refund($1,$2,$3,$4,$5,null)`, [refundId, user.id, corr, providerId, providerStatus], c);
      const now = await this.db.one(`select status from public.return_requests where id = $1`, [id], c);
      if (now!.status === 'REFUND_PENDING') await this.setStatus(c, id, 'CLOSED');
      await this.summary(c, rr);
    });
    this.mail.fire(() => this.mail.returnEvent(id, 'REFUNDED'));
    return this.detail(user, id, { as: 'staff' });
  }

  // ------------------------------------------------------------------ reads
  async list(user: RequestUser, scope: Scope, q: { status?: string; page?: number } = {}) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (scope.as === 'customer') {
      params.push(user.id);
      where.push(`rr.customer_id = $${params.length}`);
    } else if (scope.as === 'seller') {
      params.push(scope.sellerId);
      where.push(`rr.seller_id = $${params.length}`);
    }
    if (q.status === 'OPEN') where.push(`rr.status = any(array['${OPEN_STATES.join("','")}'])`);
    else if (q.status === 'ACTION') where.push(scope.as === 'seller' ? `rr.status in ('REQUESTED','UNDER_REVIEW','IN_TRANSIT','AWAITING_SHIPMENT','RECEIVED','INSPECTING')` : `rr.status = 'REFUND_PENDING'`);
    else if (q.status && RETURN_STATUS_LABEL[q.status]) {
      params.push(q.status);
      where.push(`rr.status = $${params.length}`);
    }
    const page = Math.max(q.page ?? 1, 1);
    const rows = await this.db.many(
      `select rr.id, rr.public_number, rr.status, rr.requested_at, rr.updated_at, rr.currency_code, o.id as order_id, o.public_number as order_number,
              coalesce(ssp.display_name, s.slug) as store, coalesce(nullif(up.display_name,''), u.email::text) as customer,
              (select sum(ri.requested_quantity)::int from public.return_items ri where ri.return_request_id = rr.id) as units,
              (select string_agg(coalesce(ois.product_title,'Producto'), ', ') from public.return_items ri left join public.order_item_snapshots ois on ois.order_item_id = ri.order_item_id where ri.return_request_id = rr.id) as products,
              (select coalesce(sum(f.refund_amount),0)::text from public.refunds f where f.return_request_id = rr.id and f.status = 'COMPLETED') as refunded,
              count(*) over() as total
         from public.return_requests rr join public.orders o on o.id = rr.order_id
         join public.sellers s on s.id = rr.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         join public.users u on u.id = rr.customer_id left join public.user_profiles up on up.user_id = u.id
        ${where.length ? 'where ' + where.join(' and ') : ''}
        order by rr.requested_at desc limit 20 offset ${(page - 1) * 20}`,
      params,
    );
    const counts =
      scope.as === 'customer'
        ? undefined
        : await this.db.one(
            `select count(*) filter (where status in ('REQUESTED','UNDER_REVIEW'))::int as to_review,
                    count(*) filter (where status in ('AWAITING_SHIPMENT','IN_TRANSIT'))::int as in_transit,
                    count(*) filter (where status in ('RECEIVED','INSPECTING'))::int as to_inspect,
                    count(*) filter (where status = 'REFUND_PENDING')::int as refund_pending,
                    count(*) filter (where status = 'CLOSED')::int as closed
               from public.return_requests ${scope.as === 'seller' ? 'where seller_id = $1' : ''}`,
            scope.as === 'seller' ? [scope.sellerId] : [],
          );
    return {
      items: rows.map((r: any) => ({
        id: r.id, number: returnRef(r.public_number), status: r.status, statusLabel: RETURN_STATUS_LABEL[r.status], requestedAt: r.requested_at, updatedAt: r.updated_at,
        orderId: r.order_id, orderNumber: orderRef(r.order_number), store: r.store, customer: scope.as === 'customer' ? undefined : r.customer,
        units: r.units, products: r.products, refunded: money(r.refunded), currency: r.currency_code,
      })),
      total: rows[0] ? Number(rows[0].total) : 0,
      counts,
      page,
    };
  }

  async detail(user: RequestUser, id: string, scope: Scope) {
    const rr = await this.db.one(
      `select rr.*, o.public_number as order_number, coalesce(ssp.display_name, s.slug) as store, s.slug as store_slug,
              coalesce(nullif(up.display_name,''), u.email::text) as customer, u.email::text as customer_email,
              sh.carrier as return_carrier, sh.tracking_number as return_tracking, sh.shipped_at as return_shipped_at,
              sfa.line1 as ret_line1, sfa.line2 as ret_line2, sfa.city as ret_city, sfa.region as ret_region, sfa.postal_code as ret_postal, sfa.country_code as ret_country,
              sfa.contact_name as ret_contact, sfa.phone as ret_phone
         from public.return_requests rr join public.orders o on o.id = rr.order_id
         join public.sellers s on s.id = rr.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         join public.users u on u.id = rr.customer_id left join public.user_profiles up on up.user_id = u.id
         left join public.nx_return_request_shipping sh on sh.return_request_id = rr.id
         left join lateral (select a.* from public.seller_ship_from_addresses a where a.seller_id = rr.seller_id and a.archived_at is null order by a.is_default desc nulls last, a.created_at limit 1) sfa on true
        where rr.id = $1`,
      [id],
    );
    if (!rr) throw notFound('Devolución');
    if (scope.as === 'customer' && rr.customer_id !== user.id) throw notFound('Devolución');
    if (scope.as === 'seller' && rr.seller_id !== scope.sellerId) throw notFound('Devolución');
    if (scope.as === 'staff' && !isStaff(user, 'SUPPORT')) throw forbidden();
    const [items, evidence, history, refunds] = await Promise.all([
      this.db.many(
        `select ri.id, ri.order_item_id, ri.requested_quantity::int as requested, ri.approved_quantity::int as approved, ri.received_quantity::int as received,
                ri.accepted_quantity::int as accepted, ri.rejected_quantity::int as rejected, ri.restock_quantity::int as restock, ri.final_condition, ri.reason_comment,
                rd.code as reason_code, rd.label as reason_label, rd.metadata->>'labelEn' as reason_label_en,
                ois.product_title as title, ois.variant_title, ois.sku, oifs.unit_price::text as unit_price,
                (select pm.asset_id from public.product_media pm join public.order_items oi on oi.id = ri.order_item_id where pm.product_id = oi.product_id order by pm.is_primary desc, pm.sort_order limit 1) as image_id
           from public.return_items ri left join public.return_reason_definitions rd on rd.id = ri.reason_definition_id
           left join public.order_item_snapshots ois on ois.order_item_id = ri.order_item_id
           left join public.order_item_financial_snapshots oifs on oifs.order_item_id = ri.order_item_id
          where ri.return_request_id = $1 order by ri.created_at`,
        [id],
      ),
      this.db.many(
        `select a.id, coalesce(a.original_filename,'foto') as name, a.width_pixels as width, a.height_pixels as height
           from public.nx_return_request_evidence e join public.assets a on a.id = e.asset_id where e.return_request_id = $1 and a.status = 'READY' order by e.sort_order`,
        [id],
      ),
      this.db.many(
        `select h.from_status, h.to_status, h.changed_at from public.return_request_status_history h where h.return_request_id = $1 order by h.changed_at`,
        [id],
      ),
      this.db.many(
        `select id, public_number, status, refund_amount::text as amount, product_refund_amount::text as product, tax_refund_amount::text as tax,
                shipping_refund_amount::text as shipping, provider_code, provider_refund_id, completed_at, created_at, metadata->>'last_provider_error' as error
           from public.refunds where return_request_id = $1 order by created_at`,
        [id],
      ),
    ]);
    const pol = await this.pinnedPolicy(id);
    const label = await this.db.one(`select * from public.nx_return_labels where return_request_id = $1`, [id]);
    const payer = label ? label.payer : await this.labelPayer(id);
    const can = {
      cancel: scope.as === 'customer' && ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'AWAITING_SHIPMENT'].includes(rr.status),
      ship: scope.as === 'customer' && ['APPROVED', 'AWAITING_SHIPMENT'].includes(rr.status),
      review: scope.as !== 'customer' && ['REQUESTED', 'UNDER_REVIEW'].includes(rr.status),
      receive: scope.as !== 'customer' && ['APPROVED', 'AWAITING_SHIPMENT', 'IN_TRANSIT'].includes(rr.status),
      inspect: scope.as !== 'customer' && ['RECEIVED', 'INSPECTING'].includes(rr.status),
      // Refunds move money: admins only (support approves, receives and inspects).
      refund: scope.as === 'staff' && isStaff(user) && rr.status === 'REFUND_PENDING',
      buyLabel: scope.as !== 'customer' && !label && !!payer && ['APPROVED', 'AWAITING_SHIPMENT'].includes(rr.status) && this.shipping.shippoEnabled,
    };
    return {
      id: rr.id,
      number: returnRef(rr.public_number),
      status: rr.status,
      statusLabel: RETURN_STATUS_LABEL[rr.status],
      currency: rr.currency_code,
      orderId: rr.order_id,
      orderNumber: orderRef(rr.order_number),
      sellerOrderId: rr.seller_order_id,
      store: { name: rr.store, slug: rr.store_slug },
      customer: scope.as === 'customer' ? undefined : { name: rr.customer, email: rr.customer_email },
      comment: rr.customer_comment,
      sellerComment: rr.seller_comment,
      rejection: rr.rejection_detail,
      requestedAt: rr.requested_at,
      approvedAt: rr.approved_at,
      receivedAt: rr.received_at,
      inspectedAt: rr.inspection_completed_at,
      closedAt: rr.closed_at,
      windowDays: pol?.windowDays ?? null,
      policy: pol ? { windowDays: pol.windowDays, labelPayer: pol.labelPayer, shippingRefund: pol.shippingRefund, restockingFeePercent: pol.restockingFeePercent, inspection: pol.inspectionRequired, storePolicy: pol.scope === 'SELLER' } : null,
      noReturn: rr.internal_note === 'NO_RETURN_REFUND',
      labelPayer: payer,
      returnLabel: label
        ? { carrier: label.carrier, service: label.service, trackingNumber: label.tracking_number, trackingUrl: label.tracking_url, url: label.label_url, payer: label.payer, test: label.test_mode,
            cost: scope.as === 'customer' ? undefined : String(label.cost_amount), createdAt: label.created_at }
        : null,
      returnShipment: rr.return_carrier ? { carrier: rr.return_carrier, trackingNumber: rr.return_tracking, shippedAt: rr.return_shipped_at } : null,
      returnAddress:
        ['APPROVED', 'AWAITING_SHIPMENT', 'IN_TRANSIT'].includes(rr.status) && rr.ret_line1
          ? { name: rr.ret_contact ?? rr.store, line1: rr.ret_line1, line2: rr.ret_line2, city: rr.ret_city, region: rr.ret_region, postalCode: rr.ret_postal, countryCode: rr.ret_country, phone: rr.ret_phone }
          : null,
      items: items.map((i: any) => ({
        id: i.id, orderItemId: i.order_item_id, title: i.title, variantTitle: i.variant_title, sku: i.sku, unitPrice: i.unit_price,
        imageUrl: i.image_id ? mediaUrl(i.image_id) : null,
        requested: i.requested, approved: i.approved, received: i.received, accepted: i.accepted, rejected: i.rejected, restock: i.restock, condition: i.final_condition,
        reason: { code: i.reason_code, label: i.reason_label, labelEn: i.reason_label_en }, comment: i.reason_comment,
      })),
      evidence: evidence.map((e: any) => ({ id: e.id, name: e.name, width: e.width, height: e.height })),
      history: history.map((h: any) => ({ from: h.from_status, to: h.to_status, toLabel: RETURN_STATUS_LABEL[h.to_status], at: h.changed_at })),
      refunds: refunds.map((f: any) => ({
        id: f.id, number: refundRef(f.public_number), status: f.status, amount: money(f.amount), product: money(f.product), tax: money(f.tax), shipping: money(f.shipping),
        provider: f.provider_code, providerRefundId: scope.as === 'staff' ? f.provider_refund_id : undefined, completedAt: f.completed_at, error: scope.as === 'staff' ? f.error : undefined,
      })),
      can,
    };
  }

  /** Evidence photo for the customer, the store or staff. */
  async evidenceFile(user: RequestUser, id: string, assetId: string) {
    const rr = await this.db.one(`select customer_id, seller_id from public.return_requests where id = $1`, [id]);
    if (!rr) throw notFound('Devolución');
    const allowed = rr.customer_id === user.id || user.sellers.some((s) => s.id === rr.seller_id) || isStaff(user, 'SUPPORT', 'MODERATOR');
    if (!allowed) throw notFound('Devolución');
    const a = await this.db.one(
      `select a.storage_bucket, a.storage_key, a.mime_type, coalesce(a.original_filename,'foto') as name
         from public.nx_return_request_evidence e join public.assets a on a.id = e.asset_id where e.return_request_id = $1 and e.asset_id = $2 and a.status = 'READY'`,
      [id, assetId],
    );
    if (!a) throw notFound('Archivo');
    return { buffer: await this.storage.download(a.storage_bucket, a.storage_key), mime: a.mime_type as string, name: a.name as string };
  }

  // ------------------------------------------------------------------ prepaid return label
  private async pinnedPolicy(id: string) {
    const r = await this.db.one(`select policy_rule_version_id as v from public.return_requests where id = $1`, [id]);
    return r?.v ? this.policies.forVersion(r.v) : null;
  }

  /** Who pays a prepaid label for this return (null = the customer arranges the shipment). */
  private async labelPayer(id: string): Promise<'STORE' | 'MARKETPLACE' | null> {
    const rr = await this.db.one(`select internal_note from public.return_requests where id = $1`, [id]);
    if (rr?.internal_note === 'NO_RETURN_REFUND') return null;
    const pol = await this.pinnedPolicy(id);
    if (!pol) return null;
    if (pol.labelPayer === 'STORE' || pol.labelPayer === 'MARKETPLACE') return pol.labelPayer;
    if (pol.labelPayer === 'BY_REASON') {
      const fault = await this.db.one(
        `select 1 from public.return_items ri join public.return_reason_definitions rd on rd.id = ri.reason_definition_id
          where ri.return_request_id = $1 and rd.code = any($2::text[]) limit 1`,
        [id, STORE_FAULT_REASONS],
      );
      return fault ? 'STORE' : null;
    }
    return null;
  }

  async buyLabel(user: RequestUser, id: string, scope: Scope) {
    await this.db.tx((c) => this.authorize(c, user, id, scope));
    await this.ensureLabel(user, id);
    return this.detail(user, id, scope);
  }

  /**
   * Buys the prepaid label (customer → store) and books its cost: the platform pays the carrier
   * (RETURN_SHIPPING_EXPENSE / SHIPPING_PAYABLE) and, when the store pays, recovers it from the
   * store's available balance (or as a receivable when the balance is not enough).
   */
  private async ensureLabel(user: RequestUser, id: string) {
    const existing = await this.db.one(`select 1 from public.nx_return_labels where return_request_id = $1`, [id]);
    if (existing) return;
    const payer = await this.labelPayer(id);
    if (!payer) throw conflict('RETURN_LABEL_NOT_APPLICABLE', 'Según la política, el cliente envía esta devolución por su cuenta.');
    const rr = await this.db.one(`select * from public.return_requests where id = $1`, [id]);
    if (!['APPROVED', 'AWAITING_SHIPMENT'].includes(rr!.status)) throw conflict('RETURN_NOT_SHIPPABLE', 'La devolución no está esperando el envío del cliente.');
    const sh = await this.db.one(
      `select sh.id from public.shipments sh where sh.seller_order_id = $1 and sh.status <> 'CANCELLED' order by sh.created_at desc limit 1`,
      [rr!.seller_order_id],
    );
    if (!sh) throw conflict('RETURN_ORIGINAL_SHIPMENT_MISSING', 'No se encontró el envío original del pedido.');
    const [customerAddr, storeAddr, pkg, items, emails] = await Promise.all([
      this.db.one(`select * from public.shipment_address_snapshots where shipment_id = $1 and address_type = 'TO'`, [sh.id]),
      this.db.one(
        `select a.*, a.contact_name as recipient_name from public.seller_ship_from_addresses a where a.seller_id = $1 and a.status = 'ACTIVE' order by a.is_default desc, a.created_at limit 1`,
        [rr!.seller_id],
      ),
      this.db.one(`select * from public.shipment_packages where shipment_id = $1 order by package_sequence limit 1`, [sh.id]),
      this.db.many(
        `select coalesce(ois.product_title, 'Merchandise') as title, ri.approved_quantity::int as qty, oifs.unit_price::text as unit_price, oi.currency_code,
                v.weight_value, v.weight_unit, v.length_value, v.width_value, v.height_value, v.dimension_unit,
                coalesce(ois.sku, v.sku) as sku, v.hs_code, v.country_of_origin_code, b.name as brand, s.slug as seller_slug
           from public.return_items ri join public.order_items oi on oi.id = ri.order_item_id
           left join public.order_item_snapshots ois on ois.order_item_id = oi.id
           left join public.order_item_financial_snapshots oifs on oifs.order_item_id = oi.id
           left join public.product_variants v on v.id = oi.variant_id left join public.products p on p.id = oi.product_id
           left join public.brands b on b.id = p.brand_id left join public.sellers s on s.id = oi.seller_id
          where ri.return_request_id = $1 and ri.approved_quantity > 0`,
        [id],
      ),
      this.db.one(
        `select u.email::text as customer, coalesce(ssp.support_email, su.email::text) as store from public.users u, public.sellers s
           join public.users su on su.id = s.owner_user_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
          where u.id = $1 and s.id = $2`,
        [rr!.customer_id, rr!.seller_id],
      ),
    ]);
    if (!customerAddr || !storeAddr || !items.length) throw conflict('RETURN_LABEL_DATA_MISSING', 'Faltan direcciones o productos para generar la etiqueta.');
    const parcel: Parcel = pkg && items.length
      ? ShippingService.parcelFor(items)
      : { weightKg: '1.000', length: '30.0', width: '20.0', height: '10.0' };
    const tx = await this.shipping.buyReturnLabel({ reference: returnRef(rr!.public_number), from: customerAddr, to: storeAddr, parcel, items, customerEmail: emails?.customer, storeEmail: emails?.store });
    if (tx.currency !== rr!.currency_code)
      this.logger.warn(`return label ${id}: label currency ${tx.currency} differs from order ${rr!.currency_code}; cost booked in label currency`);
    const cost = toMinor(tx.amount);
    await this.db.tx(async (c) => {
      const batch = await this.db.one(
        `insert into public.ledger_batches (batch_type, status, currency_code, source_type, source_id, idempotency_key, order_id, seller_order_id, actor_user_id, correlation_id, description, metadata)
         values ('RETURN_SHIPPING_LABEL','DRAFT',$1,'RETURN_REQUEST',$2,$3,$4,$5,$6,$7,$8,$9::jsonb) returning id`,
        [tx.currency, id, `return-label:${id}`, rr!.order_id, rr!.seller_order_id, user.id, randomUUID(),
         `Etiqueta de devolución ${returnRef(rr!.public_number)} (${payer === 'STORE' ? 'paga la tienda' : 'paga el marketplace'})`,
         JSON.stringify({ payer, transactionId: tx.transactionId })],
        c,
      );
      const line = async (code: string, side: 'DEBIT' | 'CREDIT', amount: bigint, key: string, owner: { seller?: string; external?: string } = {}) => {
        if (amount <= 0n) return;
        const acc = await this.db.one<{ id: string }>(`select public.get_or_create_ledger_account($1,$2,$3,null,$4) as id`, [code, tx.currency, owner.seller ?? null, owner.external ?? null], c);
        await this.db.exec(`select public.add_ledger_entry($1,$2,$3,$4,$5,null,null,$6,'{}'::jsonb)`, [batch!.id, acc!.id, side, fromMinor(amount), `return-label:${id}:${key}`, key], c);
      };
      await line('RETURN_SHIPPING_EXPENSE', 'DEBIT', cost, 'expense');
      await line('SHIPPING_PAYABLE', 'CREDIT', cost, 'carrier', { external: 'SHIPPO' });
      if (payer === 'STORE') {
        const bal = await this.db.one(`select available_amount from public.seller_balance_projections where seller_id = $1 and currency_code = $2 for update`, [rr!.seller_id, tx.currency], c);
        const available = toMinor(bal?.available_amount ?? 0);
        const fromAvailable = available >= cost ? cost : available > 0n ? available : 0n;
        await line('SELLER_AVAILABLE', 'DEBIT', fromAvailable, 'store-available', { seller: rr!.seller_id });
        await line('SELLER_RECEIVABLE', 'DEBIT', cost - fromAvailable, 'store-receivable', { seller: rr!.seller_id });
        await line('RETURN_SHIPPING_RECOVERY', 'CREDIT', cost, 'recovery');
      }
      await this.db.exec(`select public.post_ledger_batch($1)`, [batch!.id], c);
      await this.db.exec(
        `insert into public.nx_return_labels (return_request_id, provider_code, provider_transaction_id, carrier, service, tracking_number, tracking_url, label_url,
                 cost_amount, currency_code, payer, ledger_batch_id, test_mode, created_by) values ($1,'SHIPPO',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, tx.transactionId, tx.carrier, tx.service, tx.trackingNumber, tx.trackingUrl, tx.labelUrl, tx.amount, tx.currency, payer, batch!.id, tx.test, user.id],
        c,
      );
      const st = await this.db.one(`select status from public.return_requests where id = $1`, [id], c);
      if (st!.status === 'APPROVED') await this.setStatus(c, id, 'AWAITING_SHIPMENT');
    });
    this.mail.fire(() => this.mail.returnEvent(id, 'LABEL_READY'));
  }

  // ------------------------------------------------------------------ refund without return (staff)
  /**
   * Refunds delivered units the customer keeps (damaged beyond return, wrong item not worth
   * shipping back, lost after delivery…). Recorded as a return request closed without shipment:
   * same refund calculation, ledger and e-mails; nothing goes back to inventory.
   */
  async refundWithoutReturn(staff: RequestUser, input: { orderId: string; sellerOrderId: string; items: { orderItemId: string; quantity: number }[]; reasonCode: string; note: string; manualReference?: string }) {
    if (!isStaff(staff)) throw forbidden();
    const so = await this.db.one(
      `select so.id, so.order_id, so.seller_id, o.customer_id from public.seller_orders so join public.orders o on o.id = so.order_id where so.id = $1 and so.order_id = $2`,
      [input.sellerOrderId, input.orderId],
    );
    if (!so) throw notFound('Pedido');
    const wanted = input.items.filter((i) => i.quantity > 0);
    if (!wanted.length) throw badRequest('RETURN_ITEMS_REQUIRED', 'Selecciona al menos una unidad a reembolsar.');
    const reason = await this.db.one(`select id from public.return_reason_definitions where seller_id is null and code = $1 and status = 'ACTIVE'`, [input.reasonCode]);
    if (!reason) throw badRequest('RETURN_REASON_REQUIRED', 'Selecciona el motivo del reembolso.');
    for (const w of wanted) {
      const it = await this.db.one(
        `select oi.delivered_quantity::int - oi.returned_quantity::int - coalesce((select sum(ri.requested_quantity) from public.return_items ri join public.return_requests r on r.id = ri.return_request_id
                 where ri.order_item_id = oi.id and r.status = any($3::text[]))::int, 0) as left
           from public.order_items oi where oi.id = $1 and oi.seller_order_id = $2`,
        [w.orderItemId, so.id, OPEN_STATES],
      );
      if (!it) throw badRequest('RETURN_ITEM_INVALID', 'Uno de los productos no pertenece a esta venta.');
      if (!Number.isInteger(w.quantity) || w.quantity > it.left) throw badRequest('RETURN_QUANTITY_INVALID', `Solo hay ${Math.max(it.left, 0)} unidad(es) entregadas sin reembolsar de ese producto.`);
    }
    const pol = await this.policies.resolve(so.seller_id);
    const id = await this.db.tx(async (c) => {
      const rid = (await this.db.one(
        `select public.create_return_request($1,$2,$3,$4,$5::jsonb,$6,'ADMIN',$7,$8) as id`,
        [so.order_id, so.id, so.customer_id, pol.versionId, JSON.stringify({ windowDays: pol.windowDays, version: pol.versionId, noReturn: true }), `no-return:${randomUUID()}`, input.note.trim(), randomUUID()],
        c,
      ))!.id;
      await this.db.exec(`update public.return_requests set internal_note = 'NO_RETURN_REFUND' where id = $1`, [rid], c);
      for (const w of wanted) await this.db.exec(`select public.add_return_item($1,$2,$3,$4,$5,null,'{}'::jsonb)`, [rid, w.orderItemId, w.quantity, reason.id, input.note.trim()], c);
      const ris = await this.db.many(`select id, requested_quantity::int as q from public.return_items where return_request_id = $1`, [rid], c);
      await this.db.exec(`select public.approve_return_request($1,$2,$3::jsonb,$4)`, [rid, staff.id, JSON.stringify(ris.map((r: any) => ({ return_item_id: r.id, approved_quantity: r.q }))), 'Reembolso sin devolución del producto'], c);
      for (const r of ris) await this.db.exec(`select public.record_return_item_receipt($1,$2)`, [r.id, r.q], c);
      const insp = await this.db.one(`insert into public.return_inspections (return_request_id, status, inspected_by, started_at, notes) values ($1,'OPEN',$2,now(),$3) returning id`, [rid, staff.id, 'Sin devolución física: el cliente conserva el producto.'], c);
      for (const r of ris)
        await this.db.exec(
          `insert into public.return_inspection_items (inspection_id, return_item_id, inspected_quantity, accepted_quantity, rejected_quantity, restock_quantity, condition_code, disposition_code)
           values ($1,$2,$3,$3,0,0,'NOT_RETURNED','KEPT_BY_CUSTOMER')`,
          [insp!.id, r.id, r.q],
          c,
        );
      await this.db.exec(`select public.complete_return_inspection($1,$2)`, [insp!.id, staff.id], c);
      return rid;
    });
    return this.refund(staff, id, { manualReference: input.manualReference });
  }

  // ------------------------------------------------------------------ helpers
  private async lock(c: PoolClient, id: string) {
    const rr = await this.db.one(`select * from public.return_requests where id = $1 for update`, [id], c);
    if (!rr) throw notFound('Devolución');
    return rr;
  }

  private async setStatus(c: PoolClient, id: string, status: string) {
    const extra = status === 'CLOSED' ? ', closed_at = now()' : '';
    await this.db.exec(`update public.return_requests set status = $2, version = version + 1${extra} where id = $1`, [id, status], c);
  }

  private async summary(c: PoolClient, rr: { order_id: string; seller_order_id: string }) {
    await this.db.exec(`select public.recalculate_return_summary($1,$2)`, [rr.order_id, rr.seller_order_id], c);
  }
}
