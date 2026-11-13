import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from './db/db.service';
import { OrdersService } from './orders/orders.service';

/**
 * Scheduled maintenance (in-process worker for the MVP):
 * expires abandoned checkouts/reservations and retries pending fund releases.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  constructor(
    private readonly db: DbService,
    private readonly orders: OrdersService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireCheckouts() {
    if (process.env.DISABLE_JOBS === 'true') return;
    try {
      const r = await this.db.tx((c) => this.db.one(`select public.expire_checkout_sessions(100) as n`, [], c));
      if (r?.n) this.logger.log(`Expired checkouts: ${r.n}`);
    } catch (e: any) {
      this.logger.warn(`expire_checkout_sessions: ${e.message}`);
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async releaseFunds() {
    if (process.env.DISABLE_JOBS === 'true') return;
    try {
      await this.orders.retryPendingReleases();
    } catch (e: any) {
      this.logger.warn(`retryPendingReleases: ${e.message}`);
    }
  }
}
