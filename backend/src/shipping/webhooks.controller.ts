import { Body, Controller, ForbiddenException, HttpCode, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/auth';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { OrdersService } from '../orders/orders.service';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Shippo webhooks. Configure in Shippo → Settings → Webhooks:
 *   URL  https://<api-host>/api/webhooks/shippo?token=<SHIPPO_WEBHOOK_TOKEN>   event: track_updated
 * Every delivery is stored in integration_webhook_receipts-style logs via the domain function.
 */
@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly orders: OrdersService,
    private readonly db: DbService,
  ) {}

  @Public()
  @Post('shippo')
  @HttpCode(200)
  async shippo(@Query('token') token: string, @Body() body: any) {
    if (!config.shippoWebhookToken || !token || !same(token, config.shippoWebhookToken)) throw new ForbiddenException();
    const event = body?.event;
    if (event !== 'track_updated') return { ignored: true };
    return this.orders.ingestShippoTrack(body);
  }
}
