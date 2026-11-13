import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { CurrentUser, RequestUser, requireSeller } from '../auth/auth';
import { SellerService } from './seller.service';
import { OrdersService } from '../orders/orders.service';
import { CARRIERS } from '../shipping/shipping.service';
import { badRequest } from '../common/errors';

const PHONE = /^\+?[0-9][0-9 ().-]{5,47}$/;
const upload = { limits: { fileSize: 10 * 1024 * 1024, files: 8 } };

export class ShipFromDto {
  @IsString() @Length(2, 120) contactName: string;
  @IsString() @Length(3, 200) line1: string;
  @IsOptional() @IsString() @MaxLength(200) line2?: string;
  @IsString() @Length(2, 2) countryCode: string;
  @IsString() @Length(2, 100) city: string;
  @IsOptional() @IsString() @MaxLength(80) region?: string;
  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @Matches(PHONE, { message: 'Teléfono inválido.' }) phone: string;
}

export class OnboardingDto {
  @IsString() @Length(3, 80) storeName: string;
  @IsOptional() @IsString() @MaxLength(200) shortDescription?: string;
  @IsOptional() @IsEmail() supportEmail?: string;
  @IsOptional() @Matches(PHONE) supportPhone?: string;
  @IsString() @Length(3, 160) legalName: string;
  @IsIn(['INDIVIDUAL', 'SOLE_PROPRIETOR', 'COMPANY', 'PARTNERSHIP', 'NONPROFIT', 'OTHER']) entityType: any;
  @IsString() @Length(2, 2) countryCode: string;
  @IsString() @Length(3, 30) taxId: string;
  @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @ValidateNested() @Type(() => ShipFromDto) address: ShipFromDto;
}

export class StoreDto {
  @IsOptional() @IsString() @Length(3, 80) displayName?: string;
  @IsOptional() @IsString() @MaxLength(200) shortDescription?: string;
  @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @IsOptional() @IsString() @MaxLength(120) supportEmail?: string;
  @IsOptional() @IsString() @MaxLength(40) supportPhone?: string;
}

class OptionValueDto {
  @IsString() @Length(1, 40) label: string;
  @IsOptional() @IsString() @MaxLength(20) swatch?: string | null;
}
class OptionDto {
  @IsString() @Length(1, 40) name: string;
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => OptionValueDto) values: OptionValueDto[];
}
class VariantDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @Length(1, 64) sku: string;
  @IsOptional() @IsObject() optionValues?: Record<string, string>;
  @Type(() => Number) @IsNumber() @Min(0.01) price: number;
  @IsOptional() @Type(() => Number) @IsNumber() compareAtPrice?: number | null;
  @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) stock: number;
  @IsOptional() @Type(() => Number) @IsNumber() weightKg?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() lengthCm?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() widthCm?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() heightCm?: number | null;
}
class AttributeDto {
  @IsUUID() definitionId: string;
  @IsString() @MaxLength(200) value: string;
}
class SeoDto {
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() @MaxLength(60) metaTitle?: string;
  @IsOptional() @IsString() @MaxLength(160) metaDescription?: string;
}
export class ProductDto {
  @IsString() @Length(3, 140) title: string;
  @IsUUID() categoryId: string;
  @IsOptional() @IsString() @MaxLength(60) brandName?: string | null;
  @IsOptional() @IsString() @MaxLength(300) shortDescription?: string | null;
  @IsString() @Length(10, 5000) description: string;
  @IsOptional() @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => OptionDto) options?: OptionDto[];
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => VariantDto) variants: VariantDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AttributeDto) attributes?: AttributeDto[];
  @IsOptional() @ValidateNested() @Type(() => SeoDto) seo?: SeoDto;
  @IsOptional() @IsIn(['SAVE_DRAFT', 'SUBMIT']) action?: 'SAVE_DRAFT' | 'SUBMIT';
}

export class AdjustDto {
  @IsUUID() variantId: string;
  @IsIn(['SET', 'ADD', 'REMOVE']) mode: 'SET' | 'ADD' | 'REMOVE';
  @Type(() => Number) @IsInt() @Min(0) quantity: number;
  @IsOptional() @IsString() @MaxLength(40) reason?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minStock?: number;
}

export class ShipDto {
  @IsOptional() @IsIn(['LABEL', 'MANUAL']) mode?: 'LABEL' | 'MANUAL';
  @IsOptional() @IsString() carrierCode?: string;
  @IsOptional() @IsString() @MaxLength(60) carrierName?: string;
  @IsOptional() @IsString() @MaxLength(60) trackingNumber?: string;
  @IsOptional() @IsString() @MaxLength(300) trackingUrl?: string;
}

export class TrackingDto {
  @IsIn(['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION']) status: any;
  @IsOptional() @IsString() @MaxLength(200) detail?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
}

export class PayoutAccountDto {
  @IsIn(['BANK_ACCOUNT', 'PAYPAL', 'DIGITAL_WALLET']) methodCode: any;
  @IsString() @Length(2, 120) holderName: string;
  @IsOptional() @IsString() @MaxLength(80) bankName?: string;
  @IsOptional() @IsString() @MaxLength(34) accountNumber?: string;
  @IsOptional() @IsIn(['CHECKING', 'SAVINGS']) accountType?: string;
  @IsOptional() @IsString() @MaxLength(20) routingOrSwift?: string;
  @IsOptional() @IsString() @Length(2, 2) countryCode?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsString() @MaxLength(40) alias?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsString() @MaxLength(20) documentId?: string;
}

export class PayoutRequestDto {
  @IsUUID() accountId: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @Type(() => Number) @IsNumber() @Min(1) amount: number;
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
  productStatus(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body('action') action: 'PAUSE' | 'RESUME' | 'ARCHIVE', @Headers('x-seller-id') h?: string) {
    if (!['PAUSE', 'RESUME', 'ARCHIVE'].includes(action)) throw badRequest('INVALID_ACTION', 'Acción inválida.');
    return this.seller.setProductStatus(user, this.sid(user, h), id, action);
  }

  @Post('products/:id/media')
  @UseInterceptors(FilesInterceptor('files', 8, upload))
  addMedia(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: Express.Multer.File[], @Headers('x-seller-id') h?: string) {
    if (!files?.length) throw badRequest('NO_FILES', 'Selecciona al menos una imagen.');
    return this.seller.addMedia(user, this.sid(user, h), id, files);
  }

  @Delete('products/:id/media/:mediaId')
  removeMedia(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('mediaId', ParseUUIDPipe) mediaId: string, @Headers('x-seller-id') h?: string) {
    return this.seller.removeMedia(this.sid(user, h), id, mediaId);
  }

  @Post('products/:id/media/:mediaId/primary')
  primaryMedia(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('mediaId', ParseUUIDPipe) mediaId: string, @Headers('x-seller-id') h?: string) {
    return this.seller.setPrimaryMedia(this.sid(user, h), id, mediaId);
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
  updatePayoutAccount(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body('action') action: 'PRIMARY' | 'DISABLE', @Headers('x-seller-id') h?: string) {
    if (!['PRIMARY', 'DISABLE'].includes(action)) throw badRequest('INVALID_ACTION', 'Acción inválida.');
    return this.seller.updatePayoutAccount(this.sid(user, h), id, action);
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
