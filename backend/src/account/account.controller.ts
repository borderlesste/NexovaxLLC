import type { Request, Response } from 'express';
import { requestLocale } from '../common/i18n-errors';
import { badRequest } from '../common/errors';
import { PoliciesService } from './policies.service';
import { Body, Controller, Delete, Get, Header, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { AnalyticsService } from '../analytics/analytics.service';
import { AlertsService } from '../analytics/alerts.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, MinLength, IsArray, ArrayMinSize, ArrayMaxSize, IsUUID } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { CurrentUser, FreshUser, Public, RequestUser } from '../auth/auth';
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
  @IsOptional() @IsString() @MaxLength(1024) next?: string;
  /** The Terms and the Privacy policy shown next to the checkbox (current versions). */
  @IsBoolean() acceptTerms: boolean;
}

export class AcceptPoliciesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsUUID('all', { each: true }) versionIds: string[];
}

export class DeliveryCountryDto {
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) country?: string | null;
}

export class LocaleDto {
  @IsIn(['es', 'en', 'fr', 'ht']) locale: string;
}

export class RecoveryDto {
  @IsEmailAddress() email: string;
}

export class ResendVerificationDto extends RecoveryDto {
  @IsOptional() @IsString() @MaxLength(1024) next?: string;
}

export class LoginDto {
  @IsEmailAddress() email: string;
  @IsString() @MinLength(1) @MaxLength(128) password: string;
}

export class ProfileDto {
  @IsOptional() @IsOptionalPersonName(80) firstName?: string;
  @IsOptional() @IsOptionalPersonName(80) lastName?: string;
  @IsOptional() @IsPhone() phone?: string;
}

const cropNumber = () => Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value) : value);

export class WelcomeBadgeDto {
  @IsCleanText(1, 64) publicName: string;
  @cropNumber() @IsNumber() @Min(1) @Max(3) zoom: number;
  @cropNumber() @IsNumber() @Min(-1) @Max(1) x: number;
  @cropNumber() @IsNumber() @Min(-1) @Max(1) y: number;
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

  /**
   * Password sign-in through the API, so browsers only see our domain. The Turnstile token
   * (cf-turnstile-response) is passed on to Supabase Auth, which verifies it: tokens are single-use,
   * so TurnstileGuard is not applied here. The web stores the returned session itself.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/login')
  login(@Body() dto: LoginDto, @Headers('cf-turnstile-response') captchaToken?: string) {
    return this.account.login(dto.email, dto.password, captchaToken);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseGuards(TurnstileGuard)
  @Post('auth/resend-verification')
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.account.resendVerification(dto.email, dto.next);
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

  @FreshUser()
  @Get('me/welcome-badge')
  async welcomeBadge(@CurrentUser() user: RequestUser, @Res() res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const badge = await this.account.getWelcomeBadge(user);
    res.json(badge);
  }

  @FreshUser()
  @Get('me/welcome-badge/photo')
  async welcomeBadgePhoto(@CurrentUser() user: RequestUser, @Res() res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    const photo = await this.account.getWelcomeBadgePhoto(user);
    res.type('image/webp').send(photo);
  }

  @FreshUser()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'private, no-store')
  @Post('me/welcome-badge')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, fieldSize: 1024, files: 1, fields: 4, parts: 6 } }))
  saveWelcomeBadge(@CurrentUser() user: RequestUser, @Body() dto: WelcomeBadgeDto, @UploadedFile() file?: Express.Multer.File) {
    return this.account.saveWelcomeBadge(user, dto, file);
  }

  @Put('me/password')
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: PasswordDto) {
    return this.account.changePassword(user, dto.password);
  }

  @Put('me/delivery-country')
  setDeliveryCountry(@CurrentUser() user: RequestUser, @Body() dto: DeliveryCountryDto) {
    return this.account.setDeliveryCountry(user, dto.country ?? null);
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
    if (user.sellers.some((s) => s.id === sellerId)) throw badRequest('SELF_FOLLOW', 'No puedes seguir tu propia tienda.');
    return this.account.toggleFollow(user.id, sellerId);
  }
}
