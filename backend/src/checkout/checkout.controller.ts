import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { IsPersonName, ToNumber } from '../common/validators';
import { Transform, Type } from 'class-transformer';
import { CurrentUser, RequestUser } from '../auth/auth';
import { CheckoutService } from './checkout.service';
import { DbService } from '../db/db.service';
import { notFound } from '../common/errors';
import { PaymentsService } from '../payments/payments.service';

export class QuoteDto {
  @IsOptional() @IsObject() shipping?: Record<string, string>;
  @IsOptional() @IsUUID() addressId?: string;
}

export class CardDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') : value)) @Matches(/^\d{12,19}$/, { message: 'Número de tarjeta inválido.' }) number: string;
  @ToNumber() @IsInt() @Min(1) @Max(12) expMonth: number;
  @ToNumber() @IsInt() @Min(2000) @Max(2100) expYear: number;
  @Matches(/^\d{3,4}$/, { message: 'CVC inválido.' }) cvc: string;
  @IsPersonName(2, 80) name: string;
}

export class PlaceOrderDto {
  @IsUUID() addressId: string;
  @IsObject() shipping: Record<string, string>;
  @IsIn(['CARD', 'PAYPAL', 'BANK_TRANSFER']) paymentMethod: 'CARD' | 'PAYPAL' | 'BANK_TRANSFER';
  @IsOptional() @ValidateNested() @Type(() => CardDto) card?: CardDto;
  @IsOptional() @IsBoolean() saveCard?: boolean;
  @IsOptional() @IsUUID() savedCardId?: string;
  @IsString() @Length(8, 100) idempotencyKey: string;
}

@ApiTags('checkout')
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly db: DbService,
    private readonly payments: PaymentsService,
  ) {}

  @Post('quote')
  quote(@CurrentUser() user: RequestUser, @Body() dto: QuoteDto) {
    return this.checkout.quote(user.id, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('place')
  place(@CurrentUser() user: RequestUser, @Body() dto: PlaceOrderDto) {
    return this.checkout.placeOrder(user.id, dto);
  }

  @Get(':id')
  async result(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    const own = await this.db.one(`select 1 from public.checkout_sessions where id = $1 and customer_id = $2`, [id, user.id]);
    if (!own) throw notFound('Compra');
    return this.checkout.resultFor(id, user.id);
  }

  /** After stripe.confirmPayment in the browser: verifies the PaymentIntent with Stripe and creates the order. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/payments/stripe/confirm')
  confirmStripe(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.confirmStripe(id, user.id);
  }

  /** PayPal onApprove: captures the order with PayPal and creates the marketplace order. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/payments/paypal/capture')
  capturePaypal(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.capturePaypal(id, user.id);
  }

  /** Cancels an unpaid card/PayPal payment and releases the reserved stock. */
  @Post(':id/cancel')
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.cancelPending(id, user.id);
  }
}
