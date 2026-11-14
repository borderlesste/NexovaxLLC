import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Public } from '../auth/auth';
import { badRequest } from '../common/errors';
import { PaymentsService } from './payments.service';

/**
 * Payment provider webhooks (public, signature-verified):
 *   Stripe  → POST /api/stripe/webhook   events: payment_intent.succeeded
 *   PayPal  → POST /api/paypal/webhook   events: PAYMENT.CAPTURE.COMPLETED
 */
@ApiExcludeController()
@Controller()
export class PaymentsWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @SkipThrottle() // verified locally (HMAC) before any work; Stripe retries bursts
  @Post('stripe/webhook')
  @HttpCode(200)
  stripe(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    if (!req.rawBody || !signature) throw badRequest('WEBHOOK_SIGNATURE_INVALID', 'Firma de webhook inválida.');
    return this.payments.handleStripeWebhook(req.rawBody, signature);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } }) // each delivery costs an outbound verification call
  @Post('paypal/webhook')
  @HttpCode(200)
  paypal(@Headers() headers: Record<string, string>, @Body() body: any) {
    return this.payments.handlePaypalWebhook(headers, body);
  }
}
