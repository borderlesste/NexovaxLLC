import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { AppError, conflict, notFound } from '../common/errors';
import { fromMinor, toMinor } from '../common/money';
import { postSaleAllocation } from '../checkout/sale-ledger';
import { MailService } from '../mail/mail.service';
import { StripeTaxService } from '../tax/stripe-tax.service';
import { orderRef } from '../common/refs';
import { fromStripeAmount, StripeService } from './stripe.service';
import { PaypalService } from './paypal.service';
import { CardsService } from './cards.service';
import { DisputeEvent, PaymentIncidentsService } from './incidents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paymentsLive } from '../common/live-orders';

export type ProviderCode = 'STRIPE' | 'PAYPAL' | 'RD_SANDBOX';

/** Card/PayPal payments are short-lived; bank transfers keep the reservation longer. */
export const ONLINE_PAYMENT_TTL_MIN = 30;

/** SQL: payment `p` is a bank transfer (its latest provider intent says so). */
export const BANK_TRANSFER_SQL = `exists (select 1 from public.payment_provider_intents bi where bi.payment_id = p.id and bi.sanitized_metadata->>'method' = 'BANK_TRANSFER')`;

interface CaptureEvidence {
  externalChargeId: string;
  amount: string;
  currency: string;
  balanceTransactionId?: string | null;
  eventAt?: Date | null;
  webhookReceiptId?: string | null;
}

