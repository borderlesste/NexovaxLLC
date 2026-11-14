import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { CurrentUser, RequestUser, Roles, requireSeller } from '../auth/auth';
import { IsMoney, ToNumber } from '../common/validators';
import { PayoutSchedulesService } from './payout-schedules.service';

export class PayoutScheduleDto {
  @IsBoolean() enabled: boolean;
  @IsIn(['WEEKLY', 'BIWEEKLY', 'MONTHLY']) frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  @ValidateIf((o) => o.frequency !== 'MONTHLY') @IsInt() @Min(1) @Max(7) weekday?: number;
  @ValidateIf((o) => o.frequency === 'MONTHLY') @IsInt() @Min(1) @Max(28) monthday?: number;
  @IsUUID() accountId: string;
  @IsOptional() @ToNumber() @IsMoney(0) minimumAmount?: number;
}

@ApiTags('payouts')
@Controller()
export class PayoutSchedulesController {
  constructor(private readonly schedules: PayoutSchedulesService) {}

  @Get('seller/payouts/schedule')
  get(@CurrentUser() u: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.schedules.get(requireSeller(u, h).id);
  }

  @Put('seller/payouts/schedule')
  set(@CurrentUser() u: RequestUser, @Body() dto: PayoutScheduleDto, @Headers('x-seller-id') h?: string) {
    return this.schedules.set(u, requireSeller(u, h).id, dto);
  }

  @Roles('ADMIN')
  @Get('admin/payouts/scheduled')
  upcoming() {
    return this.schedules.upcoming();
  }

  /** Finance can run a seller's schedule now (e.g. before a holiday). */
  @Roles('ADMIN')
  @Post('admin/payouts/scheduled/:sellerId/run')
  async runNow(@Param('sellerId', ParseUUIDPipe) sellerId: string) {
    const created = await this.schedules.runDue(sellerId);
    return { created, upcoming: await this.schedules.upcoming() };
  }
}
