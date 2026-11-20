import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, RequestUser, requireSeller, requireSellerOwner, SELLER_AREAS } from '../auth/auth';
import { TeamService } from './team.service';

export class TeamInviteDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsArray() @ArrayMaxSize(SELLER_AREAS.length) @IsIn(SELLER_AREAS as unknown as string[], { each: true }) areas: string[];
}

export class TeamMemberDto {
  @IsOptional() @IsArray() @ArrayMaxSize(SELLER_AREAS.length) @IsIn(SELLER_AREAS as unknown as string[], { each: true }) areas?: string[];
  @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED']) status?: 'ACTIVE' | 'SUSPENDED';
}

export class TeamTokenDto {
  @IsString() @MaxLength(200) token: string;
}

const OWNER_ONLY = 'Solo el propietario de la tienda puede gestionar el equipo.';

@ApiTags('seller-team')
@Controller()
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get('seller/team')
  list(@CurrentUser() u: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.team.list(requireSellerOwner(u, h, OWNER_ONLY).id);
  }

  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Post('seller/team/invitations')
  invite(@CurrentUser() u: RequestUser, @Body() dto: TeamInviteDto, @Headers('x-seller-id') h?: string) {
    return this.team.invite(u, requireSellerOwner(u, h, OWNER_ONLY).id, dto);
  }

  @Delete('seller/team/invitations/:id')
  revoke(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.team.revokeInvitation(requireSellerOwner(u, h, OWNER_ONLY).id, id);
  }

  @Put('seller/team/members/:id')
  update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TeamMemberDto, @Headers('x-seller-id') h?: string) {
    return this.team.updateMember(u, requireSellerOwner(u, h, OWNER_ONLY).id, id, dto);
  }

  @Delete('seller/team/members/:id')
  remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-seller-id') h?: string) {
    return this.team.removeMember(u, requireSellerOwner(u, h, OWNER_ONLY).id, id);
  }

  /** A member leaves the store they act for. */
  @Post('seller/team/leave')
  leave(@CurrentUser() u: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.team.leave(u, requireSeller(u, h).id);
  }

  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @Get('team/invitations/preview')
  preview(@CurrentUser() u: RequestUser, @Query('token') token: string) {
    return this.team.preview(u, String(token ?? ''));
  }

  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('team/invitations/accept')
  accept(@CurrentUser() u: RequestUser, @Body() dto: TeamTokenDto) {
    return this.team.accept(u, dto.token);
  }
}
