import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, RequestUser } from '../auth/auth';
import { CatalogService } from './catalog.service';
import { SettingsService } from '../settings/settings.service';

const num = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));
const bool = (v?: string) => v === 'true' || v === '1';

@ApiTags('catalog')
@Public()
@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
  ) {}

  @Get('home')
  home() {
    return this.catalog.home();
  }

  @Get('config/public')
  async publicConfig() {
    const s = await this.settings.all();
    return {
      name: s['marketplace.name'],
      currency: s['marketplace.currency'],
      locale: s['marketplace.locale'],
      locales: ['es', 'en'],
      defaultCountry: s['marketplace.default_country'],
      supportEmail: s['marketplace.support_email'],
      shippingRates: s['shipping.rates'],
      liveShippingRates: !!s['shipping.shippo_enabled'],
      bankTransfer: !!s['payments.bank_transfer']?.enabled,
      sellerRegistration: s['features.seller_registration'],
    };
  }

  @Get('categories')
  categories() {
    return this.catalog.categories();
  }

  @Get('products')
  products(@Query() q: Record<string, string>) {
    return this.catalog.listProducts({
      q: q.q,
      category: q.category,
      seller: q.seller,
      brand: q.brand,
      minPrice: num(q.minPrice),
      maxPrice: num(q.maxPrice),
      inStock: bool(q.inStock),
      onSale: bool(q.onSale),
      sort: q.sort as any,
      page: num(q.page),
      pageSize: num(q.pageSize),
    });
  }

  @Get('products/:slug')
  product(@Param('slug') slug: string, @CurrentUser() user?: RequestUser) {
    return this.catalog.productDetail(slug, user?.id);
  }

  @Get('products/:slug/reviews')
  reviews(@Param('slug') slug: string, @Query('page') page?: string) {
    return this.catalog.productReviews(slug, num(page) ?? 1);
  }

  @Get('sellers')
  sellers(@Query('q') q?: string) {
    return this.catalog.sellers(q);
  }

  @Get('stores/:slug')
  store(@Param('slug') slug: string, @CurrentUser() user?: RequestUser) {
    return this.catalog.store(slug, user?.id);
  }

  @Get('search/suggest')
  suggest(@Query('q') q: string) {
    return this.catalog.searchSuggestions(q);
  }
}
