import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CurrentUser, RequestUser, Roles } from '../auth/auth';
import { EDITABLE_POLICIES, PoliciesService, PolicyCode } from './policies.service';

class PolicyTextDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(20000) text?: string;
}
class PolicyLocalizationsDto {
  @ValidateNested() @Type(() => PolicyTextDto) es: PolicyTextDto;
  @IsOptional() @ValidateNested() @Type(() => PolicyTextDto) en?: PolicyTextDto;
  @IsOptional() @ValidateNested() @Type(() => PolicyTextDto) fr?: PolicyTextDto;
  @IsOptional() @ValidateNested() @Type(() => PolicyTextDto) ht?: PolicyTextDto;
}
export class PublishPolicyDto {
  @ValidateNested() @Type(() => PolicyLocalizationsDto) localizations: PolicyLocalizationsDto;
  @IsBoolean() requiresReacceptance: boolean;
  /** Empty = now; a future date schedules the version. */
  @IsOptional() @IsString() @MaxLength(40) effectiveAt?: string;
}

/** Legal texts: versioned and audited; publishing a version replaces the current one at once. */
@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin/policies')
export class PoliciesAdminController {
  constructor(private readonly policies: PoliciesService) {}

  @Get()
  list() {
    return this.policies.adminList();
  }

  @Post(':code/versions')
  publish(@CurrentUser() u: RequestUser, @Param('code') code: string, @Body() dto: PublishPolicyDto) {
    if (!EDITABLE_POLICIES.includes(code as PolicyCode)) return this.policies.publishVersion(u.id, '__invalid__', dto as any);
    return this.policies.publishVersion(u.id, code, dto as any);
  }

  @Delete(':code/versions/:id')
  cancel(@Param('code') code: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.policies.cancelScheduled(code, id);
  }
}
