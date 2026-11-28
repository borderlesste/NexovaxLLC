import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsString, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { IsCleanMultiline, IsCleanText } from '../common/validators';
import { CurrentUser, RequestUser, requireSeller } from '../auth/auth';
import { SellerRepliesService, type AutoReplyMode } from './seller-replies.service';

export class SavedReplyDto {
  @IsCleanText(1, 60) title: string;
  @IsCleanMultiline(1, 2000) body: string;
}

export class ReorderRepliesDto {
  @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids: string[];
}

export class HoursRangeDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(6) day: number;
  @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) open: string;
  @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) close: string;
}

export class AutoReplyDto {
  @IsBoolean() enabled: boolean;
  @IsIn(['OUTSIDE_HOURS', 'ALWAYS']) mode: AutoReplyMode;
  @IsCleanMultiline(0, 1000) message: string;
  @IsArray() @ArrayMaxSize(21) @ValidateNested({ each: true }) @Type(() => HoursRangeDto) hours: HoursRangeDto[];
}

/** Mi tienda → Mensajes → Respuestas: saved replies and the automatic reply outside store hours. */
@ApiTags('seller')
@Controller('seller')
export class SellerRepliesController {
  constructor(private readonly replies: SellerRepliesService) {}

  private sid(user: RequestUser, h?: string) {
    return requireSeller(user, h, 'MESSAGES').id;
  }

  @Get('saved-replies')
  list(@CurrentUser() user: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.replies.list(this.sid(user, h));
  }

  @Post('saved-replies')
  create(@CurrentUser() user: RequestUser, @Body() dto: SavedReplyDto, @Headers('x-seller-id') h?: string) {
    return this.replies.create(this.sid(user, h), user.id, dto);
  }

  @Post('saved-replies/order')
  reorder(@CurrentUser() user: RequestUser, @Body() dto: ReorderRepliesDto, @Headers('x-seller-id') h?: string) {
    return this.replies.reorder(this.sid(user, h), dto.ids);
  }

  @Put('saved-replies/:id')
  update(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SavedReplyDto, @Headers('x-seller-id') h?: string) {
    return this.replies.update(this.sid(user, h), id, dto);
  }

  @Delete('saved-replies/:id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.replies.remove(this.sid(user, h), id);
  }

  @Get('auto-reply')
  getAutoReply(@CurrentUser() user: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.replies.getAutoReply(this.sid(user, h));
  }

  @Put('auto-reply')
  setAutoReply(@CurrentUser() user: RequestUser, @Body() dto: AutoReplyDto, @Headers('x-seller-id') h?: string) {
    return this.replies.setAutoReply(this.sid(user, h), user.id, dto);
  }
}
