import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { badRequest, conflict, notFound } from '../common/errors';
import { toMinor } from '../common/money';
import { orderRef } from '../common/refs';
import { RequestUser } from '../auth/auth';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { CancellationsService } from '../orders/cancellations.service';
import { ReturnsService } from '../returns/returns.service';
import { fromMinor } from '../common/money';

type Provider = 'STRIPE' | 'PAYPAL';
type Env = 'TEST' | 'LIVE';

export interface ProviderRefundEvent {
  provider: Provider;
  environment: Env;
  kind: 'EXTERNAL_REFUND' | 'PROVIDER_REVERSAL';
  chargeId: string;
  refundId: string;
  /** Major units, e.g. "12.50". */
  amount: string;
  currency: string;
  /** NEXOVAX refund id carried in the provider metadata (refunds NEXOVAX itself issued). */
  nxRefundId?: string | null;
  createdAt?: Date | null;
}

export interface DisputeEvent {
  provider: Provider;
  environment: Env;
  disputeId: string;
  chargeId: string;
  amountMinor: string;
  currency: string;
  reason?: string | null;
  /** Stripe vocabulary (PayPal is mapped to it): warning_needs_response … won / lost. */
  status: string;
  /** What the provider said, for the admin view. */
  providerStatus: string;
  balanceTransactions: { id: string; kind: 'FUNDS_WITHDRAWN' | 'FUNDS_REINSTATED'; principalMinor: string; feeMinor: string; currencyCode: string; createdAt?: string | null; reportingCategory?: string | null }[];
  createdAt?: Date | null;
  dueBy?: Date | null;
}

