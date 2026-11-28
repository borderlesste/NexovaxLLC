import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { TurnstileGuard } from '../auth/turnstile.guard';
import { requestLocale } from '../common/i18n-errors';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Transform, Type } from 'class-transformer';
import type { Response } from 'express';
import { ATTACHMENT_UPLOAD, sendAttachment } from '../messaging/messaging.controller';
import { MAX_MESSAGE_FILES, MessagingService } from '../messaging/messaging.service';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, isStaff, Public, RequestUser, Roles } from '../auth/auth';
import { IsBusinessName, IsCleanMultiline, IsCleanText, IsEmailAddress, IsOrderReference, IsPersonName, IsWebUrl } from '../common/validators';
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

/** Same report, sent without an account: name and e-mail are typed instead of taken from the session. */
export class GuestReportDto extends ReportDto {
  @IsPersonName(2, 120) name: string;
  @IsEmailAddress() email: string;
}

export class ReplyDto {
  @IsOptional() @IsCleanMultiline(0, 4000) body?: string;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() internal?: boolean;
}

export class TransitionDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED', 'CANCELLED']) status: string;
  @IsOptional() @IsCleanText(0, 300) reason?: string;
}

export class AssignDto {
  @IsOptional() @IsIn(['SUPPORT', 'MODERATION', 'FINANCE']) teamCode?: string;
  @IsOptional() @IsBoolean() assignToMe?: boolean;
  @IsOptional() @IsUUID() assigneeUserId?: string;
  @IsOptional() @IsBoolean() unassign?: boolean;
}

export class RatingDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5) score: number;
  @IsOptional() @IsCleanMultiline(0, 1000) comment?: string;
}

@ApiTags('support')
@Controller('support')
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly messaging: MessagingService,
  ) {}

  @Public()
  @Get('catalogs')
  async catalogs(@CurrentUser() user?: RequestUser) {
    const c = await this.support.catalogs();
    // Internal support teams are only for staff (used to assign reports).
    return isStaff(user, 'SUPPORT', 'MODERATOR') ? c : { categories: c.categories, priorities: c.priorities };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reports')
  @UseInterceptors(FilesInterceptor('files', MAX_MESSAGE_FILES, ATTACHMENT_UPLOAD))
  create(@CurrentUser() user: RequestUser, @Body() dto: ReportDto, @UploadedFiles() files?: Express.Multer.File[], @Headers('user-agent') ua?: string) {
    return this.support.create(user, { ...dto, client: ua }, files ?? []);
  }

  /**
   * Support without signing in (no account, or can't get in). Anti-bot check and a tight rate limit;
   * the request reaches the support inbox by e-mail and the team answers the visitor there.
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseGuards(TurnstileGuard)
  @Post('contact')
  contact(@Body() dto: GuestReportDto, @Req() req: Request) {
    return this.support.createGuest({ ...dto, locale: requestLocale(req) });
  }

  /** Evidence and attachments of a report (requester or support staff). */
  @Get('conversations/:id/attachments/:assetId')
  async attachment(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('assetId', ParseUUIDPipe) assetId: string, @Res() res: Response) {
    sendAttachment(res, await this.messaging.attachmentFile(user, id, assetId));
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

  /** The customer rates the help once the report is resolved. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reports/:id/rating')
  rate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RatingDto) {
    return this.support.rate(user, id, dto.score, dto.comment);
  }

  @Post('reports/:id/messages')
  @UseInterceptors(FilesInterceptor('files', MAX_MESSAGE_FILES, ATTACHMENT_UPLOAD))
  reply(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplyDto, @UploadedFiles() files?: Express.Multer.File[]) {
    return this.support.customerReply(user, id, dto.body ?? '', files ?? []);
  }

  // ---- staff
  @Roles('SUPPORT', 'MODERATOR')
  @Get('admin/tickets')
  adminList(@CurrentUser() user: RequestUser, @Query() q: Record<string, string>) {
    return this.support.adminList({ status: q.status, priority: q.priority, category: q.category, platform: q.platform, search: q.search, page: Number(q.page) || 1, assignee: q.assignee, viewerId: user.id });
  }

  @Roles('SUPPORT', 'MODERATOR')
  @Get('admin/agents')
  agents() {
    return this.support.agents();
  }

  @Roles('SUPPORT', 'MODERATOR')
  @Get('admin/stats')
  stats(@Query('days') days?: string) {
    return this.support.stats(Math.min(Math.max(Number(days) || 30, 7), 365));
  }

  @Roles('SUPPORT', 'MODERATOR')
  @Get('admin/tickets/:id')
  adminDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.adminDetail(id);
  }

  @Roles('SUPPORT', 'MODERATOR')
  @Get('admin/notes/:noteId/attachments/:assetId')
  async noteAttachment(@Param('noteId', ParseUUIDPipe) noteId: string, @Param('assetId', ParseUUIDPipe) assetId: string, @Res() res: Response) {
    sendAttachment(res, await this.support.noteAttachment(noteId, assetId));
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
  @UseInterceptors(FilesInterceptor('files', MAX_MESSAGE_FILES, ATTACHMENT_UPLOAD))
  adminReply(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplyDto, @UploadedFiles() files?: Express.Multer.File[]) {
    return this.support.reply(user, id, dto.body ?? '', !!dto.internal, files ?? []);
  }
}
