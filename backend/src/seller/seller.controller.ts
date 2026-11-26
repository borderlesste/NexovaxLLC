import { requestLocale } from '../common/i18n-errors';
import type { Request } from 'express';
import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UploadedFiles, UseInterceptors, Req } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsAddressLine, IsBankAccountNumber, IsBusinessName, IsCleanMultiline, IsCleanText, IsCountryCode, IsCurrencyCode, IsDocumentId, IsEmailAddress, IsHexColor, IsMeasure, IsMoney, IsPersonName, IsPersonNameOrBusiness, IsPhone, IsPlaceName, IsPostalCode, IsSku, IsSlug, IsSwiftOrRouting, IsTaxId, IsTimeZone, IsTrackingNumber, IsWebUrl, ToNumber } from '../common/validators';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { CurrentUser, FreshUser, RequestUser, requireSeller, requireSellerOwner, SellerArea } from '../auth/auth';
import { SELLER_PAYOUT_METHODS, SellerPayoutMethod, SellerService } from './seller.service';
import { OrdersService } from '../orders/orders.service';
import { CARRIERS } from '../shipping/shipping.service';
import { AlertsService } from '../analytics/alerts.service';
import { DbService } from '../db/db.service';
import { badRequest } from '../common/errors';
import { AvailabilityService } from '../geo/availability';

const PHONE = /^\+?[0-9][0-9 ().-]{5,47}$/;
const upload = { limits: { fileSize: 8 * 1024 * 1024, files: 8, fields: 10, parts: 20 } };

export class DestinationsDto {
  @IsIn(['ALL', 'DOMESTIC', 'ONLY', 'EXCEPT']) mode!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(300) @IsString({ each: true }) countries?: string[];
  @IsOptional() @IsString() @MaxLength(300) note?: string | null;
}

export class ProductStatusDto {
  @IsIn(['PAUSE', 'RESUME', 'ARCHIVE']) action: 'PAUSE' | 'RESUME' | 'ARCHIVE';
}

export class PayoutAccountActionDto {
  @IsIn(['PRIMARY', 'DISABLE']) action: 'PRIMARY' | 'DISABLE';
}

export class ShipFromDto {
  @IsPersonName(2, 120) contactName: string;
  @IsAddressLine(3, 200) line1: string;
  @IsOptional() @IsAddressLine(1, 200) line2?: string;
  @IsCountryCode() countryCode: string;
  @IsPlaceName(2, 100) city: string;
  @IsOptional() @IsPlaceName(2, 80) region?: string;
  @IsOptional() @IsPostalCode() postalCode?: string;
  @IsPhone() phone: string;
}

export class OnboardingDto {
  /** Seller terms (current version), the marketplace commission and the content policies. */
  @IsBoolean() acceptTerms: boolean;
  @IsBusinessName(3, 80) storeName: string;
  @IsOptional() @IsCleanText(0, 200) shortDescription?: string;
  @IsOptional() @IsEmailAddress() supportEmail?: string;
  @IsOptional() @IsPhone() supportPhone?: string;
  // Fiscal data: optional; each field is validated only when it is sent.
  @IsOptional() @IsBusinessName(3, 160) legalName?: string;
  @IsOptional() @IsIn(['INDIVIDUAL', 'SOLE_PROPRIETOR', 'COMPANY', 'PARTNERSHIP', 'NONPROFIT', 'OTHER']) entityType?: any;
  @IsOptional() @IsCountryCode() countryCode?: string;
  @IsOptional() @IsTaxId() taxId?: string;
  @IsOptional() @IsTimeZone() timezone?: string;
  @ValidateNested() @Type(() => ShipFromDto) address: ShipFromDto;
}

export class LegalDto {
  @IsBusinessName(3, 160) legalName: string;
  @IsOptional() @IsIn(['INDIVIDUAL', 'SOLE_PROPRIETOR', 'COMPANY', 'PARTNERSHIP', 'NONPROFIT', 'OTHER']) entityType?: any;
  @IsOptional() @IsCountryCode() countryCode?: string;
  /** Left out keeps the tax ID already stored. */
  @IsOptional() @IsTaxId() taxId?: string;
}

