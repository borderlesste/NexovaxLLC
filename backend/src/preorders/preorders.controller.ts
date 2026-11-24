import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsInt, IsUUID, Matches, Max, Min } from 'class-validator';
import { CurrentUser, FreshUser, Public, RequestUser, requireSeller } from '../auth/auth';
import { PreordersService } from './preorders.service';

export class ConfigurePreorderDto {
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/i, { message: 'Indica la zona horaria de llegada.' })
  arrivalAt: string;
  @IsInt() @Min(1) @Max(1_000_000) capacity: number;
}

export class ReservePreorderDto {
  @IsUUID() offerId: string;
  @IsInt() @Min(1) @Max(1_000_000) quantity: number;
}

@ApiTags('preorders')
@Controller()
export class PreordersController {
  constructor(private readonly preorders: PreordersService) {}

  @Public()
  @Get('products/:productId/preorders')
  published(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.preorders.published(productId);
  }

  @Get('me/preorders')
  mine(@CurrentUser() user: RequestUser) {
    return this.preorders.mine(user.id);
  }

  @FreshUser()
  @Post('me/preorders')
  reserve(@CurrentUser() user: RequestUser, @Body() body: ReservePreorderDto) {
    return this.preorders.reserve(user.id, user.sellers.map((store) => store.id), body.offerId, body.quantity);
  }

  @Delete('me/preorders/:id')
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.preorders.cancel(user.id, id);
  }

  @Get('seller/products/:productId/preorders')
  sellerOffers(@CurrentUser() user: RequestUser, @Param('productId', ParseUUIDPipe) productId: string, @Headers('x-seller-id') seller?: string) {
    return this.preorders.sellerOffers(requireSeller(user, seller, 'PRODUCTS').id, productId);
  }

  @Put('seller/products/:productId/preorders/:variantId')
  configure(@CurrentUser() user: RequestUser, @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string, @Body() body: ConfigurePreorderDto, @Headers('x-seller-id') seller?: string) {
    return this.preorders.configure(requireSeller(user, seller, 'PRODUCTS').id, productId, variantId, body);
  }

  @Delete('seller/products/:productId/preorders/:variantId')
  close(@CurrentUser() user: RequestUser, @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string, @Headers('x-seller-id') seller?: string) {
    return this.preorders.close(requireSeller(user, seller, 'PRODUCTS').id, productId, variantId);
  }
}
