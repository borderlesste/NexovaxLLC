import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { CurrentUser, RequestUser, requireSeller } from '../auth/auth';
import { MessagingService } from './messaging.service';

export class StartConversationDto {
  @IsOptional() @IsUUID() sellerId?: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsUUID() orderId?: string;
  @IsString() @Length(1, 4000) message: string;
}

export class SendMessageDto {
  @IsString() @Length(1, 4000) body: string;
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
  start(@CurrentUser() user: RequestUser, @Body() dto: StartConversationDto) {
    return this.messaging.start(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.get(user, id);
  }

  @Post(':id/messages')
  send(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto) {
    return this.messaging.send(user, id, dto.body, dto.clientKey);
  }
}
