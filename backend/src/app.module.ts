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

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/media/') },
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController, CatalogController, MediaController, AccountController, CartController, CheckoutController],
  providers: [
    DbService,
    SettingsService,
    SupabaseAdminService,
    CatalogService,
    AccountService,
    CartService,
    CheckoutService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
