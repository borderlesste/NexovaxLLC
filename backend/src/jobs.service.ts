import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from './db/db.service';
import { OrdersService } from './orders/orders.service';
import { config } from './config';
import { PayoutSchedulesService } from './seller/payout-schedules.service';

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
    private readonly payoutSchedules: PayoutSchedulesService,
  ) {}

  /** Automatic payouts chosen by sellers (weekly / biweekly / monthly). */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledPayouts() {
    if (process.env.DISABLE_JOBS === 'true') return;
    try {
      const n = await this.payoutSchedules.runDue();
      if (n) this.logger.log(`Scheduled payouts requested: ${n}`);
    } catch (e: any) {
      this.logger.warn(`scheduledPayouts: ${e.message}`);
    }
  }

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

  /** Carrier tracking safety net (webhooks are the primary channel). Test keys have no real carrier tracking. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async pollTracking() {
    if (process.env.DISABLE_JOBS === 'true' || !config.shippoApiKey || config.shippoApiKey.startsWith('shippo_test_')) return;
    try {
      const n = await this.orders.pollTracking();
      if (n) this.logger.log(`Tracking updated for ${n} shipments`);
    } catch (e: any) {
      this.logger.warn(`pollTracking: ${e.message}`);
    }
  }

  /** Closes manually tracked shipments the customer never confirmed (see AUTO_CONFIRM_DELIVERY_DAYS). */
  @Cron(CronExpression.EVERY_HOUR)
  async autoConfirmDeliveries() {
    if (process.env.DISABLE_JOBS === 'true') return;
    try {
      const n = await this.orders.autoConfirmManualDeliveries();
      if (n) this.logger.log(`Auto-confirmed deliveries: ${n}`);
    } catch (e: any) {
      this.logger.warn(`autoConfirmManualDeliveries: ${e.message}`);
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
