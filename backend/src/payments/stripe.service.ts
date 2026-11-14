import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { config } from '../config';
import { AppError } from '../common/errors';
import { toMinor } from '../common/money';

/** Zero-decimal currencies for Stripe amounts (https://docs.stripe.com/currencies#zero-decimal). */
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

export const toStripeAmount = (amount: string, currency: string) =>
  ZERO_DECIMAL.has(currency.toUpperCase()) ? Number(BigInt(toMinor(amount)) / 100n) : Number(toMinor(amount));
export const fromStripeAmount = (amount: number, currency: string) =>
  ZERO_DECIMAL.has(currency.toUpperCase()) ? amount.toFixed(2) : (amount / 100).toFixed(2);

/** Stripe Payment Intents for card payments (card data never touches our servers). */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private client?: Stripe;

  get enabled() {
    return !!config.stripeSecretKey && !!config.stripePublishableKey;
  }

  get environment(): 'TEST' | 'LIVE' {
    return config.stripeSecretKey?.startsWith('sk_live_') ? 'LIVE' : 'TEST';
  }

  private get stripe() {
    if (!config.stripeSecretKey) throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'El procesador de pagos no está disponible.', HttpStatus.SERVICE_UNAVAILABLE);
    this.client ??= new Stripe(config.stripeSecretKey, { apiVersion: '2025-02-24.acacia', maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: 'NEXOVAX' } });
    return this.client;
  }

  async createIntent(input: { amount: string; currency: string; paymentId: string; checkoutId: string; customerEmail?: string; description: string; customerId?: string; saveCard?: boolean; paymentMethodId?: string }) {
    return this.stripe.paymentIntents.create(
      {
        amount: toStripeAmount(input.amount, input.currency),
        currency: input.currency.toLowerCase(),
        payment_method_types: ['card'],
        description: input.description,
        receipt_email: input.customerEmail,
        ...(input.customerId ? { customer: input.customerId } : {}),
        ...(input.saveCard && input.customerId ? { setup_future_usage: 'on_session' as const } : {}),
        ...(input.paymentMethodId ? { payment_method: input.paymentMethodId } : {}),
        metadata: { payment_id: input.paymentId, checkout_id: input.checkoutId, platform: 'nexovax', ...(input.saveCard ? { save_card: '1' } : {}) },
      },
      { idempotencyKey: `nx-pi-${input.paymentId}` },
    );
  }

  retrieveIntent(id: string) {
    return this.stripe.paymentIntents.retrieve(id, { expand: ['latest_charge.balance_transaction'] });
  }

  /**
   * Cancels a PaymentIntent and returns its authoritative state. When Stripe
   * refuses (e.g. it was captured in the meantime) the intent is re-read so the
   * caller decides from the real status instead of assuming it was cancelled.
   */
  async cancelIntent(id: string): Promise<Stripe.PaymentIntent> {
    try {
      return await this.stripe.paymentIntents.cancel(id, undefined, { idempotencyKey: `nx-pi-cancel-${id}` });
    } catch (e: any) {
      this.logger.warn(`Stripe cancel ${id}: ${e?.message}`);
      return this.retrieveIntent(id);
    }
  }

  // ---- saved cards (Stripe customers + payment methods; card data stays in Stripe)
  createCustomer(input: { email: string; name?: string; userId: string; environment: string }) {
    return this.stripe.customers.create(
      { email: input.email, name: input.name, metadata: { user_id: input.userId, platform: 'nexovax' } },
      { idempotencyKey: `nx-cus-${input.userId}-${input.environment}` },
    );
  }

  createSetupIntent(customerId: string) {
    return this.stripe.setupIntents.create({ customer: customerId, usage: 'on_session', payment_method_types: ['card'], metadata: { platform: 'nexovax' } });
  }

  retrieveSetupIntent(id: string) {
    return this.stripe.setupIntents.retrieve(id);
  }

  retrievePaymentMethod(id: string) {
    return this.stripe.paymentMethods.retrieve(id);
  }

  async detachPaymentMethod(id: string) {
    try {
      await this.stripe.paymentMethods.detach(id);
    } catch (e: any) {
      // Already detached / deleted in Stripe: the local reference is removed anyway.
      if (e?.code !== 'resource_missing' && !/not attached/i.test(e?.message ?? '')) throw e;
    }
  }

  /** Refunds (part of) a captured card payment. Idempotent per refund id. */
  refund(input: { chargeOrIntent: string; amount: string; currency: string; refundId: string; reason?: 'requested_by_customer' | 'duplicate' | 'fraudulent' }) {
    const target = input.chargeOrIntent.startsWith('pi_') ? { payment_intent: input.chargeOrIntent } : { charge: input.chargeOrIntent };
    return this.stripe.refunds.create(
      { ...target, amount: toStripeAmount(input.amount, input.currency), reason: input.reason ?? 'requested_by_customer', metadata: { refund_id: input.refundId, platform: 'nexovax' } },
      { idempotencyKey: `nx-refund-${input.refundId}` },
    );
  }

  /** Verifies a webhook signature against any configured endpoint secret. */
  constructEvent(raw: Buffer, signature: string): Stripe.Event {
    let last: any;
    for (const secret of config.stripeWebhookSecrets) {
      try {
        return this.stripe.webhooks.constructEvent(raw, signature, secret);
      } catch (e) {
        last = e;
      }
    }
    throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Firma de webhook inválida.', HttpStatus.BAD_REQUEST, { reason: last?.message });
  }
}
