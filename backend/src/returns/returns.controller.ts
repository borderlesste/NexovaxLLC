import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform, Type, plainToInstance } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, RequestUser, Roles, requireSeller } from '../auth/auth';
import { IsCleanMultiline, IsCleanText, IsTrackingNumber } from '../common/validators';
import { ATTACHMENT_UPLOAD, sendAttachment } from '../messaging/messaging.controller';
import { MAX_MESSAGE_FILES } from '../messaging/messaging.service';
import { ReturnsService } from './returns.service';

const parseJson = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export class ReturnItemDto {
  @IsUUID() orderItemId: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(9999) quantity: number;
  @Matches(/^[A-Z0-9_]{2,40}$/, { message: 'Selecciona el motivo.' }) reasonCode: string;
  @IsOptional() @IsCleanMultiline(0, 500) comment?: string;
}

export class CreateReturnDto {
  @IsUUID() sellerOrderId: string;
  @IsOptional() @IsCleanMultiline(0, 1000) comment?: string;
  @Transform(({ value }) => plainToInstance(ReturnItemDto, parseJson({ value }) as object[]))
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ReturnItemDto) items: ReturnItemDto[];
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9-]{8,80}$/) idempotencyKey?: string;
}

export class ReturnShippedDto {
  @IsCleanText(2, 80) carrier: string;
  @IsOptional() @IsTrackingNumber() trackingNumber?: string;
}

export class ApproveItemDto {
  @IsUUID() returnItemId: string;
  @IsInt() @Min(0) @Max(9999) quantity: number;
}
export class ApproveReturnDto {
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ApproveItemDto) items?: ApproveItemDto[];
  @IsOptional() @IsCleanMultiline(0, 500) comment?: string;
}
export class RejectReturnDto {
  @IsCleanMultiline(5, 500) reason: string;
}
export class InspectItemDto {
  @IsUUID() returnItemId: string;
  @IsInt() @Min(0) @Max(9999) accepted: number;
  @IsInt() @Min(0) @Max(9999) restock: number;
  @IsIn(['NEW', 'OPENED', 'USED', 'DAMAGED']) condition: string;
}
export class InspectReturnDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => InspectItemDto) items: InspectItemDto[];
  @IsOptional() @IsCleanMultiline(0, 1000) notes?: string;
}
export class RefundReturnDto {
  @IsOptional() @Matches(/^[A-Za-z0-9 ._/-]{3,60}$/, { message: 'Referencia inválida (letras, números y - . _ /).' }) manualReference?: string;
}

const page = (p?: string) => Math.max(Number(p) || 1, 1);

@ApiTags('returns')
@Controller()
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  // ---- customer
  @Get('me/returns/reasons')
  reasons() {
    return this.returns.reasons();
  }

  @Get('me/orders/:orderId/returnable')
  eligibility(@CurrentUser() u: RequestUser, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.returns.eligibility(u, orderId);
  }

  @Get('me/returns')
  mine(@CurrentUser() u: RequestUser, @Query('status') status?: string, @Query('page') p?: string) {
    return this.returns.list(u, { as: 'customer' }, { status, page: page(p) });
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('me/returns')
  @UseInterceptors(FilesInterceptor('files', MAX_MESSAGE_FILES, ATTACHMENT_UPLOAD))
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateReturnDto, @UploadedFiles() files?: Express.Multer.File[]) {
    return this.returns.create(u, dto, files ?? [], dto.idempotencyKey);
  }

  @Get('me/returns/:id')
  myDetail(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.detail(u, id, { as: 'customer' });
  }

  @Post('me/returns/:id/cancel')
  cancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.cancel(u, id);
  }

  @Post('me/returns/:id/shipped')
  shipped(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnShippedDto) {
    return this.returns.markShipped(u, id, dto);
  }

  /** Evidence photos (customer, store or staff). */
  @Get('returns/:id/evidence/:assetId')
  async evidence(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('assetId', ParseUUIDPipe) assetId: string, @Res() res: Response) {
    sendAttachment(res, await this.returns.evidenceFile(u, id, assetId));
  }

  // ---- seller
  @Get('seller/returns')
  sellerList(@CurrentUser() u: RequestUser, @Headers('x-seller-id') h?: string, @Query('status') status?: string, @Query('page') p?: string) {
    return this.returns.list(u, { as: 'seller', sellerId: requireSeller(u, h).id }, { status, page: page(p) });
  }

  @Get('seller/returns/:id')
  sellerDetail(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.returns.detail(u, id, { as: 'seller', sellerId: requireSeller(u, h).id });
  }

  @Post('seller/returns/:id/approve')
  sellerApprove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveReturnDto, @Headers('x-seller-id') h?: string) {
    return this.returns.approve(u, id, { as: 'seller', sellerId: requireSeller(u, h).id }, dto);
  }

  @Post('seller/returns/:id/reject')
  sellerReject(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectReturnDto, @Headers('x-seller-id') h?: string) {
    return this.returns.reject(u, id, { as: 'seller', sellerId: requireSeller(u, h).id }, dto);
  }

  @Post('seller/returns/:id/receive')
  sellerReceive(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.returns.receive(u, id, { as: 'seller', sellerId: requireSeller(u, h).id });
  }

  @Post('seller/returns/:id/inspect')
  sellerInspect(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InspectReturnDto, @Headers('x-seller-id') h?: string) {
    return this.returns.inspect(u, id, { as: 'seller', sellerId: requireSeller(u, h).id }, dto);
  }

  // ---- staff
  @Roles('SUPPORT')
  @Get('admin/returns')
  adminList(@CurrentUser() u: RequestUser, @Query('status') status?: string, @Query('page') p?: string) {
    return this.returns.list(u, { as: 'staff' }, { status, page: page(p) });
  }

  @Roles('SUPPORT')
  @Get('admin/returns/:id')
  adminDetail(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.detail(u, id, { as: 'staff' });
  }

  @Roles('SUPPORT')
  @Post('admin/returns/:id/approve')
  adminApprove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveReturnDto) {
    return this.returns.approve(u, id, { as: 'staff' }, dto);
  }

  @Roles('SUPPORT')
  @Post('admin/returns/:id/reject')
  adminReject(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectReturnDto) {
    return this.returns.reject(u, id, { as: 'staff' }, dto);
  }

  @Roles('SUPPORT')
  @Post('admin/returns/:id/receive')
  adminReceive(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.receive(u, id, { as: 'staff' });
  }

  @Roles('SUPPORT')
  @Post('admin/returns/:id/inspect')
  adminInspect(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InspectReturnDto) {
    return this.returns.inspect(u, id, { as: 'staff' }, dto);
  }

  /** Money goes back to the buyer: finance admins only (ADMIN / SUPER_ADMIN). */
  @Roles('ADMIN')
  @Post('admin/returns/:id/refund')
  adminRefund(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundReturnDto) {
    return this.returns.refund(u, id, dto);
  }
}
