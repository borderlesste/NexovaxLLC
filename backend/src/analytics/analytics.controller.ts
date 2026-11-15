import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { CurrentUser, Public, RequestUser, requireSeller } from '../auth/auth';
import { AnalyticsService } from './analytics.service';
import { AlertsService } from './alerts.service';

class EventDto {
  @IsIn(['VIEW']) type: 'VIEW';
  @IsUUID() productId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3600000) dwellMs?: number;
  @IsOptional() @IsString() @IsIn(['DIRECT', 'SEARCH', 'CATALOG', 'STORE', 'HOME', 'PRODUCT', 'EXTERNAL', 'AFFILIATE']) source?: string;
}
export class AlertDto {
  @IsUUID() productId: string;
  @IsOptional() @IsUUID() variantId?: string;
}
export class EventsDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => EventDto) events: EventDto[];
  @IsOptional() @IsUUID() visitorId?: string;
}

@ApiTags('analytics')
@Controller()
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly alerts: AlertsService,
  ) {}

  // ---- buyer alerts (back in stock)
  @Get('me/alerts')
  myAlerts(@CurrentUser() u: RequestUser, @Query('productId') productId?: string) {
    return this.alerts.list(u.id, productId && /^[0-9a-f-]{36}$/i.test(productId) ? productId : undefined);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('me/alerts')
  createAlert(@CurrentUser() u: RequestUser, @Body() dto: AlertDto) {
    return this.alerts.create(u.id, dto.productId, dto.variantId);
  }

  @Delete('me/alerts/:id')
  cancelAlert(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.cancel(u.id, id);
  }

  /** Browser beacons. Identity is kept only when the visitor accepted analytics cookies. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('events')
  events(@CurrentUser() u: RequestUser | undefined, @Body() dto: EventsDto, @Headers('x-nx-consent') consent?: string, @Headers('user-agent') ua?: string) {
    return this.analytics.record(dto.events, { userId: u?.id ?? null, visitorId: dto.visitorId ?? null, consent: consent === 'analytics', userAgent: ua });
  }

  @Get('seller/analytics')
  stats(@CurrentUser() u: RequestUser, @Query('days') days?: string, @Headers('x-seller-id') h?: string) {
    const d = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
    return this.analytics.sellerStats(requireSeller(u, h).id, d);
  }
}
