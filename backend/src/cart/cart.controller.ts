import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, RequestUser } from '../auth/auth';
import { CartService } from './cart.service';

export class AddCartItemDto {
  @IsUUID() variantId: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(999) quantity: number;
}

export class UpdateCartItemDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(999) quantity: number;
}

@ApiTags('cart')
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser() user: RequestUser) {
    return this.cart.getCart(user.id);
  }

  @Post('items')
  add(@CurrentUser() user: RequestUser, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(user.id, dto.variantId, dto.quantity, 'add');
  }

  @Put('items/:id')
  update(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCartItemDto) {
    return this.cart.updateItem(user.id, id, dto.quantity);
  }

  @Delete('items/:id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cart.removeItem(user.id, id);
  }

  @Delete()
  clear(@CurrentUser() user: RequestUser) {
    return this.cart.clear(user.id);
  }
}