const PROVIDER_LABEL: Record<Provider, string> = { STRIPE: 'Stripe', PAYPAL: 'PayPal' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Money events after the sale that come from the provider, not from NEXOVAX:
 *  - disputes / chargebacks (both providers) → certified dispute engine: the disputed money is
 *    held, the store's payout for the order is blocked, and the outcome is booked when final;
 *  - refunds and reversals made in the provider's dashboard → an incident for an admin, who
 *    books it as a cancellation (whole order) or marks it reviewed. Refunds NEXOVAX issued are
 *    recognised by their reference and never counted twice.
 * Every open incident holds the store's payout for that order.
 */
@Injectable()
export class PaymentIncidentsService {
  private readonly logger = new Logger(PaymentIncidentsService.name);

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly cancellations: CancellationsService,
    private readonly returns: ReturnsService,
  ) {}

  // ------------------------------------------------------------------ provider refunds
  async providerRefund(ev: ProviderRefundEvent): Promise<'UNKNOWN' | 'DUPLICATE' | 'NEXOVAX' | 'DISPUTE' | 'INCIDENT'> {
    const pay = await this.db.one(
      `select p.id, p.order_id, p.currency_code, p.captured_amount::text as captured
         from public.payment_charges pc join public.payments p on p.id = pc.payment_id
        where pc.provider_code = $1 and pc.environment = $2 and pc.external_charge_id = $3`,
      [ev.provider, ev.environment, ev.chargeId],
    );
    if (!pay?.order_id) return 'UNKNOWN';
    const known = await this.db.one(
      `select id from public.refunds where provider_code = $1 and (provider_refund_id = $2 or provider_refund_id like $2 || '#%') limit 1`,
      [ev.provider, ev.refundId],
    );
    if (known) return 'DUPLICATE';
    if (ev.nxRefundId && UUID.test(ev.nxRefundId)) {
      const own = await this.db.one(`select id from public.refunds where id = $1 and payment_id = $2`, [ev.nxRefundId, pay.id]);
      // Issued by NEXOVAX: the flow that issued it books it (and retries are idempotent at the provider).
      if (own) return 'NEXOVAX';
    }
    if (ev.provider === 'PAYPAL') {
      // PayPal settles a lost claim/chargeback with a refund or reversal: the dispute engine books that loss.
      const d = await this.db.one(`select id from public.payment_disputes where payment_id = $1 and status in ('OPEN','UNDER_REVIEW','LOST') limit 1`, [pay.id]);
      if (d) return 'DISPUTE';
    }
    if (ev.currency.toUpperCase() !== pay.currency_code || toMinor(ev.amount) <= 0n || toMinor(ev.amount) > toMinor(pay.captured))
      throw badRequest('PROVIDER_REFUND_INVALID', 'El reembolso del procesador no coincide con el pago.');
    const row = await this.db.one(
      `insert into public.nx_payment_incidents (kind, provider_code, environment, external_id, payment_id, order_id, amount, currency_code, provider_status, detail)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'COMPLETED',$9::jsonb)
       on conflict (provider_code, environment, kind, external_id) do nothing returning id`,
      [ev.kind, ev.provider, ev.environment, ev.refundId, pay.id, pay.order_id, ev.amount, pay.currency_code,
       JSON.stringify({ chargeId: ev.chargeId, createdAt: ev.createdAt?.toISOString() ?? null })],
    );
    if (row) await this.alertAdmins(row.id, 'OPENED');
    return 'INCIDENT';
  }

  // ------------------------------------------------------------------ disputes
  async dispute(ev: DisputeEvent): Promise<'UNKNOWN' | 'RECORDED'> {
    const corr = randomUUID();
    let rec: any;
    try {
      rec = await this.db.tx(async (c) =>
        (await this.db.one(`select public.record_payment_dispute_evidence($1::jsonb, $2) as r`, [JSON.stringify({
          provider: ev.provider, environment: ev.environment, disputeId: ev.disputeId, chargeId: ev.chargeId, status: ev.status,
          currencyCode: ev.currency.toUpperCase(), amountMinor: ev.amountMinor, reason: ev.reason ?? null,
          createdAt: ev.createdAt?.toISOString() ?? null, balanceTransactions: ev.balanceTransactions,
        }), corr], c))!.r,
      );
    } catch (e: any) {
      if (String(e?.message).includes('CHARGEBACK_PAYMENT_NOT_FOUND')) return 'UNKNOWN';
      throw e;
    }
    const d = await this.db.one(`select id, payment_id, order_id, disputed_amount::text as amount, currency_code, status from public.payment_disputes where id = $1`, [rec.disputeId]);
    const inc = await this.db.one(
      `insert into public.nx_payment_incidents (kind, provider_code, environment, external_id, payment_id, order_id, dispute_id, amount, currency_code, provider_status, reason, due_by)
       values ('DISPUTE',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (provider_code, environment, kind, external_id) do update
          set provider_status = excluded.provider_status, due_by = coalesce(excluded.due_by, public.nx_payment_incidents.due_by), updated_at = now()
       returning id, status, (xmax = 0) as inserted`,
      [ev.provider, ev.environment, ev.disputeId, d!.payment_id, d!.order_id, d!.id, d!.amount, d!.currency_code, ev.providerStatus.slice(0, 60), ev.reason ?? null, ev.dueBy ?? null],
    );
    if (inc!.inserted) {
      await this.alertAdmins(inc!.id, 'OPENED');
      await this.alertSellers(d!.order_id, 'DISPUTE_OPENED', inc!.id);
    }
    if (inc!.status === 'OPEN') {
      if (d!.status === 'INQUIRY_CLOSED') await this.close(inc!.id, 'INQUIRY_CLOSED', null, 'La consulta se cerró sin cargo.');
      else if (d!.status === 'WON' || d!.status === 'LOST') await this.resolveDispute(inc!.id);
    }
    return 'RECORDED';
  }

  /** Books the final outcome (WON / LOST) of a dispute; on failure the incident stays open with the error. */
  private async resolveDispute(incidentId: string) {
    const inc = await this.db.one(`select id, dispute_id, order_id from public.nx_payment_incidents where id = $1`, [incidentId]);
    try {
      const r = await this.db.tx(async (c) => {
        // Orders placed before the policy pin existed get the policy that was in force at the sale.
        await this.db.exec(`select public.nx_pin_chargeback_policies($1)`, [inc!.order_id], c);
        return (await this.db.one(`select public.resolve_payment_dispute($1,$2) as r`, [inc!.dispute_id, randomUUID()], c))!.r;
      });
      await this.close(incidentId, r.outcome, null, r.outcome === 'WON' ? 'Disputa ganada: el dinero volvió.' : 'Disputa perdida: la pérdida se descontó según la política.');
      await this.alertSellers(inc!.order_id, r.outcome === 'WON' ? 'DISPUTE_WON' : 'DISPUTE_LOST', incidentId);
      await this.alertAdmins(incidentId, 'CLOSED');
      return r;
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 300);
      this.logger.warn(`resolve dispute ${inc!.dispute_id}: ${msg}`);
      const first = await this.db.one(`update public.nx_payment_incidents set last_error = $2, updated_at = now() where id = $1 and last_error is distinct from $2 returning id`, [incidentId, msg]);
      if (first) await this.alertAdmins(incidentId, 'FAILED');
      return null;
    }
  }

  private async close(id: string, outcome: string, userId: string | null, note: string) {
    await this.db.exec(
      `update public.nx_payment_incidents set status = 'RESOLVED', outcome = $2, resolved_by = $3, resolved_at = now(), resolution_note = $4, last_error = null, updated_at = now()
        where id = $1 and status = 'OPEN'`,
      [id, outcome, userId, note.slice(0, 500)],
    );
  }

  // ------------------------------------------------------------------ admin
  async list(status: 'OPEN' | 'ALL') {
    const rows = await this.db.many(
      `select i.*, i.amount::text as amount, o.public_number as order_number, p.captured_amount::text as captured, p.refunded_amount::text as refunded,
              d.status as dispute_status,
              (select coalesce(sum(case bt.movement_type when 'FUNDS_WITHDRAWN' then bt.principal_amount + bt.fee_amount else -(bt.principal_amount + bt.fee_amount) end),0)::text
                 from public.payment_dispute_balance_transactions bt where bt.dispute_id = i.dispute_id) as held,
              (select string_agg(coalesce(ssp.display_name, s.slug), ', ' order by so.created_at) from public.seller_orders so join public.sellers s on s.id = so.seller_id
                 left join public.seller_store_profiles ssp on ssp.seller_id = s.id where so.order_id = i.order_id) as stores,
              coalesce(up.display_name, u.email::text) as resolved_by_name
         from public.nx_payment_incidents i join public.orders o on o.id = i.order_id join public.payments p on p.id = i.payment_id
         left join public.payment_disputes d on d.id = i.dispute_id left join public.users u on u.id = i.resolved_by left join public.user_profiles up on up.user_id = u.id
        where ($1 = 'ALL' or i.status = 'OPEN')
        order by (i.status = 'OPEN') desc, i.created_at desc limit 200`,
      [status],
    );
    return rows.map((r: any) => ({
      id: r.id, kind: r.kind, provider: r.provider_code, environment: r.environment, externalId: r.external_id,
      orderId: r.order_id, orderNumber: orderRef(r.order_number), stores: r.stores, amount: r.amount, currency: r.currency_code,
      status: r.status, providerStatus: r.provider_status, disputeStatus: r.dispute_status, reason: r.reason, dueBy: r.due_by,
      held: r.held, outcome: r.outcome, lastError: r.last_error, note: r.resolution_note, resolvedBy: r.resolved_by_name, resolvedAt: r.resolved_at,
      createdAt: r.created_at,
      canCancelOrder: r.status === 'OPEN' && r.kind !== 'DISPUTE' && toMinor(r.amount) === toMinor(r.captured) - toMinor(r.refunded),
    }));
  }

  async openCount() {
    return (await this.db.one<{ n: number }>(`select count(*)::int as n from public.nx_payment_incidents where status = 'OPEN'`))!.n;
  }

  private async openIncident(id: string) {
    const inc = await this.db.one(`select *, amount::text as amount from public.nx_payment_incidents where id = $1`, [id]);
    if (!inc) throw notFound('Incidencia');
    if (inc.status !== 'OPEN') throw conflict('INCIDENT_CLOSED', 'Esta incidencia ya está resuelta.');
    return inc;
  }

  /** Dispute: books the final outcome again (after fixing what blocked it). */
  async retry(user: RequestUser, id: string) {
    const inc = await this.openIncident(id);
    if (inc.kind !== 'DISPUTE') throw badRequest('INCIDENT_ACTION_INVALID', 'Solo las disputas se pueden reintentar.');
    const d = await this.db.one(`select status from public.payment_disputes where id = $1`, [inc.dispute_id]);
    if (!['WON', 'LOST'].includes(d!.status)) throw conflict('DISPUTE_NOT_FINAL', 'La disputa sigue abierta con el procesador: se cerrará sola cuando haya resultado.');
    const r = await this.resolveDispute(id);
    if (!r) throw conflict('DISPUTE_RESOLUTION_FAILED', 'No se pudo contabilizar el resultado de la disputa. Revisa el detalle del error.');
    return { ok: true, outcome: r.outcome };
  }

  /** Refund of the whole order made at the provider: cancel the order and book the refund (no second refund). */
  async cancelOrder(user: RequestUser, id: string) {
    const inc = await this.openIncident(id);
    if (inc.kind === 'DISPUTE') throw badRequest('INCIDENT_ACTION_INVALID', 'Las disputas se resuelven con el procesador.');
    const p = await this.db.one(`select captured_amount::text as captured, refunded_amount::text as refunded from public.payments where id = $1`, [inc.payment_id]);
    if (toMinor(inc.amount) !== toMinor(p!.captured) - toMinor(p!.refunded))
      throw conflict('INCIDENT_PARTIAL_REFUND', 'El reembolso no cubre todo el pedido: resuélvelo con la tienda (devolución o ajuste) y márcalo como revisado.');
    const ok = await this.cancellations.cancelForExternalRefund(user, inc.order_id, {
      providerRefundId: inc.external_id, providerStatus: 'COMPLETED', label: PROVIDER_LABEL[inc.provider_code as Provider],
    });
    if (!ok) throw conflict('ORDER_NOT_CANCELLABLE', 'El pedido ya se envió o tiene devoluciones: no se puede registrar como cancelación. Resuélvelo con la tienda y márcalo como revisado.');
    await this.close(id, 'ORDER_CANCELLED', user.id, 'Registrado como cancelación del pedido con el reembolso del procesador.');
    return { ok: true };
  }

  /**
   * Partial refund made at the processor: the delivered units still refundable, with an estimate per
   * unit (price after discounts + tax) and the combination that adds up exactly to the refund.
   */
  async partialOptions(id: string) {
    const inc = await this.openIncident(id);
    if (inc.kind === 'DISPUTE') throw badRequest('INCIDENT_ACTION_INVALID', 'Las disputas se resuelven con el procesador.');
    const rows = await this.db.many(
      `select oi.id, oi.seller_order_id, p.title, coalesce(ssp.display_name, s.slug) as store,
              (oi.delivered_quantity - oi.returned_quantity - coalesce((select sum(ri.requested_quantity) from public.return_items ri join public.return_requests r on r.id = ri.return_request_id
                 where ri.order_item_id = oi.id and r.status not in ('CLOSED','REJECTED','CANCELLED')), 0))::int as left,
              ((f.product_net_amount + f.tax_amount) / nullif(f.quantity, 0))::numeric(18,2)::text as unit
         from public.order_items oi join public.products p on p.id = oi.product_id join public.order_item_financial_snapshots f on f.order_item_id = oi.id
         join public.sellers s on s.id = oi.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where oi.order_id = $1 order by oi.created_at`,
      [inc.order_id],
    );
    const items = rows.filter((r: any) => r.left > 0).map((r: any) => ({ orderItemId: r.id, sellerOrderId: r.seller_order_id, title: r.title, store: r.store, available: r.left, unitAmount: r.unit }));
    // Smallest exact combination of units (cents) — bounded search, small orders only.
    const target = Math.round(Number(inc.amount) * 100);
    const units = items.flatMap((it) => Array.from({ length: Math.min(it.available, 20) }, () => ({ id: it.orderItemId, c: Math.round(Number(it.unitAmount) * 100) })));
    let best: Record<string, number> | null = null;
    if (units.length <= 40) {
      const reach = new Map<number, number[]>([[0, []]]);
      units.forEach((u, idx) => {
        for (const [sum, path] of [...reach]) {
          const ns = sum + u.c;
          if (ns <= target && !reach.has(ns)) reach.set(ns, [...path, idx]);
        }
      });
      const hit = reach.get(target);
      if (hit && target > 0) { best = {}; for (const i of hit) best[units[i].id] = (best[units[i].id] ?? 0) + 1; }
    }
    return { amount: inc.amount, currency: inc.currency_code, items, suggestion: best };
  }

  /** Books the partial refund against the chosen units: the store's share is deducted, no money moves again. */
  async bookPartial(user: RequestUser, id: string, items: { orderItemId: string; quantity: number }[]) {
    const inc = await this.openIncident(id);
    if (inc.kind === 'DISPUTE') throw badRequest('INCIDENT_ACTION_INVALID', 'Las disputas se resuelven con el procesador.');
    const opts = await this.partialOptions(id);
    const bySo = new Map<string, { orderItemId: string; quantity: number }[]>();
    for (const w of items.filter((x) => x.quantity > 0)) {
      const it = opts.items.find((x) => x.orderItemId === w.orderItemId);
      if (!it) throw badRequest('RETURN_ITEM_INVALID', 'Uno de los productos no pertenece a esta venta.');
      bySo.set(it.sellerOrderId, [...(bySo.get(it.sellerOrderId) ?? []), w]);
    }
    await this.returns.bookExternalRefund(user, {
      orderId: inc.order_id, groups: [...bySo].map(([sellerOrderId, its]) => ({ sellerOrderId, items: its })),
      providerRefundId: inc.external_id, providerStatus: 'COMPLETED', amount: fromMinor(BigInt(Math.round(Number(inc.amount) * 100))),
      note: `Reembolso de ${PROVIDER_LABEL[inc.provider_code as Provider]} ${inc.external_id}`,
    });
    await this.close(id, 'REFUND_BOOKED', user.id, 'Reembolso registrado contra las unidades que cubrió; descontado a la tienda.');
    return { ok: true };
  }

  /** Refund / reversal handled outside the order flow (agreed with the store, partial, …). */
  async markReviewed(user: RequestUser, id: string, note: string) {
    const inc = await this.openIncident(id);
    if (inc.kind === 'DISPUTE') throw badRequest('INCIDENT_ACTION_INVALID', 'Las disputas se cierran solas cuando el procesador da el resultado.');
    if (!note?.trim() || note.trim().length < 5) throw badRequest('INCIDENT_NOTE_REQUIRED', 'Explica cómo se resolvió (mínimo 5 caracteres).');
    await this.close(id, 'REVIEWED', user.id, note.trim());
    return { ok: true };
  }

  // ------------------------------------------------------------------ notices
  private async alertAdmins(incidentId: string, event: 'OPENED' | 'CLOSED' | 'FAILED') {
    const inc = await this.db.one(
      `select i.id, i.kind, i.provider_code, i.amount::text as amount, i.currency_code, i.outcome, o.public_number from public.nx_payment_incidents i join public.orders o on o.id = i.order_id where i.id = $1`,
      [incidentId],
    );
    if (!inc) return;
    const what = inc.kind === 'DISPUTE' ? 'Disputa' : inc.kind === 'PROVIDER_REVERSAL' ? 'Reversión' : 'Reembolso externo';
    const amt = `${Number(inc.amount).toFixed(2)} ${inc.currency_code}`;
    const ref = orderRef(inc.public_number);
    const title = event === 'OPENED' ? `${what} en ${PROVIDER_LABEL[inc.provider_code as Provider]}: ${ref}` : event === 'CLOSED' ? `${what} cerrada (${inc.outcome === 'WON' ? 'ganada' : 'perdida'}): ${ref}` : `${what}: no se pudo contabilizar (${ref})`;
    const body = event === 'OPENED'
      ? inc.kind === 'DISPUTE'
        ? `El cliente abrió una disputa por ${amt}. El pago a la tienda de este pedido queda retenido. Responde la disputa en ${PROVIDER_LABEL[inc.provider_code as Provider]} con la prueba de entrega.`
        : `Se devolvieron ${amt} desde ${PROVIDER_LABEL[inc.provider_code as Provider]}, fuera de NEXOVAX. El pago a la tienda queda retenido hasta que lo registres.`
      : event === 'CLOSED' ? `Resultado contabilizado por ${amt}.` : 'Revisa el detalle y reintenta.';
    const admins = await this.db.many<{ id: string }>(
      `select distinct u.id from public.users u join public.user_roles ur on ur.user_id = u.id and ur.revoked_at is null and (ur.expires_at is null or ur.expires_at > now())
         join public.roles r on r.id = ur.role_id where r.code in ('ADMIN','SUPER_ADMIN') and u.status = 'ACTIVE'`,
    );
    for (const a of admins) {
      await this.notifications.notify(a.id, {
        category: 'PAYMENTS', eventType: `PAYMENT_INCIDENT_${event}`, title, body, url: '/admin/incidencias-pago',
        entityType: 'PAYMENT_INCIDENT', entityId: inc.id, dedupeKey: `payment-incident:${inc.id}:${event}:${event === 'FAILED' ? Date.now() : ''}`,
      });
      if (event !== 'CLOSED') this.mail.fire(() => this.mail.paymentIncidentAdmin(a.id, { title, body, dedupeKey: `payment-incident:${inc.id}:${event}:${a.id}` }));
    }
  }

  private async alertSellers(orderId: string, event: 'DISPUTE_OPENED' | 'DISPUTE_WON' | 'DISPUTE_LOST', incidentId: string) {
    const rows = await this.db.many(
      `select s.owner_user_id, o.public_number from public.seller_orders so join public.sellers s on s.id = so.seller_id join public.orders o on o.id = so.order_id where so.order_id = $1`,
      [orderId],
    );
    for (const r of rows) {
      const ref = orderRef(r.public_number);
      const [title, body] = event === 'DISPUTE_OPENED'
        ? [`Disputa abierta en el pedido ${ref}`, 'El cliente abrió una disputa con su banco o PayPal. El pago de este pedido queda retenido hasta que se resuelva; NEXOVAX te contactará si necesita la prueba de entrega.']
        : event === 'DISPUTE_WON'
          ? [`Disputa ganada en el pedido ${ref}`, 'La disputa se resolvió a favor de la tienda. El pago de este pedido sigue su curso normal.']
          : [`Disputa perdida en el pedido ${ref}`, 'La disputa se resolvió a favor del cliente. El monto disputado se descontó de tu saldo de este pedido.'];
      await this.notifications.notify(r.owner_user_id, {
        category: 'PAYMENTS', eventType: event, title, body, url: `/vendedor/pedidos/${orderId}`, entityType: 'ORDER', entityId: orderId,
        dedupeKey: `${event.toLowerCase()}:${incidentId}`,
      });
    }
  }
}
