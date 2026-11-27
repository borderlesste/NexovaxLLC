import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { IsCleanText } from '../common/validators';
import { CurrentUser, FreshUser, RequestUser, requireSellerOwner, Roles } from '../auth/auth';
import {
  IDENTITY_DOCUMENT_TYPES, IDENTITY_MAX_FILES, IDENTITY_REJECTION_REASONS, IdentityDocumentType, IdentityRejectionReason, IdentityVerificationService,
} from './identity-verification.service';

const upload = { limits: { fileSize: 10 * 1024 * 1024, files: IDENTITY_MAX_FILES, fields: 5, parts: 10 } };
const OWNER_ONLY = 'Solo el propietario de la tienda puede solicitar la verificación de identidad.';

export class IdentityRequestDto {
  @IsIn(IDENTITY_DOCUMENT_TYPES as unknown as string[]) documentType: IdentityDocumentType;
  @IsOptional() @IsCleanText(0, 500) note?: string;
}
export class IdentityDecisionDto {
  @IsBoolean() approve: boolean;
  @IsOptional() @IsIn(IDENTITY_REJECTION_REASONS as unknown as string[]) reason?: IdentityRejectionReason;
  @IsOptional() @IsCleanText(0, 500) note?: string;
}

/** Store owner: request «Identidad verificada» (Vendedor → Configuración). */
@ApiTags('seller')
@Controller('seller/identity-verification')
export class SellerIdentityController {
  constructor(private readonly identity: IdentityVerificationService) {}

  @Get()
  status(@CurrentUser() user: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.identity.sellerStatus(requireSellerOwner(user, h, OWNER_ONLY).id);
  }

  @Post()
  @FreshUser()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @UseInterceptors(FilesInterceptor('files', IDENTITY_MAX_FILES, upload))
  submit(@CurrentUser() user: RequestUser, @Body() dto: IdentityRequestDto, @UploadedFiles() files: Express.Multer.File[], @Headers('x-seller-id') h?: string) {
    return this.identity.submit(user, requireSellerOwner(user, h, OWNER_ONLY).id, dto.documentType, files, dto.note);
  }

  @Delete()
  cancel(@CurrentUser() user: RequestUser, @Headers('x-seller-id') h?: string) {
    return this.identity.cancel(user, requireSellerOwner(user, h, OWNER_ONLY).id);
  }
}

/** Administrators only (not moderators or support): review queue, documents and decisions. */
@ApiTags('admin')
@Controller('admin/identity-verifications')
export class AdminIdentityController {
  constructor(private readonly identity: IdentityVerificationService) {}

  @Roles('ADMIN')
  @Get()
  list(@Query('status') status?: string) {
    return this.identity.adminList(status);
  }

  @Roles('ADMIN')
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.identity.adminDetail(id);
  }

  @Roles('ADMIN')
  @Get(':id/files/:fileId')
  async file(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Res() res: Response) {
    const f = await this.identity.adminFile(user, id, fileId);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Length', String(f.buffer.length));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    // Identity documents are never cached by the browser or any proxy.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.end(f.buffer);
  }

  @Roles('ADMIN')
  @FreshUser()
  @Post(':id/decision')
  decide(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IdentityDecisionDto) {
    return this.identity.decide(user, id, dto.approve, dto.reason, dto.note);
  }
}
