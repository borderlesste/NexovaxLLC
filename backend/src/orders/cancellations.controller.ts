import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { IsCleanMultiline, IsPaymentReference } from '../common/validators';
import { CurrentUser, RequestUser, Roles, requireSeller } from '../auth/auth';
import { CancellationsService } from './cancellations.service';

const REASON = Matches(/^[A-Z_]{2,40}$/, { message: 'Elige un motivo de la lista.' });

export class RequestCancellationDto {
  @IsUUID() sellerOrderId: string;
  @REASON reasonCode: string;
  @IsOptional() @IsCleanMultiline(0, 1000) note?: string;
}
export class CancelDto {
  @REASON reasonCode: string;
  @IsOptional() @IsCleanMultiline(0, 1000) note?: string;
  @IsOptional() @IsPaymentReference() manualReference?: string;
}
export class DecideCancellationDto {
  @IsOptional() @IsCleanMultiline(0, 1000) note?: string;
  @IsOptional() @IsPaymentReference() manualReference?: string;
}
export class RejectCancellationDto {
  @IsCleanMultiline(5, 1000) note: string;
}
export class RefundCancellationDto {
  @IsOptional() @IsPaymentReference() manualReference?: string;
}

@ApiTags('cancellations')
@Controller()
export class CancellationsController {
  constructor(private readonly cancellations: CancellationsService) {}

  // ---- customer
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('orders/:id/cancellations')
  request(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequestCancellationDto) {
    return this.cancellations.request(u, id, dto);
  }

  @Post('orders/cancellations/:id/withdraw')
  withdraw(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cancellations.withdraw(u, id);
  }

  // ---- seller
  @Post('seller/seller-orders/:id/cancel')
  sellerCancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto, @Headers('x-seller-id') h?: string) {
    return this.cancellations.sellerCancel(u, requireSeller(u, h, 'ORDERS').id, id, dto);
  }

  @Post('seller/cancellations/:id/approve')
  sellerApprove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideCancellationDto, @Headers('x-seller-id') h?: string) {
    return this.cancellations.approve(u, id, { sellerId: requireSeller(u, h, 'ORDERS').id }, { note: dto.note });
  }

  @Post('seller/cancellations/:id/reject')
  sellerReject(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectCancellationDto, @Headers('x-seller-id') h?: string) {
    return this.cancellations.reject(u, id, { sellerId: requireSeller(u, h, 'ORDERS').id }, dto.note);
  }

  // ---- staff (support operates; refunds move money: admins only)
  @Roles('SUPPORT')
  @Post('admin/seller-orders/:id/cancel')
  staffCancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.cancellations.staffCancel(u, id, dto);
  }

  @Roles('SUPPORT')
  @Post('admin/cancellations/:id/approve')
  staffApprove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideCancellationDto) {
    return this.cancellations.approve(u, id, { staff: true }, dto);
  }

  @Roles('SUPPORT')
  @Post('admin/cancellations/:id/reject')
  staffReject(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectCancellationDto) {
    return this.cancellations.reject(u, id, { staff: true }, dto.note);
  }

  @Roles('ADMIN')
  @Get('admin/cancellations/pending')
  pending() {
    return this.cancellations.pending();
  }

  @Roles('ADMIN')
  @Post('admin/cancellations/:id/refund')
  refund(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundCancellationDto) {
    return this.cancellations.refund(u, id, dto);
  }
}
