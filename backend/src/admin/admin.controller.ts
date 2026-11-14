import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { IsCleanText, IsCountryCode, IsEmailAddress, IsPaymentReference, IsPersonName, ToNumber } from '../common/validators';
import { CurrentUser, RequestUser, Roles } from '../auth/auth';
import { badRequest } from '../common/errors';
import { AdminService } from './admin.service';
import { OrdersService } from '../orders/orders.service';
import { ShippingService } from '../shipping/shipping.service';
import { OnboardingDto } from '../seller/seller.controller';

export class AttributeOptionDto {
  @IsOptional() @Matches(/^[a-z0-9_]{1,40}$/, { message: 'El código de la opción solo puede contener minúsculas, números y guiones bajos.' }) value?: string;
  @IsCleanText(1, 60) label: string;
  @IsOptional() @IsCleanText(0, 60) labelEn?: string;
}

export class AttributeConfigDto {
  @IsIn(['select', 'combobox', 'text']) input: 'select' | 'combobox' | 'text';
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AttributeOptionDto) options: AttributeOptionDto[];
}

export class ApproveDto {
  @IsBoolean({ message: 'Valor inválido.' }) approve: boolean;
}

export class UserStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED']) status: 'ACTIVE' | 'SUSPENDED';
}

export class ModerateDto {
  @IsIn(['APPROVE', 'REJECT', 'REQUEST_CHANGES']) decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
  @IsOptional() @IsCleanText(0, 300) note?: string;
}
export class ReasonDto {
  @IsOptional() @IsCleanText(0, 300) reason?: string;
}
export class SellerActionDto {
  @IsIn(['APPROVE', 'REJECT', 'SUSPEND', 'REACTIVATE']) action: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REACTIVATE';
  @IsOptional() @IsCleanText(0, 300) reason?: string;
}
export class CreateSellerDto extends OnboardingDto {
  @IsPersonName(3, 120) ownerName: string;
  @IsEmailAddress() ownerEmail: string;
  @IsOptional() @IsString() @Length(8, 72) password?: string;
}
export class CategoryDto {
  @IsCleanText(2, 80) name: string;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @IsOptional() @ToNumber() @IsInt({ message: 'El orden debe ser un número entero.' }) @Min(0) @Max(100000) sortOrder?: number;
  @IsOptional() @IsCleanText(0, 500) description?: string;
}
export class PayoutActionDto {
  @IsIn(['APPROVE', 'MARK_PAID', 'FAIL', 'CANCEL']) action: 'APPROVE' | 'MARK_PAID' | 'FAIL' | 'CANCEL';
  @IsOptional() @IsPaymentReference() reference?: string;
  @IsOptional() @IsCleanText(0, 300) reason?: string;
}
export class TransferDto {
  @IsOptional() @IsPaymentReference() reference?: string;
  @IsOptional() @IsCleanText(0, 300) reason?: string;
}
export class SettingsDto {
  @IsOptional() @IsObject() settings?: Record<string, any>;
  @IsOptional() @ToNumber() @IsNumber({ maxDecimalPlaces: 4 }, { message: 'La comisión debe ser un número.' }) @Min(0) @Max(0.5) commissionRate?: number;
}
export class TaxRateDto {
  @IsCountryCode() countryCode: string;
  @IsCleanText(1, 40) taxName: string;
  @ToNumber() @IsNumber({ maxDecimalPlaces: 4 }, { message: 'La tasa debe ser un número.' }) @Min(0) @Max(0.99) rate: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsCleanText(0, 300) notes?: string;
}
export class RoleDto {
  @IsIn(['CUSTOMER', 'SELLER', 'SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN']) role: any;
  @IsBoolean() grant: boolean;
}

