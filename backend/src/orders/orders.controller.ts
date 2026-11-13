import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, RequestUser } from '../auth/auth';
import { OrdersService } from './orders.service';
import { DbService } from '../db/db.service';
import { conflict, notFound } from '../common/errors';

export class ReviewDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5) rating: number;
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) body?: string;
}

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly db: DbService,
  ) {}

  @Get()
  async list(@CurrentUser() user: RequestUser, @Query() q: Record<string, string>) {
    return this.orders.list({ kind: 'customer', userId: user.id }, { status: q.status, page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20 });
  }

  @Get(':id')
  detail(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.orders.detail({ kind: 'customer', userId: user.id }, id);
  }

  @Post('shipments/:id/confirm-delivery')
  confirmDelivery(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.updateTracking({ kind: 'customer', userId: user.id }, id, 'DELIVERED');
  }

  @Post('items/:itemId/review')
  async review(@CurrentUser() user: RequestUser, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: ReviewDto) {
    const item = await this.db.one(
      `select oi.id, oi.product_id, oi.seller_id, oi.delivered_quantity from public.order_items oi
         join public.orders o on o.id = oi.order_id where oi.id = $1 and o.customer_id = $2`,
      [itemId, user.id],
    );
    if (!item) throw notFound('Artículo');
    if (Number(item.delivered_quantity) <= 0) throw conflict('NOT_DELIVERED', 'Podrás opinar cuando recibas el producto.');
    await this.db.exec(
      `insert into public.product_reviews (product_id, seller_id, order_item_id, user_id, rating, title, body)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (order_item_id) do update set rating = excluded.rating, title = excluded.title, body = excluded.body, updated_at = now()`,
      [item.product_id, item.seller_id, item.id, user.id, dto.rating, dto.title?.trim() || null, dto.body?.trim() || null],
    );
    return { ok: true };
  }
}
