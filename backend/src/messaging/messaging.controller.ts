import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { IsCleanMultiline } from '../common/validators';
import { CurrentUser, RequestUser, requireSeller } from '../auth/auth';
import { MAX_MESSAGE_FILES, MessagingService } from './messaging.service';

/** Multipart limits: up to 4 files of 10 MB (images are re-encoded, PDFs checked). */
export const ATTACHMENT_UPLOAD = { limits: { fileSize: 10 * 1024 * 1024, files: MAX_MESSAGE_FILES, fields: 10, parts: 16 } };

export function sendAttachment(res: Response, f: { buffer: Buffer; mime: string; name: string }) {
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Length', String(f.buffer.length));
  res.setHeader('Content-Disposition', `${f.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.end(f.buffer);
}

export class StartConversationDto {
  @IsOptional() @IsUUID() sellerId?: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsUUID() orderId?: string;
  @IsCleanMultiline(1, 4000) message: string;
}

export class SendMessageDto {
  @IsOptional() @IsCleanMultiline(0, 4000) body?: string;
  @IsOptional() @IsString() @MaxLength(100) clientKey?: string;
}

@ApiTags('messaging')
@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query('as') as?: string, @Query('q') q?: string, @Headers('x-seller-id') h?: string) {
    if (as === 'seller') return this.messaging.list(user, { as: 'seller', sellerId: requireSeller(user, h).id }, q);
    return this.messaging.list(user, { as: 'customer' }, q);
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FilesInterceptor('files', MAX_MESSAGE_FILES, ATTACHMENT_UPLOAD))
  start(@CurrentUser() user: RequestUser, @Body() dto: StartConversationDto, @UploadedFiles() files?: Express.Multer.File[]) {
    return this.messaging.start(user, dto, files ?? []);
  }

  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.get(user, id);
  }

  @Post(':id/messages')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(FilesInterceptor('files', MAX_MESSAGE_FILES, ATTACHMENT_UPLOAD))
  send(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto, @UploadedFiles() files?: Express.Multer.File[]) {
    return this.messaging.send(user, id, dto.body ?? '', dto.clientKey, files ?? []);
  }

  @Get(':id/attachments/:assetId')
  async attachment(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('assetId', ParseUUIDPipe) assetId: string, @Res() res: Response) {
    sendAttachment(res, await this.messaging.attachmentFile(user, id, assetId));
  }
}
