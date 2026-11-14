import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import { AppError } from '../common/errors';

/** PayPal REST (Orders v2) — create, capture and webhook verification. */
@Injectable()
export class PaypalService {
  private readonly logger = new Logger(PaypalService.name);
  private token?: { value: string; exp: number };

  get enabled() {
    return !!config.paypalClientId && !!config.paypalClientSecret;
  }

  get environment(): 'TEST' | 'LIVE' {
    return config.paypalEnv === 'live' ? 'LIVE' : 'TEST';
  }

  private get base() {
    return config.paypalEnv === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  }

  private async accessToken() {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    if (!this.enabled) throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'El procesador de pagos no está disponible.', HttpStatus.SERVICE_UNAVAILABLE);
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15_000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError('PAYMENT_PROVIDER_ERROR', 'PayPal no respondió. Inténtalo de nuevo.', HttpStatus.BAD_GATEWAY, { provider: body?.error_description });
    this.token = { value: body.access_token, exp: Date.now() + Number(body.expires_in ?? 300) * 1000 };
    return this.token.value;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const issue = data?.details?.[0]?.issue ?? data?.name;
      this.logger.warn(`PayPal ${method} ${path}: ${res.status} ${issue}`);
      if (issue === 'INSTRUMENT_DECLINED' || issue === 'PAYER_ACTION_REQUIRED')
        throw new AppError('PAYMENT_DECLINED', 'PayPal rechazó el método de pago. Elige otro método en PayPal.', HttpStatus.PAYMENT_REQUIRED, { issue });
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'PayPal no pudo procesar la operación.', HttpStatus.BAD_GATEWAY, { issue });
    }
    return data as T;
  }

  createOrder(input: { amount: string; currency: string; paymentId: string; reference: string; description: string }) {
    return this.call<any>(
      'POST',
      '/v2/checkout/orders',
      {
        intent: 'CAPTURE',
        purchase_units: [{ reference_id: input.reference, custom_id: input.paymentId, description: input.description.slice(0, 127), amount: { currency_code: input.currency, value: Number(input.amount).toFixed(2) } }],
        payment_source: { paypal: { experience_context: { brand_name: 'NEXOVAX', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } } },
      },
      { 'PayPal-Request-Id': `nx-order-${input.paymentId}` },
    );
  }

  getOrder(id: string) {
    return this.call<any>('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`);
  }

  captureOrder(id: string, paymentId: string) {
    return this.call<any>('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, { 'PayPal-Request-Id': `nx-capture-${paymentId}` });
  }

  /** Refunds (part of) a captured payment. Idempotent per refund id. */
  refundCapture(captureId: string, amount: string, currency: string, refundId: string, note: string) {
    return this.call<any>(
      'POST',
      `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
      { amount: { value: Number(amount).toFixed(2), currency_code: currency }, invoice_id: `nx-refund-${refundId}`, note_to_payer: note.slice(0, 255) },
      { 'PayPal-Request-Id': `nx-refund-${refundId}` },
    );
  }

  async verifyWebhook(headers: Record<string, any>, event: unknown) {
    if (!config.paypalWebhookId) return false;
    // Reject obviously forged/incomplete deliveries before any outbound call to PayPal.
    const required = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
    if (required.some((h) => typeof headers[h] !== 'string' || !headers[h] || headers[h].length > 2048)) return false;
    try {
      const cert = new URL(headers['paypal-cert-url']);
      if (cert.protocol !== 'https:' || !(cert.hostname === 'paypal.com' || cert.hostname.endsWith('.paypal.com'))) return false;
    } catch {
      return false;
    }
    const sent = Date.parse(headers['paypal-transmission-time']);
    if (!Number.isFinite(sent) || Math.abs(Date.now() - sent) > 24 * 3600_000) return false;
    if (!event || typeof event !== 'object' || typeof (event as any).id !== 'string') return false;
    const r = await this.call<any>('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: config.paypalWebhookId,
      webhook_event: event,
    });
    return r?.verification_status === 'SUCCESS';
  }
}
