import type { Request } from 'express';
import { requestLocale } from '../common/i18n-errors';
import { PoliciesService } from './policies.service';
import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { AnalyticsService } from '../analytics/analytics.service';
import { AlertsService } from '../analytics/alerts.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength, IsArray, ArrayMinSize, ArrayMaxSize, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, Public, RequestUser } from '../auth/auth';
import { TurnstileGuard } from '../auth/turnstile.guard';
import { IsAddressLine, IsBusinessName, IsCleanText, IsCountryCode, IsEmailAddress, IsOptionalPersonName, IsPersonName, IsPhone, IsPlaceName, IsPostalCode } from '../common/validators';
import { AccountService } from './account.service';
import { SettingsService } from '../settings/settings.service';

const PHONE = /^\+?[0-9][0-9 ().-]{5,47}$/;

export class RegisterDto {
  @IsPersonName(3, 120) fullName: string;
  @IsEmailAddress() email: string;
  @IsString() @MinLength(8) @MaxLength(72) password: string;
  @IsOptional() @IsIn(['es', 'en', 'fr', 'ht']) locale?: string;
  /** The Terms and the Privacy policy shown next to the checkbox (current versions). */
  @IsBoolean() acceptTerms: boolean;
}

export class AcceptPoliciesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsUUID('all', { each: true }) versionIds: string[];
}

export class LocaleDto {
  @IsIn(['es', 'en', 'fr', 'ht']) locale: string;
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
    private readonly analytics: AnalyticsService,
    private readonly alerts: AlertsService,
    private readonly policies_: PoliciesService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(TurnstileGuard)
  @Post('auth/register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.account.register(dto, { ip: req.ip ?? null, userAgent: String(req.headers['user-agent'] ?? '') || null });
  }

  /** Current legal policies (terms, privacy, seller terms) in the request language. */
  @Public()
  @Get('policies')
  policies(@Req() req: Request) {
    return this.policies_.current(requestLocale(req));
  }

  /** Policies this account still has to accept (new versions or accounts created elsewhere). */
  @Get('me/policies/pending')
  pendingPolicies(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.policies_.pending(user.id, requestLocale(req));
  }

  @Post('me/policies/accept')
  async acceptPolicies(@CurrentUser() user: RequestUser, @Body() dto: AcceptPoliciesDto, @Req() req: Request) {
    await this.policies_.acceptPending(user.id, dto.versionIds, { method: 'LOGIN_GATE', locale: requestLocale(req), ip: req.ip ?? null, userAgent: String(req.headers['user-agent'] ?? '') || null });
    return { pending: await this.policies_.pending(user.id, requestLocale(req)) };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseGuards(TurnstileGuard)
  @Post('auth/resend-verification')
  resendVerification(@Body() dto: RecoveryDto) {
    return this.account.resendVerification(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseGuards(TurnstileGuard)
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
  async toggleFavorite(@CurrentUser() user: RequestUser, @Param('productId', ParseUUIDPipe) productId: string, @Headers('x-nx-consent') consent?: string) {
    const r = await this.account.toggleFavorite(user.id, productId);
    void this.analytics.recordServer(r.favorite ? 'FAVORITE' : 'UNFAVORITE', productId, user.id, consent === 'analytics');
    if (r.favorite) await this.alerts.watch(user.id, productId, 'FAVORITE');
    return r;
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