/**
 * Online payments with real providers (Stripe cards, PayPal) on top of the
 * provider-neutral payment model:
 *   begin_checkout_payment → provider intent (REQUIRES_ACTION) → buyer pays in the
 *   provider UI → server-side verification (API) or signed webhook →
 *   confirm_payment_capture → order + ledger + SALE allocation.
 * Every step is idempotent: the API confirmation and the webhook can race safely.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly db: DbService,
    private readonly stripe: StripeService,
    private readonly paypal: PaypalService,
    private readonly mail: MailService,
    private readonly cards: CardsService,
    private readonly incidents: PaymentIncidentsService,
    private readonly notifications: NotificationsService,
    private readonly stripeTax: StripeTaxService,
  ) {}

  providerFor(method: 'CARD' | 'PAYPAL' | 'BANK_TRANSFER'): { code: ProviderCode; environment: 'TEST' | 'LIVE' } | null {
    if (method === 'CARD') return this.stripe.enabled ? { code: 'STRIPE', environment: this.stripe.environment } : null;
    if (method === 'PAYPAL') return this.paypal.enabled ? { code: 'PAYPAL', environment: this.paypal.environment } : null;
    return null;
  }

  /** Inside the checkout transaction: creates the provider intent and leaves the payment REQUIRES_ACTION. */
  async startProviderPayment(c: PoolClient, input: { paymentId: string; checkoutId: string; provider: ProviderCode; amount: string; currency: string; customerEmail?: string; reference: string; corr: string; userId?: string; saveCard?: boolean; savedCardId?: string }) {
    if (input.provider === 'STRIPE') {
      // Saved card: pay with its PaymentMethod. "Save this card": attach the new one to the buyer's Stripe customer.
      const saved = input.savedCardId && input.userId ? await this.cards.forPayment(input.userId, input.savedCardId) : null;
      const customerId = saved?.customerId ?? (input.saveCard && input.userId ? await this.cards.customerId(input.userId) : null);
      const pi = await this.stripe.createIntent({
        amount: input.amount, currency: input.currency, paymentId: input.paymentId, checkoutId: input.checkoutId,
        customerEmail: input.customerEmail, description: `NEXOVAX ${input.reference}`,
        customerId: customerId ?? undefined, saveCard: !saved && !!input.saveCard, paymentMethodId: saved?.paymentMethodId,
      });
      const intentId: string = (await this.db.one(
        `select public.register_payment_provider_intent($1,$2,$3,'REQUIRES_PAYMENT_METHOD',null,null,to_timestamp($4),$5::jsonb) as id`,
        [input.paymentId, pi.id, pi.status, pi.created, JSON.stringify({ method: 'CARD', provider: 'STRIPE', livemode: pi.livemode })],
        c,
      ))!.id;
      await this.db.exec(`select public.mark_payment_requires_action($1,$2,$3)`, [input.paymentId, intentId, input.corr], c);
      return { provider: 'STRIPE' as const, externalId: pi.id };
    }
    if (input.provider === 'PAYPAL') {
      const order = await this.paypal.createOrder({ amount: input.amount, currency: input.currency, paymentId: input.paymentId, reference: input.reference, description: `NEXOVAX ${input.reference}` });
      const intentId: string = (await this.db.one(
        `select public.register_payment_provider_intent($1,$2,$3,'REQUIRES_ACTION',null,null,now(),$4::jsonb) as id`,
        [input.paymentId, order.id, order.status, JSON.stringify({ method: 'PAYPAL', provider: 'PAYPAL' })],
        c,
      ))!.id;
      await this.db.exec(`select public.mark_payment_requires_action($1,$2,$3)`, [input.paymentId, intentId, input.corr], c);
      return { provider: 'PAYPAL' as const, externalId: order.id as string };
    }
    throw new AppError('PAYMENT_METHOD_UNAVAILABLE', 'Método de pago no disponible.', HttpStatus.BAD_REQUEST);
  }

  /** Latest payment of a checkout owned by the user, with its provider intent. */
  private async paymentForCheckout(checkoutId: string, userId: string | null) {
    const p = await this.db.one(
      `select p.id, p.status, p.provider_code, p.environment, p.order_id, p.expected_amount::text as amount, p.currency_code, p.customer_id, p.checkout_session_id,
              i.id as intent_id, i.external_intent_id, i.provider_status
         from public.payments p
         left join lateral (select * from public.payment_provider_intents x where x.payment_id = p.id order by x.sequence_number desc limit 1) i on true
        where p.checkout_session_id = $1 and ($2::uuid is null or p.customer_id = $2)
        order by p.created_at desc limit 1`,
      [checkoutId, userId],
    );
    if (!p) throw notFound('Pago');
    return p;
  }

  /** Data the browser needs to complete a pending online payment. */
  async clientAction(checkoutId: string, userId: string) {
    const p = await this.paymentForCheckout(checkoutId, userId);
    if (p.status !== 'REQUIRES_ACTION' && p.status !== 'REQUIRES_PAYMENT_METHOD') return null;
    if (p.provider_code === 'STRIPE' && p.external_intent_id) {
      const pi = await this.stripe.retrieveIntent(p.external_intent_id);
      return { provider: 'STRIPE', clientSecret: pi.client_secret, intentStatus: pi.status };
    }
    if (p.provider_code === 'PAYPAL' && p.external_intent_id) return { provider: 'PAYPAL', orderId: p.external_intent_id };
    return null;
  }

  /** Verifies the Stripe PaymentIntent server-side and creates the order when it succeeded. */
  async confirmStripe(checkoutId: string, userId: string) {
    const p = await this.paymentForCheckout(checkoutId, userId);
    if (p.provider_code !== 'STRIPE' || !p.external_intent_id) throw conflict('PAYMENT_PROVIDER_MISMATCH', 'El pago no corresponde a una tarjeta.');
    if (p.status === 'PAID') return { status: 'PAID', orderId: p.order_id };
    const pi = await this.stripe.retrieveIntent(p.external_intent_id);
    if (pi.status === 'succeeded') {
      await this.cards.recordFromIntent(p.customer_id, pi);
      const charge: any = pi.latest_charge;
      const orderId = await this.finalize(p.id, {
        externalChargeId: typeof charge === 'string' ? charge : charge?.id ?? pi.id,
        amount: fromStripeAmount(pi.amount_received, pi.currency),
        currency: pi.currency.toUpperCase(),
        balanceTransactionId: typeof charge?.balance_transaction === 'string' ? charge.balance_transaction : charge?.balance_transaction?.id ?? null,
        eventAt: new Date((charge?.created ?? pi.created) * 1000),
      }, userId);
      return { status: 'PAID', orderId };
    }
    if (pi.status === 'processing') return { status: 'PROCESSING' };
    const err = pi.last_payment_error;
    throw new AppError(
      err?.code === 'card_declined' ? 'CARD_DECLINED' : 'PAYMENT_NOT_COMPLETED',
      err?.message ? `No se pudo completar el pago: ${err.message}` : 'El pago aún no se ha completado.',
      HttpStatus.PAYMENT_REQUIRED,
      { stripeStatus: pi.status, declineCode: err?.decline_code },
    );
  }

  /** Captures an approved PayPal order and creates the marketplace order. */
  async capturePaypal(checkoutId: string, userId: string) {
    const p = await this.paymentForCheckout(checkoutId, userId);
    if (p.provider_code !== 'PAYPAL' || !p.external_intent_id) throw conflict('PAYMENT_PROVIDER_MISMATCH', 'El pago no corresponde a PayPal.');
    if (p.status === 'PAID') return { status: 'PAID', orderId: p.order_id };
    let order = await this.paypal.getOrder(p.external_intent_id);
    if (order.status === 'APPROVED') order = await this.paypal.captureOrder(p.external_intent_id, p.id);
    const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
    if (capture?.status === 'PENDING') {
      // PayPal is still clearing it (eCheck, review…): the order stays reserved until PAYMENT.CAPTURE.COMPLETED.
      await this.markProcessing(p.id);
      return { status: 'PROCESSING' };
    }
    if (capture && ['DECLINED', 'FAILED'].includes(capture.status)) {
      await this.cancelLocally(p, 'PROVIDER_DECLINED');
      throw new AppError('PAYMENT_DECLINED', 'PayPal rechazó el pago. Prueba con otro medio de pago.', HttpStatus.PAYMENT_REQUIRED, { captureStatus: capture.status });
    }
    if (order.status !== 'COMPLETED' || !capture || capture.status !== 'COMPLETED')
      throw new AppError('PAYMENT_NOT_COMPLETED', 'PayPal aún no confirma el pago.', HttpStatus.PAYMENT_REQUIRED, { paypalStatus: order.status, captureStatus: capture?.status });
    const orderId = await this.finalize(p.id, {
      externalChargeId: capture.id,
      amount: Number(capture.amount.value).toFixed(2),
      currency: capture.amount.currency_code,
      eventAt: capture.create_time ? new Date(capture.create_time) : new Date(),
    }, userId);
    return { status: 'PAID', orderId };
  }

  /**
   * Payment captured → order. Idempotent: returns the existing order when the
   * payment was already confirmed (e.g. by the webhook).
   */
  async finalize(paymentId: string, ev: CaptureEvidence, actorUserId: string | null) {
    const result = await this.db.tx(async (c) => {
      const p = await this.db.one(
        `select p.id, p.status, p.order_id, p.expected_amount::text as amount, p.currency_code,
                (select i.id from public.payment_provider_intents i where i.payment_id = p.id order by i.sequence_number desc limit 1) as intent_id
           from public.payments p where p.id = $1 for update`,
        [paymentId],
        c,
      );
      if (!p) throw notFound('Pago');
      if (p.status === 'PAID') return { orderId: p.order_id as string, created: false };
      if (!['REQUIRES_ACTION', 'REQUIRES_PAYMENT_METHOD', 'PROCESSING', 'AUTHORIZED'].includes(p.status))
        throw conflict('PAYMENT_NOT_PENDING', 'El pago ya fue procesado.');
      if (toMinor(ev.amount) !== toMinor(p.amount) || ev.currency.toUpperCase() !== p.currency_code)
        throw new AppError('PAYMENT_AMOUNT_MISMATCH', 'El monto cobrado no coincide con el pedido.', HttpStatus.CONFLICT, { charged: ev.amount, expected: p.amount });
      const corr = randomUUID();
      const r = await this.db.one(
        `select public.confirm_payment_capture($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as order_id`,
        [paymentId, p.intent_id, ev.externalChargeId, fromMinor(toMinor(ev.amount)), p.currency_code, ev.webhookReceiptId ?? null, ev.eventAt ?? new Date(),
         ev.balanceTransactionId ?? null, actorUserId, corr],
        c,
      );
      await this.db.exec(`select public.post_payment_capture_to_ledger($1,$2,$3,$4)`, [paymentId, `capture:${paymentId}`, actorUserId, corr], c);
      await postSaleAllocation(this.db, c, paymentId, actorUserId, corr);
      // Who bears a lost dispute, fixed at the sale (policy in force now).
      await this.db.exec(`select public.nx_pin_chargeback_policies($1)`, [r!.order_id], c);
      return { orderId: r!.order_id as string, created: true };
    });
    if (result.created) {
      this.mail.fire(() => this.mail.orderConfirmed(result.orderId));
      this.stripeTax.fire(result.orderId);
    }
    return result.orderId;
  }

  /**
   * Cancels an unpaid online payment (buyer left or wants to edit the cart).
   * Never cancels a payment the provider already captured: that one is finalized instead.
   */
  async cancelPending(checkoutId: string, userId: string | null, reason = 'CUSTOMER_ABANDONED') {
    const p = await this.paymentForCheckout(checkoutId, userId);
    if (p.status === 'PAID') return { status: 'PAID', orderId: p.order_id };
    if (!['REQUIRES_ACTION', 'REQUIRES_PAYMENT_METHOD'].includes(p.status) || !['STRIPE', 'PAYPAL', 'RD_SANDBOX'].includes(p.provider_code)) return { status: p.status };
    // A TEST payment once real payments are live can never take real money (and the live
    // keys can't even look it up): close it locally. Same for sandbox payments and bank
    // transfers, which no processor holds: an admin confirms those by hand.
    if (p.provider_code === 'RD_SANDBOX' || (p.environment === 'TEST' && paymentsLive())) {
      await this.cancelLocally(p, reason);
      return { status: 'CANCELLED' };
    }
    if (p.provider_code === 'STRIPE' && p.external_intent_id) {
      const pi = await this.stripe.retrieveIntent(p.external_intent_id);
      if (pi.status === 'succeeded') return this.confirmStripe(checkoutId, p.customer_id);
      if (pi.status === 'processing') throw conflict('PAYMENT_PROCESSING', 'El pago con tarjeta se está procesando. Espera unos segundos.');
      const after = pi.status === 'canceled' ? pi : await this.stripe.cancelIntent(p.external_intent_id);
      if (after.status === 'succeeded') return this.confirmStripe(checkoutId, p.customer_id);
      if (after.status === 'processing') throw conflict('PAYMENT_PROCESSING', 'El pago con tarjeta se está procesando. Espera unos segundos.');
      // Only mirror the cancellation locally once Stripe itself reports it.
      if (after.status !== 'canceled') throw conflict('PAYMENT_CANCEL_FAILED', 'No se pudo cancelar el pago con el procesador. Inténtalo de nuevo.');
    }
    if (p.provider_code === 'PAYPAL' && p.external_intent_id) {
      const order = await this.paypal.getOrder(p.external_intent_id).catch(() => null);
      if (order?.status === 'COMPLETED' || order?.status === 'APPROVED') return this.capturePaypal(checkoutId, p.customer_id);
    }
    await this.cancelLocally(p, reason);
    return { status: 'CANCELLED' };
  }

  /** Mirrors a cancelled/declined provider payment: payment cancelled, checkout closed, stock released. */
  private async cancelLocally(p: { id: string; customer_id: string; checkout_session_id: string }, reason: string) {
    await this.db.tx(async (c) => {
      await this.db.exec(`select public.cancel_unpaid_payment($1,$2,$3,$4)`, [p.id, reason, p.customer_id, randomUUID()], c);
      const cs = await this.db.one(`select status from public.checkout_sessions where id = $1`, [p.checkout_session_id], c);
      if (cs && !['CANCELLED', 'COMPLETED', 'EXPIRED', 'FAILED'].includes(cs.status))
        await this.db.exec(`select public.cancel_checkout_session($1,$2,$3,null)`, [p.checkout_session_id, p.customer_id, reason], c).catch(() => undefined);
    });
  }

  /** Provider accepted the payment but hasn't cleared it yet: keep the reservation, wait for the webhook. */
  private async markProcessing(paymentId: string) {
    await this.db.tx(async (c) => {
      const p = await this.db.one(
        `select p.status, (select i.id from public.payment_provider_intents i where i.payment_id = p.id order by i.sequence_number desc limit 1) as intent_id
           from public.payments p where p.id = $1 for update`,
        [paymentId],
        c,
      );
      if (p && p.intent_id && ['REQUIRES_ACTION', 'REQUIRES_PAYMENT_METHOD', 'AUTHORIZED'].includes(p.status))
        await this.db.exec(`select public.mark_payment_processing($1,$2,$3)`, [paymentId, p.intent_id, randomUUID()], c);
    });
  }

  /** Pending payment by id, with what cancelLocally needs. */
  private async pendingPayment(paymentId: string | null | undefined, provider: ProviderCode) {
    if (!paymentId || !/^[0-9a-f-]{36}$/i.test(paymentId)) return null;
    return this.db.one(
      `select id, status, customer_id, checkout_session_id from public.payments where id = $1 and provider_code = $2`,
      [paymentId, provider],
    );
  }

  /**
   * Releases abandoned payments of a buyer so the cart can be edited again: unpaid card/PayPal
   * payments, simulated (sandbox) card payments and, once real payments are live, any TEST
   * payment. A pending bank transfer is kept (the buyer may already have sent the money): the
   * buyer cancels it explicitly from the cart, or it expires.
   */
  async releaseAbandoned(userId: string) {
    const rows = await this.db.many(
      `select p.checkout_session_id from public.payments p
        where p.customer_id = $1 and p.status in ('REQUIRES_ACTION','REQUIRES_PAYMENT_METHOD')
          and (p.provider_code in ('STRIPE','PAYPAL')
               or (p.provider_code = 'RD_SANDBOX' and not ${BANK_TRANSFER_SQL})
               or ($2::boolean and p.environment = 'TEST'))`,
      [userId, paymentsLive()],
    );
    for (const r of rows) await this.cancelPending(r.checkout_session_id, userId).catch((e) => this.logger.warn(`release ${r.checkout_session_id}: ${e?.message}`));
  }

  // ------------------------------------------------------------------ webhooks

  private async receipt(provider: ProviderCode, eventId: string, type: string, payload: unknown) {
    const json = JSON.stringify(payload);
    const row = await this.db.one<{ id: string; status: string }>(
      `insert into public.integration_webhook_receipts (provider_code, external_event_id, deduplication_key, event_type, signature_validation_status,
               payload_hash, payload, status, validated_at)
       values ($1,$2,$2,$3,'VALID',$4,$5::jsonb,'VALIDATED',now())
       on conflict (provider_code, deduplication_key) do update set attempts = public.integration_webhook_receipts.attempts + 1
       returning id, status`,
      [provider, eventId, type, createHash('sha256').update(json).digest('hex'), json],
    );
    return row!;
  }

  private async closeReceipt(id: string, status: 'PROCESSED' | 'IGNORED' | 'FAILED', error?: string) {
    await this.db
      .exec(`update public.integration_webhook_receipts set status = $2, processed_at = now(), last_error_code = $3, last_error_detail = $4 where id = $1`,
        [id, status, error ? 'PROCESSING_ERROR' : null, error ? error.slice(0, 500) : null])
      .catch(() => undefined);
  }

  /**
   * Stripe events NEXOVAX acts on (subscribe the endpoint to these):
   *   payment_intent.succeeded | processing | payment_failed | canceled,
   *   charge.refunded, charge.refund.updated, refund.created, refund.updated,
   *   charge.dispute.created | updated | closed | funds_withdrawn | funds_reinstated.
   */
  async handleStripeWebhook(raw: Buffer, signature: string) {
    const event = this.stripe.constructEvent(raw, signature);
    const rec = await this.receipt('STRIPE', event.id, event.type, event);
    if (rec.status === 'PROCESSED') return { received: true, duplicate: true };
    try {
      const done = await this.stripeEvent(event, rec.id);
      await this.closeReceipt(rec.id, done ? 'PROCESSED' : 'IGNORED');
      return done ? { received: true } : { received: true, ignored: true };
    } catch (e: any) {
      await this.closeReceipt(rec.id, 'FAILED', e?.message ?? String(e));
      throw e;
    }
  }

  private async stripeEvent(event: any, receiptId: string): Promise<boolean> {
    const env: 'TEST' | 'LIVE' = event.livemode ? 'LIVE' : 'TEST';
    const o: any = event.data.object;
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const own = await this.pendingPayment(o.metadata?.payment_id, 'STRIPE');
        if (!own) return false;
        await this.cards.recordFromIntent(own.customer_id, o);
        await this.finalize(own.id, {
          externalChargeId: typeof o.latest_charge === 'string' ? o.latest_charge : o.latest_charge?.id ?? o.id,
          amount: fromStripeAmount(o.amount_received, o.currency),
          currency: String(o.currency).toUpperCase(),
          eventAt: new Date(event.created * 1000),
          webhookReceiptId: receiptId,
        }, null);
        return true;
      }
      case 'payment_intent.processing': {
        const own = await this.pendingPayment(o.metadata?.payment_id, 'STRIPE');
        if (!own) return false;
        await this.markProcessing(own.id);
        return true;
      }
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled': {
        const own = await this.pendingPayment(o.metadata?.payment_id, 'STRIPE');
        // A declined card leaves the intent open for another attempt; only a delayed payment that failed, or a cancelled intent, ends it.
        if (!own || (event.type === 'payment_intent.payment_failed' && own.status !== 'PROCESSING')) return false;
        if (!['REQUIRES_ACTION', 'REQUIRES_PAYMENT_METHOD', 'PROCESSING', 'AUTHORIZED'].includes(own.status)) return false;
        await this.cancelLocally(own, event.type === 'payment_intent.canceled' ? 'PROVIDER_CANCELLED' : 'PROVIDER_DECLINED');
        await this.paymentFailedNotice(own.customer_id, own.id, 'tarjeta');
        return true;
      }
      case 'charge.refunded': {
        const refunds = await this.stripe.listRefunds(o.id);
        let any = false;
        for (const r of refunds) any = (await this.stripeRefund(r, env)) || any;
        return any;
      }
      case 'charge.refund.updated':
      case 'refund.created':
      case 'refund.updated':
        return this.stripeRefund(o, env);
      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed':
      case 'charge.dispute.funds_withdrawn':
      case 'charge.dispute.funds_reinstated':
        return (await this.incidents.dispute(this.stripeDispute(o, env))) === 'RECORDED';
      default:
        return false;
    }
  }

  private async stripeRefund(r: any, env: 'TEST' | 'LIVE') {
    if (r?.object !== 'refund' || r.status !== 'succeeded' || typeof r.charge !== 'string') return false;
    const res = await this.incidents.providerRefund({
      provider: 'STRIPE', environment: env, kind: 'EXTERNAL_REFUND', chargeId: r.charge, refundId: r.id,
      amount: fromStripeAmount(r.amount, r.currency), currency: String(r.currency).toUpperCase(),
      nxRefundId: r.metadata?.refund_id ?? null, createdAt: r.created ? new Date(r.created * 1000) : null,
    });
    return res !== 'UNKNOWN';
  }

  private stripeDispute(d: any, env: 'TEST' | 'LIVE'): DisputeEvent {
    const cur = String(d.currency).toUpperCase();
    return {
      provider: 'STRIPE', environment: env, disputeId: d.id, chargeId: typeof d.charge === 'string' ? d.charge : d.charge?.id,
      amountMinor: String(d.amount), currency: cur, reason: d.reason ?? null, status: d.status, providerStatus: d.status,
      balanceTransactions: (d.balance_transactions ?? []).filter((b: any) => b && typeof b === 'object').map((b: any) => ({
        id: b.id, kind: b.amount < 0 ? 'FUNDS_WITHDRAWN' : 'FUNDS_REINSTATED', principalMinor: String(Math.abs(b.amount)), feeMinor: String(Math.abs(b.fee ?? 0)),
        currencyCode: String(b.currency).toUpperCase(), createdAt: b.created ? new Date(b.created * 1000).toISOString() : null, reportingCategory: b.reporting_category ?? null,
      })),
      createdAt: d.created ? new Date(d.created * 1000) : null,
      dueBy: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null,
    };
  }

  /**
   * PayPal events NEXOVAX acts on (subscribe the webhook to these):
   *   CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED | PENDING | DENIED | DECLINED | REFUNDED | REVERSED,
   *   CUSTOMER.DISPUTE.CREATED | UPDATED | RESOLVED.
   */
  async handlePaypalWebhook(headers: Record<string, any>, event: any) {
    if (!(await this.paypal.verifyWebhook(headers, event)))
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Firma de webhook inválida.', HttpStatus.BAD_REQUEST);
    return this.processPaypalEvent(event);
  }

  /** Signature already verified by the caller. */
  async processPaypalEvent(event: any) {
    const rec = await this.receipt('PAYPAL', event.id, event.event_type, event);
    if (rec.status === 'PROCESSED') return { received: true, duplicate: true };
    try {
      const done = await this.paypalEvent(event, rec.id);
      await this.closeReceipt(rec.id, done ? 'PROCESSED' : 'IGNORED');
      return done ? { received: true } : { received: true, ignored: true };
    } catch (e: any) {
      await this.closeReceipt(rec.id, 'FAILED', e?.message ?? String(e));
      throw e;
    }
  }

  private async paypalEvent(event: any, receiptId: string): Promise<boolean> {
    const r = event.resource ?? {};
    const env = this.paypal.environment;
    switch (event.event_type) {
      case 'CHECKOUT.ORDER.APPROVED': {
        // The buyer approved but the browser never came back to capture: capture it here.
        const p = await this.db.one(
          `select p.id, p.status, p.customer_id, p.checkout_session_id from public.payments p join public.payment_provider_intents i on i.payment_id = p.id
            where p.provider_code = 'PAYPAL' and i.external_intent_id = $1 order by i.sequence_number desc limit 1`,
          [r.id],
        );
        if (!p || !['REQUIRES_ACTION', 'REQUIRES_PAYMENT_METHOD', 'AUTHORIZED'].includes(p.status)) return false;
        await this.capturePaypal(p.checkout_session_id, p.customer_id);
        return true;
      }
      case 'PAYMENT.CAPTURE.COMPLETED': {
        const own = await this.pendingPayment(r.custom_id, 'PAYPAL');
        if (!own) return false;
        await this.finalize(own.id, { externalChargeId: r.id, amount: Number(r.amount.value).toFixed(2), currency: r.amount.currency_code, eventAt: new Date(r.create_time ?? Date.now()), webhookReceiptId: receiptId }, null);
        return true;
      }
      case 'PAYMENT.CAPTURE.PENDING': {
        const own = await this.pendingPayment(r.custom_id, 'PAYPAL');
        if (!own) return false;
        await this.markProcessing(own.id);
        return true;
      }
      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.DECLINED': {
        const own = await this.pendingPayment(r.custom_id, 'PAYPAL');
        if (!own || !['REQUIRES_ACTION', 'REQUIRES_PAYMENT_METHOD', 'PROCESSING', 'AUTHORIZED'].includes(own.status)) return false;
        await this.cancelLocally(own, 'PROVIDER_DECLINED');
        await this.paymentFailedNotice(own.customer_id, own.id, 'PayPal');
        return true;
      }
      case 'PAYMENT.CAPTURE.REFUNDED':
      case 'PAYMENT.CAPTURE.REVERSED': {
        if (r.status && r.status !== 'COMPLETED') return false;
        const up = (r.links ?? []).find((l: any) => l.rel === 'up')?.href ?? '';
        const captureId = /\/captures\/([A-Z0-9]+)/.exec(up)?.[1];
        if (!captureId || !r.id || !r.amount) return false;
        const res = await this.incidents.providerRefund({
          provider: 'PAYPAL', environment: env, kind: event.event_type === 'PAYMENT.CAPTURE.REVERSED' ? 'PROVIDER_REVERSAL' : 'EXTERNAL_REFUND',
          chargeId: captureId, refundId: r.id, amount: Number(r.amount.value).toFixed(2), currency: r.amount.currency_code,
          nxRefundId: /^nx-refund-(.+)$/.exec(r.invoice_id ?? '')?.[1] ?? null, createdAt: r.create_time ? new Date(r.create_time) : null,
        });
        return res !== 'UNKNOWN';
      }
      case 'CUSTOMER.DISPUTE.CREATED':
      case 'CUSTOMER.DISPUTE.UPDATED':
      case 'CUSTOMER.DISPUTE.RESOLVED': {
        const ev = await this.paypalDispute(r, env);
        return ev ? (await this.incidents.dispute(ev)) === 'RECORDED' : false;
      }
      default:
        return false;
    }
  }

  /**
   * PayPal dispute → dispute-engine evidence. PayPal reports no balance movements, so they are
   * derived (stable ids): the disputed amount is held once the case leaves the inquiry stage
   * (claim / chargeback) and comes back if the store wins.
   */
  private async paypalDispute(r: any, env: 'TEST' | 'LIVE'): Promise<DisputeEvent | null> {
    const captureId = r.disputed_transactions?.[0]?.seller_transaction_id;
    if (!r.dispute_id || !captureId || !r.dispute_amount?.value) return null;
    const cur = String(r.dispute_amount.currency_code).toUpperCase();
    const minor = toMinor(r.dispute_amount.value).toString();
    const key = String(r.dispute_id).replace(/[^A-Za-z0-9]/g, '');
    const at = r.create_time ?? null;
    const W = { id: `txn_pp${key}w`, kind: 'FUNDS_WITHDRAWN' as const, principalMinor: minor, feeMinor: '0', currencyCode: cur, createdAt: at, reportingCategory: 'paypal_dispute_hold' };
    const R = { ...W, id: `txn_pp${key}r`, kind: 'FUNDS_REINSTATED' as const, createdAt: r.update_time ?? at, reportingCategory: 'paypal_dispute_release' };
    const inquiry = (r.dispute_life_cycle_stage ?? 'INQUIRY') === 'INQUIRY';
    const outcome = r.dispute_outcome?.outcome_code as string | undefined;
    let status: string;
    let txns: DisputeEvent['balanceTransactions'] = [];
    if (r.status !== 'RESOLVED') {
      status = inquiry ? (r.status === 'UNDER_REVIEW' ? 'warning_under_review' : 'warning_needs_response') : r.status === 'UNDER_REVIEW' ? 'under_review' : 'needs_response';
      if (!inquiry) txns = [W];
    } else if (['RESOLVED_BUYER_FAVOUR', 'ACCEPTED'].includes(outcome ?? '')) {
      // Settled in the inquiry with a refund the store issued: that refund carries the money, not the dispute.
      const p = inquiry ? await this.db.one(
        `select p.refunded_amount::text as refunded,
                (select coalesce(sum(i.amount),0)::text from public.nx_payment_incidents i where i.payment_id = p.id and i.kind = 'EXTERNAL_REFUND') as external
           from public.payment_charges c join public.payments p on p.id = c.payment_id where c.provider_code = 'PAYPAL' and c.external_charge_id = $1`, [captureId]) : null;
      if (p && toMinor(p.refunded) + toMinor(p.external) >= BigInt(minor)) status = 'warning_closed';
      else { status = 'lost'; txns = [W]; }
    } else if (inquiry) status = 'warning_closed';
    else { status = 'won'; txns = [W, R]; }
    return {
      provider: 'PAYPAL', environment: env, disputeId: r.dispute_id, chargeId: captureId, amountMinor: minor, currency: cur,
      reason: r.reason ? String(r.reason).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64) : null,
      status, providerStatus: [r.dispute_life_cycle_stage, r.status, outcome].filter(Boolean).join(' · '),
      balanceTransactions: txns, createdAt: at ? new Date(at) : null, dueBy: r.seller_response_due_date ? new Date(r.seller_response_due_date) : null,
    };
  }

  private async paymentFailedNotice(userId: string, paymentId: string, via: string) {
    await this.notifications.notify(userId, {
      category: 'PAYMENTS', eventType: 'PAYMENT_DECLINED', title: 'No se pudo completar tu pago',
      body: `El pago con ${via} fue rechazado y no se te cobró. Tus productos siguen en el carrito: puedes intentar de nuevo con otro medio de pago.`,
      localized: {
        en: { title: 'Your payment couldn’t be completed', body: `The ${via === 'tarjeta' ? 'card' : via} payment was declined and you weren’t charged. Your items are still in your cart: you can try again with another payment method.` },
        fr: { title: 'Votre paiement n’a pas pu être finalisé', body: `Le paiement par ${via === 'tarjeta' ? 'carte' : via} a été refusé et vous n’avez pas été débité. Vos articles sont toujours dans votre panier : vous pouvez réessayer avec un autre moyen de paiement.` },
        ht: { title: 'Peman ou pa t ka fini', body: `Peman ak ${via === 'tarjeta' ? 'kat' : via} la refize epi yo pa t retire lajan sou ou. Atik ou yo toujou nan panye ou: ou ka eseye ankò ak yon lòt metòd peman.` },
      },
      url: '/carrito', entityType: 'PAYMENT', entityId: paymentId, dedupeKey: `payment-declined:${paymentId}`,
    });
  }

  orderNumber(n: unknown) {
    return orderRef(n);
  }
}
