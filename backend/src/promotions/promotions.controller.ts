import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { CurrentUser, Public, RequestUser, Roles, requireSeller } from '../auth/auth';
import { CouponsService } from './coupons.service';
import { AffiliatesService, PAYOUT_METHODS, type PayoutMethod } from './affiliates.service';
import { OffersService } from './offers.service';
import { SharesService } from './shares.service';
import { FlashDealsService } from './flash-deals.service';

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
class WalletDto {
  @IsOptional() @IsString() @Length(0, 80) holderName?: string;
  @IsOptional() @IsString() @Length(0, 254) account?: string;
}
export class PayoutProfileDto {
  @IsIn(PAYOUT_METHODS) method: PayoutMethod;
  @IsOptional() @ValidateNested() @Type(() => WalletDto) wallet?: WalletDto;
  @IsOptional() @IsString() @Length(0, 254) paypalEmail?: string;
  @IsOptional() @ValidateNested() @Type(() => BankDto) bank?: BankDto;
}
class NewCouponDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(90) percent: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(30) days: number;
}
export class OfferDto {
  @IsUUID() productId: string;
  @IsIn(['FAVORITES', 'CART', 'BOTH']) audience: 'FAVORITES' | 'CART' | 'BOTH';
  @IsOptional() @IsUUID() couponId?: string;
  @IsOptional() @ValidateNested() @Type(() => NewCouponDto) newCoupon?: NewCouponDto;
  @IsOptional() @IsString() @Length(0, 280) message?: string;
}
export class ShareLinkDto {
  @IsUUID() productId: string;
}
export class ShareVisitDto {
  @IsString() @Length(6, 16) code: string;
}
export class FlashDealDto {
  @IsUUID() productId: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(90) discountPercent: number;
  @IsOptional() @IsString() @Length(10, 40) startsAt?: string | null;
  @IsString() @Length(10, 40) endsAt: string;
}
export class RemoveFlashDealDto {
  @IsString() @Length(5, 500) reason: string;
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
    private readonly offers: OffersService,
    private readonly shares: SharesService,
    private readonly flash: FlashDealsService,
  ) {}

  // ---- seller: flash deals (own discount, start and end; real countdown on the home page)
  @Get('seller/flash-deals')
  flashDeals(@CurrentUser() u: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.flash.list(requireSeller(u, h, 'MARKETING').id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('seller/flash-deals')
  createFlashDeal(@CurrentUser() u: RequestUser, @Body() dto: FlashDealDto, @Headers('x-seller-id') h?: string) {
    return this.flash.create(u, requireSeller(u, h, 'MARKETING').id, dto);
  }

  @Post('seller/flash-deals/:id/cancel')
  cancelFlashDeal(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.flash.cancel(u, requireSeller(u, h, 'MARKETING').id, id);
  }

  // ---- admin: oversee every store's flash deals and take one down
  @Roles('ADMIN', 'MODERATOR')
  @Get('admin/flash-deals')
  adminFlashDeals() {
    return this.flash.adminList();
  }

  @Roles('ADMIN', 'MODERATOR')
  @Post('admin/flash-deals/:id/remove')
  removeFlashDeal(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RemoveFlashDealDto) {
    return this.flash.remove(u, id, dto.reason);
  }

  // ---- seller: coupon offers to interested buyers (counts only, never identities)
  @Get('seller/offers/audience')
  offerAudience(@CurrentUser() u: RequestUser, @Query('productId', ParseUUIDPipe) productId: string, @Headers('x-seller-id') h?: string) {
    return this.offers.audience(requireSeller(u, h, 'MARKETING').id, productId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('seller/offers')
  sendOffer(@CurrentUser() u: RequestUser, @Body() dto: OfferDto, @Headers('x-seller-id') h?: string) {
    return this.offers.send(u, requireSeller(u, h, 'MARKETING').id, dto);
  }

  @Get('seller/offers')
  offerCampaigns(@CurrentUser() u: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.offers.campaigns(requireSeller(u, h, 'MARKETING').id);
  }

  // ---- seller: coupons
  @Get('seller/coupons')
  coupons_(@CurrentUser() u: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.coupons.list(requireSeller(u, h, 'MARKETING').id);
  }

  @Post('seller/coupons')
  createCoupon(@CurrentUser() u: RequestUser, @Body() dto: CouponDto, @Headers('x-seller-id') h?: string) {
    return this.coupons.create(u, requireSeller(u, h, 'MARKETING').id, dto);
  }

  @Put('seller/coupons/:id')
  updateCoupon(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CouponDto, @Headers('x-seller-id') h?: string) {
    return this.coupons.update(u, requireSeller(u, h, 'MARKETING').id, id, dto);
  }

  @Post('seller/coupons/:id/active')
  toggleCoupon(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ActiveDto, @Headers('x-seller-id') h?: string) {
    return this.coupons.setActive(requireSeller(u, h, 'MARKETING').id, id, dto.active);
  }

  @Delete('seller/coupons/:id')
  removeCoupon(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.coupons.remove(requireSeller(u, h, 'MARKETING').id, id);
  }

  // ---- seller: affiliate program
  @Get('seller/affiliates')
  program(@CurrentUser() u: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.affiliates.program(requireSeller(u, h, 'MARKETING').id);
  }

  @Put('seller/affiliates')
  saveProgram(@CurrentUser() u: RequestUser, @Body() dto: ProgramDto, @Headers('x-seller-id') h?: string) {
    return this.affiliates.saveProgram(u, requireSeller(u, h, 'MARKETING').id, dto);
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

  // ---- shared product links (any signed-in user)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('shares')
  shareLink(@CurrentUser() u: RequestUser, @Body() dto: ShareLinkDto) {
    return this.shares.link(u, dto.productId);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('shares/visit')
  shareVisit(@CurrentUser() u: RequestUser | null, @Body() dto: ShareVisitDto) {
    return this.shares.visit(dto.code, u);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('shares/track')
  shareTrack(@CurrentUser() u: RequestUser, @Body() dto: TrackDto) {
    return this.shares.track(u, dto.codes);
  }

  @Get('me/shares')
  myShares(@CurrentUser() u: RequestUser) {
    return this.shares.mine(u);
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