export class StoreDto {
  @IsOptional() @IsBusinessName(3, 80) displayName?: string;
  @IsOptional() @IsCleanText(0, 200) shortDescription?: string;
  @IsOptional() @IsCleanMultiline(0, 3000) description?: string;
  @IsOptional() @IsEmailAddress() supportEmail?: string;
  @IsOptional() @IsPhone() supportPhone?: string;
}

class OptionValueDto {
  @IsCleanText(1, 40) label: string;
  @IsOptional() @IsHexColor() swatch?: string | null;
}
class OptionDto {
  @IsCleanText(1, 40) name: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => OptionValueDto) values: OptionValueDto[];
}
class VariantDto {
  @IsOptional() @IsUUID() id?: string;
  @IsSku() sku: string;
  @IsOptional() @IsObject() optionValues?: Record<string, string>;
  @ToNumber() @IsMoney(0.01) price: number;
  @IsOptional() @ToNumber() @IsMoney(0.01) compareAtPrice?: number | null;
  @ToNumber() @IsInt({ message: 'El stock debe ser un número entero.' }) @Min(0, { message: 'El stock no puede ser negativo.' }) @Max(1_000_000) stock: number;
  @IsOptional() @ToNumber() @IsMeasure(1000, 'El peso') weightKg?: number | null;
  @IsOptional() @ToNumber() @IsMeasure(300, 'El largo') lengthCm?: number | null;
  @IsOptional() @ToNumber() @IsMeasure(300, 'El ancho') widthCm?: number | null;
  @IsOptional() @ToNumber() @IsMeasure(300, 'El alto') heightCm?: number | null;
}
class MediaVariantDto {
  @ValidateIf((_o, value) => value !== null) @IsUUID() variantId: string | null;
}
class AttributeDto {
  @IsUUID() definitionId: string;
  @IsCleanText(0, 200) value: string;
}
class SeoDto {
  @IsOptional() @IsSlug() slug?: string;
  @IsOptional() @IsCleanText(0, 60) metaTitle?: string;
  @IsOptional() @IsCleanText(0, 160) metaDescription?: string;
}
export class ProductDto {
  @IsCleanText(3, 140) title: string;
  @IsUUID() categoryId: string;
  /** Null inherits the category tax class, omission preserves the current override. */
  @IsOptional() @IsIn(['STANDARD', 'REDUCED', 'EXEMPT'], { message: 'Categoría fiscal inválida.' }) taxClass?: 'STANDARD' | 'REDUCED' | 'EXEMPT' | null;
  @IsOptional() @IsIn(['NEW', 'USED']) condition?: 'NEW' | 'USED' | null;
  @IsOptional() @IsCleanMultiline(0, 3000) sizeGuide?: string | null;
  @IsOptional() @IsBusinessName(1, 60) brandName?: string | null;
  @IsOptional() @IsCleanText(0, 300) shortDescription?: string | null;
  @IsCleanMultiline(10, 5000) description: string;
  @IsOptional() @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => OptionDto) options?: OptionDto[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => VariantDto) variants: VariantDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => AttributeDto) attributes?: AttributeDto[];
  @IsOptional() @ValidateNested() @Type(() => SeoDto) seo?: SeoDto;
  @IsOptional() @IsIn(['SAVE_DRAFT', 'SUBMIT']) action?: 'SAVE_DRAFT' | 'SUBMIT';
}

export class AdjustDto {
  @IsUUID() variantId: string;
  @IsIn(['SET', 'ADD', 'REMOVE']) mode: 'SET' | 'ADD' | 'REMOVE';
  @ToNumber() @IsInt({ message: 'La cantidad debe ser un número entero.' }) @Min(0) @Max(1_000_000) quantity: number;
  @IsOptional() @IsCleanText(0, 40) reason?: string;
  @IsOptional() @ToNumber() @IsInt({ message: 'El stock mínimo debe ser un número entero.' }) @Min(0) @Max(1_000_000) minStock?: number;
}

export class ShipDto {
  @IsOptional() @IsIn(['LABEL', 'MANUAL']) mode?: 'LABEL' | 'MANUAL';
  @IsOptional() @Matches(/^[A-Z_]{2,30}$/, { message: 'Transportadora inválida.' }) carrierCode?: string;
  @IsOptional() @IsBusinessName(2, 60) carrierName?: string;
  @IsOptional() @IsTrackingNumber() trackingNumber?: string;
  @IsOptional() @IsWebUrl(300) trackingUrl?: string;
}

