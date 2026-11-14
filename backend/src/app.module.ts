import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { DbService } from './db/db.service';
import { AuthGuard } from './auth/auth';
import { SettingsService } from './settings/settings.service';
import { SupabaseAdminService } from './storage/supabase-admin.service';
import { CatalogService } from './catalog/catalog.service';
import { CatalogController } from './catalog/catalog.controller';
import { MediaController } from './media/media.controller';
import { AccountService } from './account/account.service';
import { AccountController } from './account/account.controller';
import { CartService } from './cart/cart.service';
import { CartController } from './cart/cart.controller';
import { CheckoutService } from './checkout/checkout.service';
import { CheckoutController } from './checkout/checkout.controller';
import { HealthController } from './health.controller';
import { GeoController } from './geo/geo.controller';
import { OrdersService } from './orders/orders.service';
import { OrdersController } from './orders/orders.controller';
import { SellerService } from './seller/seller.service';
import { SellerController } from './seller/seller.controller';
import { MessagingService } from './messaging/messaging.service';
import { MessagingController } from './messaging/messaging.controller';
import { SupportService } from './support/support.service';
import { SupportController } from './support/support.controller';
import { AdminService } from './admin/admin.service';
import { AdminController } from './admin/admin.controller';
import { JobsService } from './jobs.service';
import { MailService } from './mail/mail.service';
import { TaxService } from './tax/tax.service';
import { ShippoService } from './shipping/shippo.service';
import { ShippingService } from './shipping/shipping.service';
import { WebhooksController } from './shipping/webhooks.controller';
import { StripeService } from './payments/stripe.service';
import { PaypalService } from './payments/paypal.service';
import { PaymentsService } from './payments/payments.service';
import { PaymentsWebhooksController } from './payments/payments.controller';
import { NotificationsService } from './notifications/notifications.service';
import { NotificationsController } from './notifications/notifications.controller';
import { ReturnsService } from './returns/returns.service';
import { ReturnsController } from './returns/returns.controller';
import { CardsService } from './payments/cards.service';
import { CardsController } from './payments/cards.controller';
import { PayoutSchedulesService } from './seller/payout-schedules.service';
import { PayoutSchedulesController } from './seller/payout-schedules.controller';
import { ShippingSettlementService } from './shipping/shipping-settlement.service';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        // Query strings can carry secrets (e.g. the Shippo webhook token) and personal data: never log them.
        serializers: {
          req: (req: any) => ({ id: req.id, method: req.method, url: String(req.url ?? '').split('?')[0], remoteAddress: req.remoteAddress }),
        },
        autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/media/') },
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController, GeoController, CatalogController, MediaController, AccountController, CartController, CheckoutController, OrdersController, SellerController, MessagingController, SupportController, AdminController, WebhooksController, PaymentsWebhooksController, NotificationsController, ReturnsController, CardsController, PayoutSchedulesController],
  providers: [
    DbService,
    SettingsService,
    SupabaseAdminService,
    CatalogService,
    AccountService,
    CartService,
    CheckoutService,
    OrdersService,
    SellerService,
    MessagingService,
    SupportService,
    AdminService,
    JobsService,
    MailService,
    TaxService,
    ShippoService,
    ShippingService,
    StripeService,
    PaypalService,
    PaymentsService,
    NotificationsService,
    ReturnsService,
    CardsService,
    PayoutSchedulesService,
    ShippingSettlementService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
