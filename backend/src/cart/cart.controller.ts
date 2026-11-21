import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { ToNumber } from '../common/validators';
import { Type } from 'class-transformer';
import { CurrentUser, Public, RequestUser } from '../auth/auth';
import { CartService, MAX_GUEST_LINES } from './cart.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AlertsService } from '../analytics/alerts.service';
import { DbService } from '../db/db.service';

export class AddCartItemDto {
  @IsUUID() variantId: string;
  @ToNumber() @IsInt({ message: 'La cantidad debe ser un número entero.' }) @Min(1) @Max(999) quantity: number;
}

export class GuestCartDto {
  @IsArray() @ArrayMaxSize(MAX_GUEST_LINES) @ValidateNested({ each: true }) @Type(() => AddCartItemDto) items: AddCartItemDto[];
}

export class UpdateCartItemDto {
  @ToNumber() @IsInt({ message: 'La cantidad debe ser un número entero.' }) @Min(1) @Max(999) quantity: number;
}

@ApiTags('cart')
@Controller('cart')
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly analytics: AnalyticsService,
    private readonly db: DbService,
    private readonly alerts: AlertsService,
  ) {}

  @Get()
  get(@CurrentUser() user: RequestUser) {
    return this.cart.getCart(user.id);
  }

  /** Guest cart (kept in the visitor's browser): prices and availability without an account. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('preview')
  preview(@Body() dto: GuestCartDto) {
    return this.cart.preview(dto.items);
  }

  /** After sign-in: adds the guest cart to the account's cart. */
  @Post('merge')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  merge(@CurrentUser() user: RequestUser, @Body() dto: GuestCartDto) {
    return this.cart.merge(user.id, dto.items);
  }

  @Post('items')
  async add(@CurrentUser() user: RequestUser, @Body() dto: AddCartItemDto, @Headers('x-nx-consent') consent?: string) {
    const cart = await this.cart.addItem(user.id, dto.variantId, dto.quantity, 'add');
    const v = await this.db.one<{ product_id: string }>(`select product_id from public.product_variants where id = $1`, [dto.variantId]);
    if (v) {
      void this.analytics.recordServer('ADD_TO_CART', v.product_id, user.id, consent === 'analytics');
      await this.alerts.watch(user.id, v.product_id, 'CART');
    }
    return cart;
  }

  @Put('items/:id')
  update(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCartItemDto) {
    return this.cart.updateItem(user.id, id, dto.quantity);
  }

  @Delete('items/:id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cart.removeItem(user.id, id);
  }

  @Delete()
  clear(@CurrentUser() user: RequestUser) {
    return this.cart.clear(user.id);
  }
}
