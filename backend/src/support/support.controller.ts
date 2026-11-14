import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { CurrentUser, Public, RequestUser, Roles } from '../auth/auth';
import { IsBusinessName, IsCleanMultiline, IsCleanText, IsOrderReference, IsWebUrl } from '../common/validators';
import { SupportService } from './support.service';

export class ReportDto {
  @Matches(/^[A-Z_]{2,40}$/, { message: 'Tipo de reporte inválido.' }) categoryCode: string;
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']) priority: any;
  @IsCleanText(4, 140) subject: string;
  @IsCleanMultiline(10, 1000) description: string;
  @IsOptional() @IsWebUrl(300) url?: string;
  @IsOptional() @IsOrderReference() orderNumber?: string;
  @IsOptional() @IsBusinessName(2, 120) storeName?: string;
  @IsOptional() @IsIn(['WEB', 'MOBILE', 'OTHER']) platform?: any;
}

export class ReplyDto {
  @IsCleanMultiline(1, 4000) body: string;
  @IsOptional() @IsBoolean() internal?: boolean;
}

export class TransitionDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED', 'CANCELLED']) status: string;
  @IsOptional() @IsCleanText(0, 300) reason?: string;
}

export class AssignDto {
  @IsOptional() @IsIn(['SUPPORT', 'MODERATION', 'FINANCE']) teamCode?: string;
  @IsOptional() @IsBoolean() assignToMe?: boolean;
}

@ApiTags('support')
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Public()
  @Get('catalogs')
  catalogs() {
    return this.support.catalogs();
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reports')
  create(@CurrentUser() user: RequestUser, @Body() dto: ReportDto) {
    return this.support.create(user, dto);
  }

  /** Status lookup by code — only the requester or support staff (codes are sequential). */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('track/:code')
  track(@Param('code') code: string, @CurrentUser() user: RequestUser) {
    return this.support.track(code, user);
  }

  @Get('reports')
  mine(@CurrentUser() user: RequestUser) {
    return this.support.mine(user);
  }

  @Get('reports/:id')
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.customerDetail(user, id);
  }

  @Post('reports/:id/messages')
  reply(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplyDto) {
    return this.support.customerReply(user, id, dto.body);
  }

  // ---- staff
  @Roles('SUPPORT', 'MODERATOR')
  @Get('admin/tickets')
  adminList(@Query() q: Record<string, string>) {
    return this.support.adminList({ status: q.status, priority: q.priority, category: q.category, search: q.search, page: Number(q.page) || 1 });
  }

  @Roles('SUPPORT', 'MODERATOR')
  @Get('admin/tickets/:id')
  adminDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.adminDetail(id);
  }

  @Roles('SUPPORT', 'MODERATOR')
  @Post('admin/tickets/:id/assign')
  assign(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    return this.support.assign(user, id, dto);
  }

  @Roles('SUPPORT', 'MODERATOR')
  @Post('admin/tickets/:id/status')
  transition(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionDto) {
    return this.support.transition(user, id, dto.status, dto.reason);
  }

  @Roles('SUPPORT', 'MODERATOR')
  @Post('admin/tickets/:id/reply')
  adminReply(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplyDto) {
    return this.support.reply(user, id, dto.body, !!dto.internal);
  }
}
