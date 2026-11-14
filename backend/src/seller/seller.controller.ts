import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsAddressLine, IsBankAccountNumber, IsBusinessName, IsCleanMultiline, IsCleanText, IsCountryCode, IsCurrencyCode, IsDocumentId, IsEmailAddress, IsHexColor, IsMeasure, IsMoney, IsPersonName, IsPersonNameOrBusiness, IsPhone, IsPlaceName, IsPostalCode, IsSku, IsSlug, IsSwiftOrRouting, IsTaxId, IsTimeZone, IsTrackingNumber, IsWebUrl, ToNumber } from '../common/validators';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { CurrentUser, RequestUser, requireSeller } from '../auth/auth';
import { SellerService } from './seller.service';
import { OrdersService } from '../orders/orders.service';
import { CARRIERS } from '../shipping/shipping.service';
import { badRequest } from '../common/errors';

const PHONE = /^\+?[0-9][0-9 ().-]{5,47}$/;
const upload = { limits: { fileSize: 8 * 1024 * 1024, files: 8, fields: 10, parts: 20 } };

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
  @IsBusinessName(3, 80) storeName: string;
  @IsOptional() @IsCleanText(0, 200) shortDescription?: string;
  @IsOptional() @IsEmailAddress() supportEmail?: string;
  @IsOptional() @IsPhone() supportPhone?: string;
  @IsBusinessName(3, 160) legalName: string;
  @IsIn(['INDIVIDUAL', 'SOLE_PROPRIETOR', 'COMPANY', 'PARTNERSHIP', 'NONPROFIT', 'OTHER']) entityType: any;
  @IsCountryCode() countryCode: string;
  @IsTaxId() taxId: string;
  @IsOptional() @IsTimeZone() timezone?: string;
  @ValidateNested() @Type(() => ShipFromDto) address: ShipFromDto;
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
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => OptionValueDto) values: OptionValueDto[];
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

