import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from './db/db.service';
import { OrdersService } from './orders/orders.service';
import { config } from './config';
import { PayoutSchedulesService } from './seller/payout-schedules.service';
import { ShippingSettlementService } from './shipping/shipping-settlement.service';
import { AffiliatesService } from './promotions/affiliates.service';
import { AnalyticsService } from './analytics/analytics.service';
import { AlertsService } from './analytics/alerts.service';
import { RecommendationsService } from './analytics/recommendations.service';
import { PoliciesService } from './account/policies.service';
import { StripeTaxService } from './tax/stripe-tax.service';

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
    private readonly shippingSettlement: ShippingSettlementService,
    private readonly affiliates: AffiliatesService,
    private readonly analytics: AnalyticsService,
    private readonly alerts: AlertsService,
    private readonly recommendations: RecommendationsService,
    private readonly policies: PoliciesService,
    private readonly stripeTax: StripeTaxService,
  ) {}

  /** Stripe Tax: record paid orders and refunds in Stripe's tax reports (retry). */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async syncStripeTax() {
    if (process.env.DISABLE_JOBS === 'true') return;
    try {
      const n = await this.stripeTax.sync();
      if (n) this.logger.log(`Stripe Tax refunds reversed: ${n}`);
    } catch (e: any) {
      this.logger.warn(`syncStripeTax: ${e.message}`);
    }
  }

  /** Shipping settlements that failed at dispatch time (retry). */
  @Cron(CronExpression.EVERY_HOUR)
  async settleShipping() {
    if (process.env.DISABLE_JOBS === 'true') return;
    try {
      const n = await this.shippingSettlement.settlePending();
      if (n) this.logger.log(`Shipping settlements posted: ${n}`);
    } catch (e: any) {
      this.logger.warn(`settleShipping: ${e.message}`);
    }
  }

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

  /** Legal policies scheduled for a date take effect (every 5 minutes). */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledPolicies() {
    if (process.env.DISABLE_JOBS === 'true') return;
    try {
      const n = await this.policies.publishDue();
      if (n) this.logger.log(`Scheduled policies published: ${n}`);
    } catch (e: any) {
      this.logger.warn(`scheduled policies: ${e.message}`);
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

  /** Product analytics: roll today's and yesterday's events into daily totals. */
  @Cron(CronExpression.EVERY_HOUR)
  async productAnalytics() {
    if (process.env.DISABLE_JOBS === 'true') return;
    try {
      await this.analytics.aggregate(1);
    } catch (e: any) {
      this.logger.warn(`productAnalytics: ${e.message}`);
    }
  }

  /** Buyer alerts: back in stock and price drops on favorites / cart. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async productAlerts() {
    if (process.env.DISABLE_JOBS === 'true') return;
    try {
      const r = await this.alerts.scan();
      if (r.stock || r.price) this.logger.log(`Product alerts: ${r.stock} back in stock, ${r.price} price drops`);
    } catch (e: any) {
      this.logger.warn(`productAlerts: ${e.message}`);
    }
  }

  /** Recommendation model: co-views, co-purchases and popularity. */
  @Cron(CronExpression.EVERY_6_HOURS)
  async rebuildRecommendations() {
    if (process.env.DISABLE_JOBS === 'true') return;
    try {
      await this.analytics.aggregate(1);
      const r = await this.recommendations.rebuild(90);
      this.logger.log(`Recommendations rebuilt: ${JSON.stringify(r)}`);
    } catch (e: any) {
      this.logger.warn(`rebuildRecommendations: ${e.message}`);
    }
  }

  /** Raw browsing events are kept 90 days; daily totals stay. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeAnalytics() {
    if (process.env.DISABLE_JOBS === 'true') return;
    try {
      const n = await this.analytics.purge(90);
      if (n) this.logger.log(`Analytics events purged: ${n}`);
    } catch (e: any) {
      this.logger.warn(`purgeAnalytics: ${e.message}`);
    }
  }

  /** Affiliate earnings: notify new ones, release those past delivery + return window. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async affiliateEarnings() {
    if (process.env.DISABLE_JOBS === 'true') return;
    try {
      const r = await this.affiliates.processDue();
      if (r.released) this.logger.log(`Affiliate earnings released: ${r.released}`);
    } catch (e: any) {
      this.logger.warn(`affiliateEarnings: ${e.message}`);
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
