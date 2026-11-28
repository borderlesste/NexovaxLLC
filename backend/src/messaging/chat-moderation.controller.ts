import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { IsCleanMultiline } from '../common/validators';
import { CurrentUser, RequestUser, Roles } from '../auth/auth';
import { ChatModerationService, REPORT_ACTIONS, type ReportAction } from './chat-moderation.service';

export class ResolveReportDto {
  @IsIn(REPORT_ACTIONS as unknown as string[]) action: ReportAction;
  @IsOptional() @IsCleanMultiline(0, 1000) note?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}

export class HideMessageDto {
  @IsBoolean() hidden: boolean;
  @IsOptional() @IsCleanMultiline(0, 1000) note?: string;
}

/** Admin → Moderación → Mensajes reportados. */
@ApiTags('admin')
@Controller('admin')
export class ChatModerationController {
  constructor(private readonly moderation: ChatModerationService) {}

  @Roles('MODERATOR')
  @Get('chat-reports')
  queue(@Query() q: Record<string, string>) {
    return this.moderation.queue({ status: q.status, search: q.search, page: Number(q.page) || 1 });
  }

  @Roles('MODERATOR', 'SUPPORT')
  @Get('chat-reports/count')
  async count() {
    return { open: await this.moderation.openCount() };
  }

  @Roles('MODERATOR')
  @Get('chat-reports/:messageId')
  detail(@Param('messageId', ParseUUIDPipe) messageId: string) {
    return this.moderation.detail(messageId);
  }

  @Roles('MODERATOR')
  @Post('chat-reports/:messageId/resolve')
  resolve(@CurrentUser() user: RequestUser, @Param('messageId', ParseUUIDPipe) messageId: string, @Body() dto: ResolveReportDto) {
    return this.moderation.resolve(user, messageId, dto.action, dto.note, dto.days);
  }

  @Roles('MODERATOR')
  @Post('chat-messages/:messageId/visibility')
  visibility(@CurrentUser() user: RequestUser, @Param('messageId', ParseUUIDPipe) messageId: string, @Body() dto: HideMessageDto) {
    return this.moderation.setHidden(user, messageId, dto.hidden, dto.note);
  }

  @Roles('MODERATOR')
  @Post('messaging-restrictions/:id/lift')
  lift(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.moderation.liftRestriction(user, id);
  }
}
