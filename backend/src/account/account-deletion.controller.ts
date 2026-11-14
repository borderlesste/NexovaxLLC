import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Equals, IsOptional } from 'class-validator';
import { CurrentUser, RequestUser, Roles } from '../auth/auth';
import { IsCleanMultiline } from '../common/validators';
import { AccountDeletionService } from './account-deletion.service';

export class DeletionRequestDto {
  @Equals('ELIMINAR', { message: 'Escribe ELIMINAR para confirmar.' }) confirm: string;
  @IsOptional() @IsCleanMultiline(0, 1000) reason?: string;
}
export class DeletionRejectDto {
  @IsCleanMultiline(5, 1000) note: string;
}

@ApiTags('account')
@Controller()
export class AccountDeletionController {
  constructor(private readonly deletion: AccountDeletionService) {}

  @Get('me/account-deletion')
  status(@CurrentUser() u: RequestUser) {
    return this.deletion.status(u);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('me/account-deletion')
  request(@CurrentUser() u: RequestUser, @Body() dto: DeletionRequestDto) {
    return this.deletion.request(u, dto);
  }

  @Delete('me/account-deletion')
  cancel(@CurrentUser() u: RequestUser) {
    return this.deletion.cancel(u);
  }

  @Roles('ADMIN')
  @Get('admin/account-deletions')
  list(@Query('status') status?: string) {
    return this.deletion.list({ status });
  }

  @Roles('ADMIN')
  @Post('admin/account-deletions/:id/approve')
  approve(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deletion.approve(u, id);
  }

  @Roles('ADMIN')
  @Post('admin/account-deletions/:id/reject')
  reject(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeletionRejectDto) {
    return this.deletion.reject(u, id, dto.note);
  }
}
