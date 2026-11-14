import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, Public, RequestUser } from '../auth/auth';
import { IsAddressLine, IsBusinessName, IsCleanText, IsCountryCode, IsEmailAddress, IsOptionalPersonName, IsPersonName, IsPhone, IsPlaceName, IsPostalCode } from '../common/validators';
import { AccountService } from './account.service';
import { SettingsService } from '../settings/settings.service';

const PHONE = /^\+?[0-9][0-9 ().-]{5,47}$/;

export class RegisterDto {
  @IsPersonName(3, 120) fullName: string;
  @IsEmailAddress() email: string;
  @IsString() @MinLength(8) @MaxLength(72) password: string;
  @IsOptional() @IsIn(['es', 'en']) locale?: string;
}

export class LocaleDto {
  @IsIn(['es', 'en']) locale: string;
}

export class RecoveryDto {
  @IsEmailAddress() email: string;
}

export class ProfileDto {
  @IsOptional() @IsOptionalPersonName(80) firstName?: string;
  @IsOptional() @IsOptionalPersonName(80) lastName?: string;
  @IsOptional() @IsPhone() phone?: string;
}

export class PasswordDto {
  @IsString() @MinLength(8) @MaxLength(72) password: string;
}

export class AddressDto {
  @IsOptional() @IsCleanText(0, 60) label?: string;
  @IsPersonName(2, 120) recipientName: string;
  @IsOptional() @IsBusinessName(2, 120) companyName?: string;
  @IsAddressLine(3, 200) line1: string;
  @IsOptional() @IsAddressLine(1, 200) line2?: string;
  @IsCountryCode() countryCode: string;
  @IsPlaceName(2, 100) city: string;
  @IsOptional() @IsPlaceName(2, 80) region?: string;
  @IsOptional() @IsPostalCode() postalCode?: string;
  @IsOptional() @IsPhone() phone?: string;
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

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('auth/resend-verification')
  resendVerification(@Body() dto: RecoveryDto) {
    return this.account.resendVerification(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('auth/password-recovery')
  passwordRecovery(@Body() dto: RecoveryDto) {
    return this.account.requestPasswordRecovery(dto.email);
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.account.me(user);
  }

  @Put('me/profile')
  updateProfile(@CurrentUser() user: RequestUser, @Body() dto: ProfileDto) {
    return this.account.updateProfile(user, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 5, parts: 6 } }))
  setAvatar(@CurrentUser() user: RequestUser, @UploadedFile() file?: Express.Multer.File) {
    return this.account.setAvatar(user, file);
  }

  @Delete('me/avatar')
  removeAvatar(@CurrentUser() user: RequestUser) {
    return this.account.removeAvatar(user);
  }

  @Put('me/password')
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: PasswordDto) {
    return this.account.changePassword(user, dto.password);
  }

  @Put('me/locale')
  setLocale(@CurrentUser() user: RequestUser, @Body() dto: LocaleDto) {
    return this.account.setLocale(user, dto.locale);
  }

  @Public()
  @Get('geo/countries')
  countries() {
    return this.account.countries();
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
