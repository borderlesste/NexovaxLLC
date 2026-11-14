import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { CurrentUser, Public, RequestUser, Roles, requireSeller } from '../auth/auth';
import { CouponsService } from './coupons.service';
import { AffiliatesService } from './affiliates.service';

export class CouponDto {
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{2,23}$/, { message: 'El código debe tener de 3 a 24 caracteres: letras, números, guion o guion bajo.' }) code: string;
  @IsIn(['PERCENT', 'FIXED']) type: 'PERCENT' | 'FIXED';
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100000) value: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000) minSubtotal?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1000000) maxDiscount?: number | null;
  @IsOptional() @IsString() @Length(10, 40) startsAt?: string | null;
  @IsOptional() @IsString() @Length(10, 40) endsAt?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) maxRedemptions?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) perCustomer?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) productIds?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}
export class ActiveDto {
  @IsBoolean() active: boolean;
}
export class ProgramDto {
  @IsBoolean() enabled: boolean;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.5) @Max(50) ratePercent: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(90) windowDays: number;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) productIds?: string[];
}
export class TrackDto {
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) codes: string[];
}
class BankDto {
  @IsOptional() @IsString() @Length(0, 80) holderName?: string;
  @IsOptional() @IsString() @Length(0, 80) bankName?: string;
  @IsOptional() @IsString() @Length(0, 40) accountNumber?: string;
  @IsOptional() @IsString() @Length(0, 20) accountType?: string;
  @IsOptional() @IsString() @Length(0, 20) routingCode?: string;
  @IsOptional() @IsString() @Length(0, 2) country?: string;
}
export class PayoutProfileDto {
  @IsIn(['PAYPAL', 'BANK']) method: 'PAYPAL' | 'BANK';
  @IsOptional() @IsString() @Length(0, 254) paypalEmail?: string;
  @IsOptional() @ValidateNested() @Type(() => BankDto) bank?: BankDto;
}
export class PayAffiliateDto {
  @IsString() @Length(3, 80) reference: string;
}

@ApiTags('promotions')
@Controller()
export class PromotionsController {
  constructor(
    private readonly coupons: CouponsService,
    private readonly affiliates: AffiliatesService,
  ) {}

  // ---- seller: coupons
  @Get('seller/coupons')
  coupons_(@CurrentUser() u: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.coupons.list(requireSeller(u, h).id);
  }

  @Post('seller/coupons')
  createCoupon(@CurrentUser() u: RequestUser, @Body() dto: CouponDto, @Headers('x-seller-id') h?: string) {
    return this.coupons.create(u, requireSeller(u, h).id, dto);
  }

  @Put('seller/coupons/:id')
  updateCoupon(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CouponDto, @Headers('x-seller-id') h?: string) {
    return this.coupons.update(u, requireSeller(u, h).id, id, dto);
  }

  @Post('seller/coupons/:id/active')
  toggleCoupon(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ActiveDto, @Headers('x-seller-id') h?: string) {
    return this.coupons.setActive(requireSeller(u, h).id, id, dto.active);
  }

  @Delete('seller/coupons/:id')
  removeCoupon(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.coupons.remove(requireSeller(u, h).id, id);
  }

  // ---- seller: affiliate program
  @Get('seller/affiliates')
  program(@CurrentUser() u: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.affiliates.program(requireSeller(u, h).id);
  }

  @Put('seller/affiliates')
  saveProgram(@CurrentUser() u: RequestUser, @Body() dto: ProgramDto, @Headers('x-seller-id') h?: string) {
    return this.affiliates.saveProgram(u, requireSeller(u, h).id, dto);
  }

  // ---- public / buyers / affiliates
  @Public()
  @Get('affiliates/products/:id')
  offer(@Param('id', ParseUUIDPipe) id: string) {
    return this.affiliates.offerForProduct(id).then((r) => r ?? { active: false });
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('affiliates/stores/:sellerId/link')
  link(@CurrentUser() u: RequestUser, @Param('sellerId', ParseUUIDPipe) sellerId: string) {
    return this.affiliates.link(u, sellerId);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('affiliates/track')
  track(@CurrentUser() u: RequestUser, @Body() dto: TrackDto) {
    return this.affiliates.track(u, dto.codes);
  }

  @Get('me/affiliates')
  dashboard(@CurrentUser() u: RequestUser) {
    return this.affiliates.dashboard(u);
  }

  @Put('me/affiliates/payout-profile')
  payoutProfile(@CurrentUser() u: RequestUser, @Body() dto: PayoutProfileDto) {
    return this.affiliates.setPayoutProfile(u, dto);
  }

  // ---- admin: affiliate payouts (money leaves the platform: admins only)
  @Roles('ADMIN')
  @Get('admin/affiliates/payables')
  payables() {
    return this.affiliates.payables();
  }

  @Roles('ADMIN')
  @Post('admin/affiliates/:userId/pay')
  pay(@CurrentUser() u: RequestUser, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: PayAffiliateDto) {
    return this.affiliates.pay(u, userId, dto.reference);
  }
}
