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

  async createIntent(input: { amount: string; currency: string; paymentId: string; checkoutId: string; customerEmail?: string; description: string }) {
    return this.stripe.paymentIntents.create(
      {
        amount: toStripeAmount(input.amount, input.currency),
        currency: input.currency.toLowerCase(),
        payment_method_types: ['card'],
        description: input.description,
        receipt_email: input.customerEmail,
        metadata: { payment_id: input.paymentId, checkout_id: input.checkoutId, platform: 'nexovax' },
      },
      { idempotencyKey: `nx-pi-${input.paymentId}` },
    );
  }

  retrieveIntent(id: string) {
    return this.stripe.paymentIntents.retrieve(id, { expand: ['latest_charge.balance_transaction'] });
  }

  async cancelIntent(id: string) {
    try {
      await this.stripe.paymentIntents.cancel(id);
    } catch (e: any) {
      this.logger.warn(`Stripe cancel ${id}: ${e?.message}`);
    }
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
