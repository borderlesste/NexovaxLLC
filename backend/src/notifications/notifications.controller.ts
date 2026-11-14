import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, RequestUser } from '../auth/auth';
import { NotificationsService } from './notifications.service';

const CATS = ['ORDERS', 'MESSAGES', 'RETURNS', 'PAYMENTS', 'SUPPORT', 'STORE', 'ACCOUNT'];

export class MarkReadDto {
  @IsOptional() @IsBoolean() all?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true }) ids?: string[];
}

export class PreferenceDto {
  @IsIn(CATS) code: string;
  @IsOptional() @IsBoolean() inApp?: boolean;
  @IsOptional() @IsBoolean() email?: boolean;
}

export class PreferencesDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PreferenceDto) preferences: PreferenceDto[];
}

@ApiTags('notifications')
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: RequestUser, @Query('unread') unread?: string, @Query('category') category?: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    return this.svc.list(u.id, {
      unread: unread === 'true',
      category: CATS.includes(category ?? '') ? category : undefined,
      before: before && !isNaN(Date.parse(before)) ? before : undefined,
      limit: limit ? Number(limit) || 20 : 20,
    });
  }

  @Get('unread-count')
  async count(@CurrentUser() u: RequestUser) {
    return { unread: await this.svc.unreadCount(u.id) };
  }

  @Post('read')
  read(@CurrentUser() u: RequestUser, @Body() dto: MarkReadDto) {
    return this.svc.markRead(u.id, dto.all ? 'ALL' : dto.ids ?? []);
  }

  @Delete(':id')
  dismiss(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.dismiss(u.id, id);
  }

  @Get('preferences')
  prefs(@CurrentUser() u: RequestUser) {
    return this.svc.preferences(u.id);
  }

  @Put('preferences')
  setPrefs(@CurrentUser() u: RequestUser, @Body() dto: PreferencesDto) {
    return this.svc.setPreferences(u.id, dto.preferences);
  }
}