export class TrackingDto {
  @IsIn(['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'EXCEPTION']) status: 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'EXCEPTION';
  @IsOptional() @IsCleanText(0, 200) detail?: string;
  @IsOptional() @IsPlaceName(2, 80) city?: string;
}

export class PayoutAccountDto {
  @IsIn(SELLER_PAYOUT_METHODS) methodCode: SellerPayoutMethod;
  @IsPersonNameOrBusiness() holderName: string;
  @IsOptional() @IsBusinessName(2, 80) bankName?: string;
  @IsOptional() @IsBankAccountNumber() accountNumber?: string;
  @IsOptional() @IsIn(['CHECKING', 'SAVINGS']) accountType?: string;
  @IsOptional() @IsSwiftOrRouting() routingOrSwift?: string;
  @IsOptional() @IsCountryCode() countryCode?: string;
  /** Account email (PayPal, wallets) or, for Zelle, a US phone number; validated in the service. */
  @IsOptional() @IsString() @Length(0, 254) email?: string;
  @IsOptional() @IsCurrencyCode() currency?: string;
  @IsOptional() @IsCleanText(0, 40) alias?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsDocumentId() documentId?: string;
}

export class PayoutRequestDto {
  @IsUUID() accountId: string;
  @IsOptional() @IsCurrencyCode() currency?: string;
  @ToNumber() @IsMoney(1) amount: number;
  @IsString() @Length(8, 100) idempotencyKey: string;
}

@ApiTags('seller')
@Controller('seller')
export class SellerController {
  constructor(
    private readonly seller: SellerService,
    private readonly orders: OrdersService,
    private readonly alerts: AlertsService,
    private readonly db: DbService,
    private readonly availability: AvailabilityService,
  ) {}

  private sid(user: RequestUser, header?: string, area?: SellerArea) {
    return requireSeller(user, header, area).id;
  }

  /** Owner-only: payout accounts and withdrawals. */
  private ownerSid(user: RequestUser, header?: string) {
    return requireSellerOwner(user, header).id;
  }

  @Post('onboarding')
  onboard(@CurrentUser() user: RequestUser, @Body() dto: OnboardingDto, @Req() req: Request) {
    return this.seller.onboard(user, dto, { ip: req.ip ?? null, userAgent: String(req.headers['user-agent'] ?? '') || null, locale: requestLocale(req) });
  }

  @Get('store')
  store(@CurrentUser() user: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.seller.store(this.sid(user, h));
  }

  @Put('store/ship-from')
  updateShipFrom(@CurrentUser() user: RequestUser, @Body() dto: ShipFromDto, @Headers('x-seller-id') h?: string) {
    return this.seller.updateShipFrom(this.sid(user, h, 'SETTINGS'), dto);
  }

  /** Where the store ships to (NX-GEO-001): every destination, only its country, only some, or all but some. */
  @Get('store/destinations')
  storeDestinations(@CurrentUser() user: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.availability.get(this.sid(user, h, 'SETTINGS'), null);
  }

  @Put('store/destinations')
  updateStoreDestinations(@CurrentUser() user: RequestUser, @Body() dto: DestinationsDto, @Headers('x-seller-id') h?: string) {
    return this.availability.set(this.sid(user, h, 'SETTINGS'), null, user.id, dto);
  }

  @Get('products/:id/destinations')
  productDestinations(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.availability.get(this.sid(user, h, 'PRODUCTS'), id);
  }

  @Put('products/:id/destinations')
  updateProductDestinations(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DestinationsDto, @Headers('x-seller-id') h?: string) {
    return this.availability.set(this.sid(user, h, 'PRODUCTS'), id, user.id, dto);
  }

  /** Fiscal data: owner only, since it is the store's legal identity. */
  @Put('store/legal')
  updateLegal(@CurrentUser() user: RequestUser, @Body() dto: LegalDto, @Headers('x-seller-id') h?: string) {
    return this.seller.updateLegal(this.ownerSid(user, h), dto);
  }

  @Put('store')
  updateStore(@CurrentUser() user: RequestUser, @Body() dto: StoreDto, @Headers('x-seller-id') h?: string) {
    return this.seller.updateStore(this.sid(user, h, 'SETTINGS'), dto);
  }

  @Post('store/:kind')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', upload))
  storeImage(@CurrentUser() user: RequestUser, @Param('kind') kind: string, @UploadedFile() file: Express.Multer.File, @Headers('x-seller-id') h?: string) {
    if (!['logo', 'banner'].includes(kind) || !file) throw badRequest('INVALID_UPLOAD', 'Archivo inválido.');
    return this.seller.uploadStoreImage(user, this.sid(user, h, 'SETTINGS'), kind as any, file);
  }

  /** Removes the store logo or cover; the storefront then shows the NEXOVAX defaults. */
  @Delete('store/:kind')
  removeStoreImage(@CurrentUser() user: RequestUser, @Param('kind') kind: string, @Headers('x-seller-id') h?: string) {
    if (!['logo', 'banner'].includes(kind)) throw badRequest('INVALID_UPLOAD', 'Archivo inválido.');
    return this.seller.removeStoreImage(this.sid(user, h, 'SETTINGS'), kind as 'logo' | 'banner');
  }

  @Get('dashboard')
  dashboard(@CurrentUser() user: RequestUser, @Query('days') days?: string, @Headers('x-seller-id') h?: string) {
    return this.seller.dashboard(this.sid(user, h, 'STATS'), Math.min(Math.max(Number(days) || 30, 7), 365));
  }

  // products
  @Get('products')
  products(@CurrentUser() user: RequestUser, @Query() q: Record<string, string>, @Headers('x-seller-id') h?: string) {
    return this.seller.listProducts(this.sid(user, h, 'PRODUCTS'), { status: q.status, search: q.search, page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20 });
  }

  @Get('products/:id')
  product(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.seller.getProduct(this.sid(user, h, 'PRODUCTS'), id);
  }

  @Post('products')
  createProduct(@CurrentUser() user: RequestUser, @Body() dto: ProductDto, @Headers('x-seller-id') h?: string) {
    return this.seller.saveProduct(user, this.sid(user, h, 'PRODUCTS'), dto);
  }

  @Put('products/:id')
  async updateProduct(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProductDto, @Headers('x-seller-id') h?: string) {
    const r = await this.seller.saveProduct(user, this.sid(user, h, 'PRODUCTS'), dto, id);
    this.alerts.touch([id]); // price or stock may have changed: tell waiting buyers
    return r;
  }

  @Post('products/:id/status')
  async productStatus(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProductStatusDto, @Headers('x-seller-id') h?: string) {
    const r = await this.seller.setProductStatus(user, this.sid(user, h, 'PRODUCTS'), id, dto.action);
    this.alerts.touch([id]);
    return r;
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('products/:id/media')
  @UseInterceptors(FilesInterceptor('files', 8, upload))
  addMedia(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: Express.Multer.File[], @Headers('x-seller-id') h?: string) {
    if (!files?.length) throw badRequest('NO_FILES', 'Selecciona al menos una imagen.');
    return this.seller.addMedia(user, this.sid(user, h, 'PRODUCTS'), id, files);
  }

  @Delete('products/:id/media/:mediaId')
  removeMedia(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('mediaId', ParseUUIDPipe) mediaId: string, @Headers('x-seller-id') h?: string) {
    return this.seller.removeMedia(this.sid(user, h, 'PRODUCTS'), id, mediaId, user.id);
  }

  @Put('products/:id/media/:mediaId/variant')
  mediaVariant(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('mediaId', ParseUUIDPipe) mediaId: string, @Body() body: MediaVariantDto, @Headers('x-seller-id') h?: string) {
    return this.seller.setMediaVariant(this.sid(user, h, 'PRODUCTS'), id, mediaId, body.variantId, user.id);
  }

  @Post('products/:id/media/:mediaId/primary')
  primaryMedia(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('mediaId', ParseUUIDPipe) mediaId: string, @Headers('x-seller-id') h?: string) {
    return this.seller.setPrimaryMedia(this.sid(user, h, 'PRODUCTS'), id, mediaId, user.id);
  }

  @Get('categories/:id/attributes')
  attributes(@Param('id', ParseUUIDPipe) id: string) {
    return this.seller.attributeDefinitions(id);
  }

  @Get('categories/:id/variant-templates')
  templates(@Param('id', ParseUUIDPipe) id: string) {
    return this.seller.variantTemplates(id);
  }

  // inventory
  @Get('inventory')
  inventory(@CurrentUser() user: RequestUser, @Query() q: Record<string, string>, @Headers('x-seller-id') h?: string) {
    return this.seller.inventory(this.sid(user, h, 'PRODUCTS'), { search: q.search, stock: q.stock, categoryId: q.categoryId });
  }

  @Post('inventory/adjust')
  async adjust(@CurrentUser() user: RequestUser, @Body() dto: AdjustDto, @Headers('x-seller-id') h?: string) {
    const r = await this.seller.adjustStock(user, this.sid(user, h, 'PRODUCTS'), dto);
    const v = await this.db.one<{ product_id: string }>(`select product_id from public.product_variants where id = $1`, [dto.variantId]);
    if (v) this.alerts.touch([v.product_id]);
    return r;
  }

  // orders
  @Get('orders')
  ordersList(@CurrentUser() user: RequestUser, @Query() q: Record<string, string>, @Headers('x-seller-id') h?: string) {
    return this.orders.list({ kind: 'seller', sellerId: this.sid(user, h, 'ORDERS') }, { status: q.status, search: q.search, page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20 });
  }

  @Get('orders/counts')
  ordersCounts(@CurrentUser() user: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.orders.statusCounts({ kind: 'seller', sellerId: this.sid(user, h, 'ORDERS') });
  }

  @Get('orders/:orderId')
  orderDetail(@CurrentUser() user: RequestUser, @Param('orderId') orderId: string, @Headers('x-seller-id') h?: string) {
    return this.orders.detail({ kind: 'seller', sellerId: this.sid(user, h, 'ORDERS') }, orderId);
  }

  @Get('carriers')
  carriers() {
    return CARRIERS;
  }

  @Post('seller-orders/:id/prepare')
  prepare(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.orders.prepare(this.sid(user, h, 'ORDERS'), id, user.id);
  }

  @Post('seller-orders/:id/ship')
  ship(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShipDto, @Headers('x-seller-id') h?: string) {
    return this.orders.ship(this.sid(user, h, 'ORDERS'), id, user.id, dto);
  }

  @FreshUser()
  @Post('shipments/:id/refresh-tracking')
  refreshTracking(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.orders.refreshShipmentTracking({ kind: 'seller', userId: user.id, sellerId: this.sid(user, h, 'ORDERS') }, id);
  }

  @FreshUser()
  @Post('shipments/:id/tracking')
  tracking(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TrackingDto, @Headers('x-seller-id') h?: string) {
    return this.orders.updateTracking({ kind: 'seller', userId: user.id, sellerId: this.sid(user, h, 'ORDERS') }, id, dto.status, dto.detail, dto.city);
  }

  // finance
  @Get('finance')
  async finance(@CurrentUser() user: RequestUser, @Query('days') days?: string, @Headers('x-seller-id') h?: string) {
    const sid = this.sid(user, h, 'FINANCE');
    // Release any funds whose hold already ended, so the balance is current even if the
    // 30-minute job did not run (the API sleeps on Render's free plan). Best effort.
    await this.orders.retryPendingReleases(sid).catch(() => undefined);
    return this.seller.finance(sid, Math.min(Math.max(Number(days) || 30, 7), 365));
  }

  @Get('payout-accounts')
  payoutAccounts(@CurrentUser() user: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.seller.payoutAccounts(this.sid(user, h, 'FINANCE'));
  }

  @Post('payout-accounts')
  addPayoutAccount(@CurrentUser() user: RequestUser, @Body() dto: PayoutAccountDto, @Headers('x-seller-id') h?: string) {
    return this.seller.addPayoutAccount(user, this.ownerSid(user, h), dto);
  }

  @Put('payout-accounts/:id')
  updatePayoutAccount(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayoutAccountActionDto, @Headers('x-seller-id') h?: string) {
    return this.seller.updatePayoutAccount(this.ownerSid(user, h), id, dto.action);
  }

  @Get('payouts')
  payouts(@CurrentUser() user: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.seller.payouts(this.sid(user, h, 'FINANCE'));
  }

  @Post('payouts')
  requestPayout(@CurrentUser() user: RequestUser, @Body() dto: PayoutRequestDto, @Headers('x-seller-id') h?: string) {
    return this.seller.requestPayout(user, this.ownerSid(user, h), dto);
  }

  @Post('payouts/:id/cancel')
  cancelPayout(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.seller.cancelPayout(user, this.ownerSid(user, h), id);
  }
}
