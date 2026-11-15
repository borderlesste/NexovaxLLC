import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { CurrentUser, Public, RequestUser, requireSeller } from '../auth/auth';
import { AnalyticsService } from './analytics.service';

class EventDto {
  @IsIn(['VIEW']) type: 'VIEW';
  @IsUUID() productId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3600000) dwellMs?: number;
  @IsOptional() @IsString() @IsIn(['DIRECT', 'SEARCH', 'CATALOG', 'STORE', 'HOME', 'PRODUCT', 'EXTERNAL', 'AFFILIATE']) source?: string;
}
export class EventsDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => EventDto) events: EventDto[];
  @IsOptional() @IsUUID() visitorId?: string;
}

@ApiTags('analytics')
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

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
