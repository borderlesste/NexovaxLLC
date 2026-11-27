import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { DisputeResponseService, EvidenceFileKind } from './dispute-response.service';
import { ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, RequestUser, Roles } from '../auth/auth';
import { PaymentIncidentsService } from './incidents.service';

export class DisputeAnswerDto {
  @IsString() @Length(20, 5000) note: string;
  @IsOptional() @IsString() @Length(0, 1000) productDescription?: string;
  @IsOptional() @IsString() @Length(0, 80) carrier?: string;
  @IsOptional() @IsString() @Length(0, 80) trackingNumber?: string;
  @IsOptional() @IsString() @Length(0, 10) shippingDate?: string;
  /** Kind of each attached file, in order (multipart sends it as a comma list). */
  @IsOptional() @IsString() @Length(0, 200) kinds?: string;
}
export class AcceptDisputeDto {
  @IsString() @Length(5, 2000) note: string;
}

class BookItemDto {
  @IsUUID() orderItemId: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(1000) quantity: number;
}
export class BookPartialDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => BookItemDto) items: BookItemDto[];
}

export class ReviewIncidentDto {
  @IsString() @Length(5, 500) note: string;
}

/** Disputes and refunds made outside NEXOVAX: money decisions, admins only. */
@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin/payment-incidents')
export class PaymentIncidentsController {
  constructor(
    private readonly incidents: PaymentIncidentsService,
    private readonly responses: DisputeResponseService,
  ) {}

  /** Evidence draft built from the order (customer, address, carrier, tracking, delivery). */
  @Get(':id/dispute-response')
  draft(@Param('id', ParseUUIDPipe) id: string) {
    return this.responses.draft(id);
  }

  @Post(':id/dispute-response')
  @UseInterceptors(FilesInterceptor('files', 4, { limits: { fileSize: 4 * 1024 * 1024, files: 4, fields: 10, parts: 16, fieldSize: 64 * 1024 } }))
  respond(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisputeAnswerDto, @UploadedFiles() files: Express.Multer.File[] = []) {
    const kinds = (dto.kinds ?? '').split(',');
    const ok = (k: string): k is EvidenceFileKind => ['RECEIPT', 'SHIPPING', 'COMMUNICATION', 'OTHER'].includes(k);
    return this.responses.respond(u, id, dto, (files ?? []).map((f, n) => ({ ...f, kind: ok(kinds[n]) ? kinds[n] as EvidenceFileKind : 'OTHER' })));
  }

  @Post(':id/dispute-accept')
  acceptDispute(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcceptDisputeDto) {
    return this.responses.accept(u, id, dto.note);
  }

  @Get()
  list(@Query('status') status?: string) {
    return this.incidents.list(status === 'ALL' ? 'ALL' : 'OPEN');
  }

  @Get('count')
  async count() {
    return { open: await this.incidents.openCount() };
  }

  @Post(':id/retry')
  retry(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.retry(u, id);
  }

  @Post(':id/cancel-order')
  cancelOrder(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.cancelOrder(u, id);
  }

  @Get(':id/partial-options')
  partialOptions(@Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.partialOptions(id);
  }

  @Post(':id/book-partial')
  bookPartial(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BookPartialDto) {
    return this.incidents.bookPartial(u, id, dto.items);
  }

  @Post(':id/review')
  review(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewIncidentDto) {
    return this.incidents.markReviewed(u, id, dto.note);
  }
}