/** Sellers report progress only; delivery is confirmed by the customer, the carrier or support. */
export class TrackingDto {
  @IsIn(['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'EXCEPTION']) status: any;
  @IsOptional() @IsCleanText(0, 200) detail?: string;
  @IsOptional() @IsPlaceName(2, 80) city?: string;
}

export class PayoutAccountDto {
  @IsIn(['BANK_ACCOUNT', 'PAYPAL', 'DIGITAL_WALLET']) methodCode: any;
  @IsPersonNameOrBusiness() holderName: string;
  @IsOptional() @IsBusinessName(2, 80) bankName?: string;
  @IsOptional() @IsBankAccountNumber() accountNumber?: string;
  @IsOptional() @IsIn(['CHECKING', 'SAVINGS']) accountType?: string;
  @IsOptional() @IsSwiftOrRouting() routingOrSwift?: string;
  @IsOptional() @IsCountryCode() countryCode?: string;
  @IsOptional() @IsEmailAddress() email?: string;
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
  ) {}

  private sid(user: RequestUser, header?: string) {
    return requireSeller(user, header).id;
  }

  @Post('onboarding')
  onboard(@CurrentUser() user: RequestUser, @Body() dto: OnboardingDto) {
    return this.seller.onboard(user, dto);
  }

  @Get('store')
  store(@CurrentUser() user: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.seller.store(this.sid(user, h));
  }

  @Put('store/ship-from')
  updateShipFrom(@CurrentUser() user: RequestUser, @Body() dto: ShipFromDto, @Headers('x-seller-id') h?: string) {
    return this.seller.updateShipFrom(this.sid(user, h), dto);
  }

  @Put('store')
  updateStore(@CurrentUser() user: RequestUser, @Body() dto: StoreDto, @Headers('x-seller-id') h?: string) {
    return this.seller.updateStore(this.sid(user, h), dto);
  }

  @Post('store/:kind')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', upload))
  storeImage(@CurrentUser() user: RequestUser, @Param('kind') kind: string, @UploadedFile() file: Express.Multer.File, @Headers('x-seller-id') h?: string) {
    if (!['logo', 'banner'].includes(kind) || !file) throw badRequest('INVALID_UPLOAD', 'Archivo inválido.');
    return this.seller.uploadStoreImage(user, this.sid(user, h), kind as any, file);
  }

  @Get('dashboard')
  dashboard(@CurrentUser() user: RequestUser, @Query('days') days?: string, @Headers('x-seller-id') h?: string) {
    return this.seller.dashboard(this.sid(user, h), Math.min(Math.max(Number(days) || 30, 7), 365));
  }

  // products
  @Get('products')
  products(@CurrentUser() user: RequestUser, @Query() q: Record<string, string>, @Headers('x-seller-id') h?: string) {
    return this.seller.listProducts(this.sid(user, h), { status: q.status, search: q.search, page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20 });
  }

  @Get('products/:id')
  product(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.seller.getProduct(this.sid(user, h), id);
  }

  @Post('products')
  createProduct(@CurrentUser() user: RequestUser, @Body() dto: ProductDto, @Headers('x-seller-id') h?: string) {
    return this.seller.saveProduct(user, this.sid(user, h), dto);
  }

  @Put('products/:id')
  updateProduct(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProductDto, @Headers('x-seller-id') h?: string) {
    return this.seller.saveProduct(user, this.sid(user, h), dto, id);
  }

  @Post('products/:id/status')
  productStatus(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProductStatusDto, @Headers('x-seller-id') h?: string) {
    return this.seller.setProductStatus(user, this.sid(user, h), id, dto.action);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('products/:id/media')
  @UseInterceptors(FilesInterceptor('files', 8, upload))
  addMedia(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: Express.Multer.File[], @Headers('x-seller-id') h?: string) {
    if (!files?.length) throw badRequest('NO_FILES', 'Selecciona al menos una imagen.');
    return this.seller.addMedia(user, this.sid(user, h), id, files);
  }

  @Delete('products/:id/media/:mediaId')
  removeMedia(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('mediaId', ParseUUIDPipe) mediaId: string, @Headers('x-seller-id') h?: string) {
    return this.seller.removeMedia(this.sid(user, h), id, mediaId, user.id);
  }

  @Post('products/:id/media/:mediaId/primary')
  primaryMedia(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('mediaId', ParseUUIDPipe) mediaId: string, @Headers('x-seller-id') h?: string) {
    return this.seller.setPrimaryMedia(this.sid(user, h), id, mediaId, user.id);
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
    return this.seller.inventory(this.sid(user, h), { search: q.search, stock: q.stock, categoryId: q.categoryId });
  }

  @Post('inventory/adjust')
  adjust(@CurrentUser() user: RequestUser, @Body() dto: AdjustDto, @Headers('x-seller-id') h?: string) {
    return this.seller.adjustStock(user, this.sid(user, h), dto);
  }

  // orders
  @Get('orders')
  ordersList(@CurrentUser() user: RequestUser, @Query() q: Record<string, string>, @Headers('x-seller-id') h?: string) {
    return this.orders.list({ kind: 'seller', sellerId: this.sid(user, h) }, { status: q.status, search: q.search, page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20 });
  }

  @Get('orders/counts')
  ordersCounts(@CurrentUser() user: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.orders.statusCounts({ kind: 'seller', sellerId: this.sid(user, h) });
  }

  @Get('orders/:orderId')
  orderDetail(@CurrentUser() user: RequestUser, @Param('orderId') orderId: string, @Headers('x-seller-id') h?: string) {
    return this.orders.detail({ kind: 'seller', sellerId: this.sid(user, h) }, orderId);
  }

  @Get('carriers')
  carriers() {
    return CARRIERS;
  }

  @Post('seller-orders/:id/prepare')
  prepare(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.orders.prepare(this.sid(user, h), id, user.id);
  }

  @Post('seller-orders/:id/ship')
  ship(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShipDto, @Headers('x-seller-id') h?: string) {
    return this.orders.ship(this.sid(user, h), id, user.id, dto);
  }

  @Post('shipments/:id/refresh-tracking')
  refreshTracking(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.orders.refreshShipmentTracking({ kind: 'seller', sellerId: this.sid(user, h) }, id);
  }

  @Post('shipments/:id/tracking')
  tracking(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TrackingDto, @Headers('x-seller-id') h?: string) {
    return this.orders.updateTracking({ kind: 'seller', sellerId: this.sid(user, h) }, id, dto.status, dto.detail, dto.city);
  }

  // finance
  @Get('finance')
  finance(@CurrentUser() user: RequestUser, @Query('days') days?: string, @Headers('x-seller-id') h?: string) {
    return this.seller.finance(this.sid(user, h), Math.min(Math.max(Number(days) || 30, 7), 365));
  }

  @Get('payout-accounts')
  payoutAccounts(@CurrentUser() user: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.seller.payoutAccounts(this.sid(user, h));
  }

  @Post('payout-accounts')
  addPayoutAccount(@CurrentUser() user: RequestUser, @Body() dto: PayoutAccountDto, @Headers('x-seller-id') h?: string) {
    return this.seller.addPayoutAccount(user, this.sid(user, h), dto);
  }

  @Put('payout-accounts/:id')
  updatePayoutAccount(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayoutAccountActionDto, @Headers('x-seller-id') h?: string) {
    return this.seller.updatePayoutAccount(this.sid(user, h), id, dto.action);
  }

  @Get('payouts')
  payouts(@CurrentUser() user: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.seller.payouts(this.sid(user, h));
  }

  @Post('payouts')
  requestPayout(@CurrentUser() user: RequestUser, @Body() dto: PayoutRequestDto, @Headers('x-seller-id') h?: string) {
    return this.seller.requestPayout(user, this.sid(user, h), dto);
  }

  @Post('payouts/:id/cancel')
  cancelPayout(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.seller.cancelPayout(user, this.sid(user, h), id);
  }
}