export class AdminTrackingDto {
  @IsIn(['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION']) status: 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'EXCEPTION';
  @IsOptional() @IsCleanText(0, 200) detail?: string;
}

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly orders: OrdersService,
    private readonly shipping: ShippingService,
  ) {}

  /** Shippo carrier accounts and whether they can issue labels (blocked ones aren't offered at checkout). */
  @Roles('ADMIN')
  @Get('shipping/carriers')
  shippingCarriers() {
    return this.shipping.carrierAccounts();
  }

  @Roles('ADMIN')
  @Post('shipping/carriers/:id/recheck')
  recheckCarrier(@Param('id') id: string) {
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(id)) throw badRequest('CARRIER_INVALID', 'Transportadora inválida.');
    return this.shipping.recheckCarrier(id);
  }

  @Roles('MODERATOR', 'SUPPORT')
  @Get('dashboard')
  dashboard(@Query('days') days?: string) {
    return this.admin.dashboard(Math.min(Math.max(Number(days) || 30, 7), 365));
  }

  // products / moderation
  @Roles('MODERATOR')
  @Get('products')
  products(@Query() q: Record<string, string>) {
    return this.admin.products({ status: q.status, search: q.search, categoryId: q.categoryId, sellerId: q.sellerId, page: Number(q.page) || 1 });
  }

  @Roles('MODERATOR')
  @Get('products/:id/review')
  review(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.productReview(id);
  }

  @Roles('MODERATOR')
  @Post('products/:id/moderate')
  moderate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateDto) {
    return this.admin.moderate(user, id, dto.decision, dto.note);
  }

  @Roles('MODERATOR')
  @Post('products/:id/suspend')
  suspend(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.admin.suspendProduct(user, id, dto.reason ?? '');
  }

  // orders
  @Roles('SUPPORT', 'MODERATOR')
  @Get('orders')
  ordersList(@Query() q: Record<string, string>) {
    return this.orders.list({ kind: 'admin' }, { status: q.status, search: q.search, sellerId: q.sellerId, from: q.from, to: q.to, page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20 });
  }

  @Roles('SUPPORT', 'MODERATOR')
  @Get('orders/counts')
  ordersCounts() {
    return this.orders.statusCounts({ kind: 'admin' });
  }

  @Roles('SUPPORT', 'MODERATOR')
  @Get('orders/:id')
  order(@Param('id') id: string) {
    return this.orders.detail({ kind: 'admin' }, id);
  }

  @Roles('SUPPORT')
  @Post('shipments/:id/tracking')
  tracking(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminTrackingDto) {
    return this.orders.updateTracking({ kind: 'admin' }, id, dto.status, dto.detail);
  }

  @Roles('SUPPORT')
  @Post('shipments/:id/refresh-tracking')
  refreshTracking(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.refreshShipmentTracking({ kind: 'admin' }, id);
  }

  // sellers
  @Roles('MODERATOR')
  @Get('sellers')
  sellers(@Query() q: Record<string, string>) {
    return this.admin.sellersList({ status: q.status, search: q.search, page: Number(q.page) || 1 });
  }

  @Roles('MODERATOR')
  @Get('sellers/:id')
  seller(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.sellerDetail(id);
  }

  @Roles('MODERATOR')
  @Post('sellers/:id/action')
  sellerAction(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SellerActionDto) {
    return this.admin.sellerAction(user, id, dto.action, dto.reason);
  }

  @Roles('ADMIN')
  @Post('sellers')
  createSeller(@CurrentUser() user: RequestUser, @Body() dto: CreateSellerDto) {
    return this.admin.createSeller(user, dto);
  }

  @Roles('ADMIN')
  @Post('payout-accounts/:id/verify')
  verifyAccount(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto) {
    return this.admin.verifyPayoutAccount(user, id, dto.approve);
  }

  // categories
  @Roles('MODERATOR')
  @Get('categories')
  categories(@Query() q: Record<string, string>) {
    return this.admin.categoriesAdmin({ search: q.search, status: q.status });
  }

  @Roles('ADMIN')
  @Post('categories')
  createCategory(@Body() dto: CategoryDto) {
    return this.admin.saveCategory(dto);
  }

  @Roles('ADMIN')
  @Put('categories/:id')
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoryDto) {
    return this.admin.saveCategory({ ...dto, id });
  }

  @Roles('MODERATOR')
  @Get('categories/:id/attributes')
  categoryAttributes(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.categoryAttributes(id);
  }

  @Roles('ADMIN')
  @Put('attributes/:id')
  updateAttribute(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AttributeConfigDto) {
    return this.admin.updateAttributeConfig(id, dto);
  }

  @Roles('ADMIN')
  @Delete('categories/:id')
  archiveCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.archiveCategory(id);
  }

  // commissions / payouts / finance
  @Roles('ADMIN')
  @Get('commissions')
  commissions(@Query() q: Record<string, string>) {
    return this.admin.commissions({ from: q.from, to: q.to });
  }

  @Roles('ADMIN')
  @Get('payouts')
  payouts(@Query('status') status?: string) {
    return this.admin.payouts({ status });
  }

  @Roles('ADMIN')
  @Post('payouts/:id/action')
  payoutAction(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayoutActionDto) {
    return this.admin.payoutAction(user, id, dto.action, dto);
  }

  @Roles('ADMIN')
  @Get('finance')
  finance(@Query('days') days?: string) {
    return this.admin.finance(Math.min(Math.max(Number(days) || 30, 7), 365));
  }

  @Roles('ADMIN')
  @Post('finance/reconcile-sales')
  reconcileSales(@CurrentUser() user: RequestUser) {
    return this.admin.reconcileSales(user);
  }

  @Roles('ADMIN')
  @Get('transfers')
  transfers() {
    return this.admin.pendingTransfers();
  }

  @Roles('ADMIN')
  @Post('transfers/:id/confirm')
  confirmTransfer(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferDto) {
    return this.admin.confirmTransfer(user, id, dto.reference ?? '');
  }

  @Roles('ADMIN')
  @Post('transfers/:id/reject')
  rejectTransfer(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferDto) {
    return this.admin.rejectTransfer(user, id, dto.reason ?? '');
  }

  // settings
  @Roles('ADMIN')
  @Get('settings')
  settings() {
    return this.admin.getSettings();
  }

  @Roles('ADMIN')
  @Put('settings')
  updateSettings(@CurrentUser() user: RequestUser, @Body() dto: SettingsDto) {
    return this.admin.updateSettings(user, { ...(dto.settings ?? {}), commissionRate: dto.commissionRate });
  }

  // tax rates (destination country)
  @Roles('ADMIN')
  @Get('tax-rates')
  taxRates() {
    return this.admin.taxRates();
  }

  @Roles('ADMIN')
  @Put('tax-rates')
  saveTaxRate(@CurrentUser() user: RequestUser, @Body() dto: TaxRateDto) {
    return this.admin.saveTaxRate(user, dto);
  }

  @Roles('ADMIN')
  @Delete('tax-rates/:country')
  deleteTaxRate(@Param('country') country: string) {
    return this.admin.deleteTaxRate(country);
  }

  // users
  @Roles('ADMIN')
  @Get('users')
  users(@Query() q: Record<string, string>) {
    return this.admin.users({ search: q.search, role: q.role, page: Number(q.page) || 1 });
  }

  @Roles('ADMIN')
  @Post('users/:id/roles')
  setRole(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleDto) {
    return this.admin.setRole(user, id, dto.role, dto.grant);
  }

  @Roles('ADMIN')
  @Post('users/:id/status')
  setStatus(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UserStatusDto) {
    return this.admin.setUserStatus(user, id, dto.status);
  }
}
