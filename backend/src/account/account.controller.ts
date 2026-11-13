import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, Public, RequestUser } from '../auth/auth';
import { AccountService } from './account.service';
import { SettingsService } from '../settings/settings.service';

const PHONE = /^\+?[0-9][0-9 ().-]{5,47}$/;

export class RegisterDto {
  @IsString() @Length(3, 120) fullName: string;
  @IsEmail({}, { message: 'Correo electrónico inválido.' }) email: string;
  @IsString() @MinLength(8) @MaxLength(72) password: string;
}

export class ProfileDto {
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsOptional() @Matches(PHONE, { message: 'Teléfono inválido.' }) phone?: string;
}

export class PasswordDto {
  @IsString() @MinLength(8) @MaxLength(72) password: string;
}

export class AddressDto {
  @IsOptional() @IsString() @MaxLength(60) label?: string;
  @IsString() @Length(2, 120) recipientName: string;
  @IsOptional() @IsString() @MaxLength(120) companyName?: string;
  @IsString() @Length(3, 200) line1: string;
  @IsOptional() @IsString() @MaxLength(200) line2?: string;
  @Type(() => Number) @IsInt() cityId: number;
  @IsOptional() @IsString() @MaxLength(80) region?: string;
  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @IsOptional() @Matches(PHONE, { message: 'Teléfono inválido.' }) phone?: string;
  @IsOptional() @IsBoolean() isDefaultShipping?: boolean;
}

@ApiTags('account')
@Controller()
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly settings: SettingsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/register')
  register(@Body() dto: RegisterDto) {
    return this.account.register(dto);
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.account.me(user);
  }

  @Put('me/profile')
  updateProfile(@CurrentUser() user: RequestUser, @Body() dto: ProfileDto) {
    return this.account.updateProfile(user, dto);
  }

  @Put('me/password')
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: PasswordDto) {
    return this.account.changePassword(user, dto.password);
  }

  @Public()
  @Get('geo/cities')
  cities(@Query('q') q?: string) {
    return this.account.cities(q);
  }

  @Get('me/addresses')
  addresses(@CurrentUser() user: RequestUser) {
    return this.account.addresses(user.id);
  }

  @Post('me/addresses')
  createAddress(@CurrentUser() user: RequestUser, @Body() dto: AddressDto) {
    return this.account.createAddress(user.id, dto);
  }

  @Put('me/addresses/:id')
  updateAddress(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddressDto) {
    return this.account.updateAddress(user.id, id, dto);
  }

  @Delete('me/addresses/:id')
  deleteAddress(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.deleteAddress(user.id, id);
  }

  @Get('me/favorites')
  async favorites(@CurrentUser() user: RequestUser) {
    return this.account.favorites(user.id, await this.settings.currency());
  }

  @Post('me/favorites/:productId')
  toggleFavorite(@CurrentUser() user: RequestUser, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.account.toggleFavorite(user.id, productId);
  }

  @Get('me/following')
  following(@CurrentUser() user: RequestUser) {
    return this.account.followedStores(user.id);
  }

  @Post('me/following/:sellerId')
  toggleFollow(@CurrentUser() user: RequestUser, @Param('sellerId', ParseUUIDPipe) sellerId: string) {
    return this.account.toggleFollow(user.id, sellerId);
  }
}
