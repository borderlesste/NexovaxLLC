import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { CurrentUser, RequestUser, Roles } from '../auth/auth';
import { PaymentIncidentsService } from './incidents.service';

export class ReviewIncidentDto {
  @IsString() @Length(5, 500) note: string;
}

/** Disputes and refunds made outside NEXOVAX: money decisions, admins only. */
@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin/payment-incidents')
export class PaymentIncidentsController {
  constructor(private readonly incidents: PaymentIncidentsService) {}

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

  @Post(':id/review')
  review(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewIncidentDto) {
    return this.incidents.markReviewed(u, id, dto.note);
  }
}
