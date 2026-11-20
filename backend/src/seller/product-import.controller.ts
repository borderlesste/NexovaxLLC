import { Body, Controller, Headers, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { CurrentUser, RequestUser, requireSeller } from '../auth/auth';
import { badRequest } from '../common/errors';
import { AlertsService } from '../analytics/alerts.service';
import { ProductImportService } from './product-import.service';

const short = () => (target: object, key: string) => {
  IsOptional()(target, key);
  IsString()(target, key);
  MaxLength(300)(target, key);
};

/** One spreadsheet row as returned by the preview (every cell is text). */
export class ImportRowDto {
  @IsInt() @Min(1) row: number;
  @short() group?: string;
  @IsOptional() @IsString() @MaxLength(140) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @short() category?: string;
  @short() brand?: string;
  @short() price?: string;
  @short() compareAtPrice?: string;
  @short() stock?: string;
  @short() sku?: string;
  @short() weightKg?: string;
  @short() lengthCm?: string;
  @short() widthCm?: string;
  @short() heightCm?: string;
  @IsOptional() @IsString() @MaxLength(4000) images?: string;
  @short() option1Name?: string;
  @short() option1Value?: string;
  @short() option2Name?: string;
  @short() option2Value?: string;
}

export class ImportCommitDto {
  /** A few whole products per request (rows of one Grupo always travel together). */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ImportRowDto) rows: ImportRowDto[];
  /** true = send new products to review (or publish when moderation is off); false = keep them as drafts. */
  @IsBoolean() submit: boolean;
}

@ApiTags('seller')
@Controller('seller/products/import')
export class ProductImportController {
  constructor(
    private readonly imports: ProductImportService,
    private readonly alerts: AlertsService,
  ) {}

  /** Reads the uploaded .xlsx/.csv and checks every row without saving anything. */
  @Post('preview')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, parts: 10 } }))
  async preview(@CurrentUser() user: RequestUser, @UploadedFile() file: Express.Multer.File, @Headers('x-seller-id') h?: string) {
    const sellerId = requireSeller(user, h, 'PRODUCTS').id;
    if (!file?.buffer?.length) throw badRequest('NO_FILE', 'Selecciona un archivo .xlsx o .csv.');
    const { rows, unknownColumns } = await this.imports.readFile(file);
    const result = await this.imports.preview(sellerId, rows);
    return { rows, unknownColumns, ...result };
  }

  @Post('commit')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async commit(@CurrentUser() user: RequestUser, @Body() dto: ImportCommitDto, @Headers('x-seller-id') h?: string) {
    const sellerId = requireSeller(user, h, 'PRODUCTS').id;
    const results = await this.imports.commit(user, sellerId, dto.rows, dto.submit);
    const touched = [...new Set(results.filter((r) => r.status === 'UPDATED' && r.productId).map((r) => r.productId!))];
    if (touched.length) this.alerts.touch(touched); // price or stock changed: tell waiting buyers
    return { results };
  }
}
