import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { CurrentUser, RequestUser, Roles } from '../auth/auth';
import { ChargebackPolicyService } from './chargeback-policy.service';

class ComponentDto {
  @IsIn(['SELLER', 'PLATFORM', 'SHARED']) payer: 'SELLER' | 'PLATFORM' | 'SHARED';
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(99) sellerPercent?: number;
}
export class ChargebackPolicyDto {
  @ValidateNested() @Type(() => ComponentDto) principal: ComponentDto;
  @ValidateNested() @Type(() => ComponentDto) fee: ComponentDto;
}

/** Who bears lost disputes (money decision: administrators only). */
@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin/chargeback-policy')
export class ChargebackPolicyController {
  constructor(private readonly policy: ChargebackPolicyService) {}

  @Get()
  get() {
    return this.policy.get();
  }

  @Put()
  update(@CurrentUser() u: RequestUser, @Body() dto: ChargebackPolicyDto) {
    return this.policy.update(u, dto);
  }
}
