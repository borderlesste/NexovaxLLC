import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Matches } from 'class-validator';
import { CurrentUser, RequestUser } from '../auth/auth';
import { CardsService } from './cards.service';

export class ConfirmCardDto {
  @Matches(/^seti_[A-Za-z0-9]{6,80}$/, { message: 'Operación inválida.' }) setupIntentId: string;
}

@ApiTags('cards')
@Controller('me/cards')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Get()
  async list(@CurrentUser() u: RequestUser) {
    return { enabled: this.cards.enabled, cards: this.cards.enabled ? await this.cards.list(u.id) : [] };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('setup')
  setup(@CurrentUser() u: RequestUser) {
    return this.cards.setup(u.id);
  }

  @Post('confirm')
  confirm(@CurrentUser() u: RequestUser, @Body() dto: ConfirmCardDto) {
    return this.cards.confirmSetup(u.id, dto.setupIntentId);
  }

  @Post(':id/default')
  setDefault(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cards.setDefault(u.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cards.remove(u.id, id);
  }
}
