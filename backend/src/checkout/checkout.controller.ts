import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, RequestUser } from '../auth/auth';
import { CheckoutService } from './checkout.service';
import { DbService } from '../db/db.service';
import { notFound } from '../common/errors';

export class QuoteDto {
  @IsOptional() @IsObject() shipping?: Record<string, string>;
  @IsOptional() @IsUUID() addressId?: string;
}

export class CardDto {
  @IsString() @Length(12, 23) number: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) expMonth: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(2100) expYear: number;
  @IsString() @Length(3, 4) cvc: string;
  @IsString() @Length(2, 80) name: string;
}

export class PlaceOrderDto {
  @IsUUID() addressId: string;
  @IsObject() shipping: Record<string, string>;
  @IsIn(['CARD', 'BANK_TRANSFER']) paymentMethod: 'CARD' | 'BANK_TRANSFER';
  @IsOptional() @ValidateNested() @Type(() => CardDto) card?: CardDto;
  @IsString() @Length(8, 100) idempotencyKey: string;
}

@ApiTags('checkout')
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly db: DbService,
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
    return this.checkout.resultFor(id);
  }
}
