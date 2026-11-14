import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { AppError, conflict, notFound } from '../common/errors';
import { fromMinor, toMinor } from '../common/money';
import { postSaleAllocation } from '../checkout/sale-ledger';
import { MailService } from '../mail/mail.service';
import { orderRef } from '../common/refs';
import { fromStripeAmount, StripeService } from './stripe.service';
import { PaypalService } from './paypal.service';

export type ProviderCode = 'STRIPE' | 'PAYPAL' | 'RD_SANDBOX';

/** Card/PayPal payments are short-lived; bank transfers keep the reservation longer. */
export const ONLINE_PAYMENT_TTL_MIN = 30;

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
  ) {}

  providerFor(method: 'CARD' | 'PAYPAL' | 'BANK_TRANSFER'): { code: ProviderCode; environment: 'TEST' | 'LIVE' } | null {
    if (method === 'CARD') return this.stripe.enabled ? { code: 'STRIPE', environment: this.stripe.environment } : null;
    if (method === 'PAYPAL') return this.paypal.enabled ? { code: 'PAYPAL', environment: this.paypal.environment } : null;
    return null;
  }

  /** Inside the checkout transaction: creates the provider intent and leaves the payment REQUIRES_ACTION. */
  async startProviderPayment(c: PoolClient, input: { paymentId: string; checkoutId: string; provider: ProviderCode; amount: string; currency: string; customerEmail?: string; reference: string; corr: string }) {
    if (input.provider === 'STRIPE') {
      const pi = await this.stripe.createIntent({
        amount: input.amount, currency: input.currency, paymentId: input.paymentId, checkoutId: input.checkoutId,
        customerEmail: input.customerEmail, description: `NEXOVAX ${input.reference}`,
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
      `select p.id, p.status, p.provider_code, p.order_id, p.expected_amount::text as amount, p.currency_code, p.customer_id, p.checkout_session_id,
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
      return { orderId: r!.order_id as string, created: true };
    });
    if (result.created) this.mail.fire(() => this.mail.orderConfirmed(result.orderId));
    return result.orderId;
  }

  /**
   * Cancels an unpaid online payment (buyer left or wants to edit the cart).
   * Never cancels a payment the provider already captured: that one is finalized instead.
   */
  async cancelPending(checkoutId: string, userId: string | null, reason = 'CUSTOMER_ABANDONED') {
    const p = await this.paymentForCheckout(checkoutId, userId);
    if (p.status === 'PAID') return { status: 'PAID', orderId: p.order_id };
    if (!['REQUIRES_ACTION', 'REQUIRES_PAYMENT_METHOD'].includes(p.status) || !['STRIPE', 'PAYPAL'].includes(p.provider_code)) return { status: p.status };
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
    await this.db.tx(async (c) => {
      await this.db.exec(`select public.cancel_unpaid_payment($1,$2,$3,$4)`, [p.id, reason, p.customer_id, randomUUID()], c);
      const cs = await this.db.one(`select status from public.checkout_sessions where id = $1`, [p.checkout_session_id], c);
      if (cs && !['CANCELLED', 'COMPLETED', 'EXPIRED', 'FAILED'].includes(cs.status))
        await this.db.exec(`select public.cancel_checkout_session($1,$2,$3,null)`, [p.checkout_session_id, p.customer_id, reason], c).catch(() => undefined);
    });
    return { status: 'CANCELLED' };
  }

  /** Releases abandoned card/PayPal payments of a buyer so the cart can be edited again. */
  async releaseAbandoned(userId: string) {
    const rows = await this.db.many(
      `select p.checkout_session_id from public.payments p
        where p.customer_id = $1 and p.provider_code in ('STRIPE','PAYPAL') and p.status in ('REQUIRES_ACTION','REQUIRES_PAYMENT_METHOD')`,
      [userId],
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

  async handleStripeWebhook(raw: Buffer, signature: string) {
    const event = this.stripe.constructEvent(raw, signature);
    const rec = await this.receipt('STRIPE', event.id, event.type, event);
    if (rec.status === 'PROCESSED') return { received: true, duplicate: true };
    try {
      if (event.type === 'payment_intent.succeeded') {
        const pi: any = event.data.object;
        const paymentId = pi.metadata?.payment_id;
        const own = paymentId ? await this.db.one(`select id from public.payments where id = $1 and provider_code = 'STRIPE'`, [paymentId]) : null;
        if (!own) {
          await this.closeReceipt(rec.id, 'IGNORED');
          return { received: true, ignored: true };
        }
        await this.finalize(paymentId, {
          externalChargeId: typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? pi.id,
          amount: fromStripeAmount(pi.amount_received, pi.currency),
          currency: String(pi.currency).toUpperCase(),
          eventAt: new Date(event.created * 1000),
          webhookReceiptId: rec.id,
        }, null);
        await this.closeReceipt(rec.id, 'PROCESSED');
      } else {
        await this.closeReceipt(rec.id, 'IGNORED');
      }
      return { received: true };
    } catch (e: any) {
      await this.closeReceipt(rec.id, 'FAILED', e?.message ?? String(e));
      throw e;
    }
  }

  async handlePaypalWebhook(headers: Record<string, any>, event: any) {
    if (!(await this.paypal.verifyWebhook(headers, event)))
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Firma de webhook inválida.', HttpStatus.BAD_REQUEST);
    const rec = await this.receipt('PAYPAL', event.id, event.event_type, event);
    if (rec.status === 'PROCESSED') return { received: true, duplicate: true };
    try {
      if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        const cap = event.resource;
        const paymentId = cap?.custom_id;
        const own = paymentId ? await this.db.one(`select id from public.payments where id = $1 and provider_code = 'PAYPAL'`, [paymentId]) : null;
        if (own) {
          await this.finalize(paymentId, { externalChargeId: cap.id, amount: Number(cap.amount.value).toFixed(2), currency: cap.amount.currency_code, eventAt: new Date(cap.create_time ?? Date.now()), webhookReceiptId: rec.id }, null);
          await this.closeReceipt(rec.id, 'PROCESSED');
          return { received: true };
        }
      }
      await this.closeReceipt(rec.id, 'IGNORED');
      return { received: true, ignored: true };
    } catch (e: any) {
      await this.closeReceipt(rec.id, 'FAILED', e?.message ?? String(e));
      throw e;
    }
  }

  orderNumber(n: unknown) {
    return orderRef(n);
  }
}
