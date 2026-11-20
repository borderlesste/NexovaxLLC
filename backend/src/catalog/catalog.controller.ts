import { DbService } from '../db/db.service';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { config } from '../config';
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
    private readonly db: DbService,
  ) {}

  @Get('home')
  home() {
    return this.catalog.home();
  }

  /**
   * Settings the browser needs before login. Keep it minimal: everything here is public.
   * Only publishable keys (Stripe pk_, Turnstile site key) — never secrets or internal rules.
   */
  @Get('config/public')
  async publicConfig() {
    const s = await this.settings.all();
    return {
      name: s['marketplace.name'],
      currency: s['marketplace.currency'],
      locale: s['marketplace.locale'],
      defaultCountry: s['marketplace.default_country'],
      supportEmail: s['marketplace.support_email'],
      liveShippingRates: !!s['shipping.shippo_enabled'],
      bankTransfer: !!s['payments.bank_transfer']?.enabled,
      stripePublishableKey: config.stripePublishableKey && config.stripeSecretKey ? config.stripePublishableKey : null,
      turnstileSiteKey: config.turnstileSiteKey && config.turnstileSecretKey ? config.turnstileSiteKey : null,
      sellerRegistration: s['features.seller_registration'],
      productModeration: s['features.mandatory_moderation'] === true,
      maintenance: !!s['features.maintenance_mode'],
      social: s['social.links'] ?? [],
    };
  }

  /** Help center content (FAQ, seller guide, commissions with the current rate and payout minimum). */
  @Get('help')
  async help() {
    const s = await this.settings.all();
    const currency = s['marketplace.currency'] || 'USD';
    const [rate, payout] = await Promise.all([
      this.db.one(
        `select d.percentage_rate::text as rate from public.get_business_rule_candidates('PLATFORM_COMMISSION', null, null, null, null, now()) cand
           join public.commission_rule_definitions d on d.rule_version_id = cand.rule_version_id
          where cand.scope_type_code = 'GLOBAL' order by cand.priority desc limit 1`,
      ),
      this.db.one(
        `select ppd.minimum_payout_amount::text as minimum, ppd.hold_period_seconds::int as hold from public.business_rule_groups g
           join public.business_rule_versions v on v.rule_group_id = g.id and v.status = 'ACTIVE'
           join public.payout_policy_definitions ppd on ppd.rule_version_id = v.id
          where g.rule_type_code = 'PAYOUT_POLICY' and ppd.currency_code = $1 limit 1`,
        [currency],
      ),
    ]);
    const c = s['help.commissions'];
    return {
      faq: s['help.faq'] ?? [],
      sellers: s['help.sellers']?.sections ?? [],
      commissions: {
        body: c.body,
        bodyEn: c.bodyEn ?? null,
        bodyFr: c.bodyFr ?? null,
        bodyHt: c.bodyHt ?? null,
        rate: c.showRate && rate ? Number(rate.rate) : null,
        payoutMinimum: c.showPayoutMinimum && payout ? payout.minimum : null,
        holdDays: payout ? Math.round(Number(payout.hold) / 86400) : null,
        currency,
      },
      social: s['social.links'] ?? [],
    };
  }

  @Get('categories')
  categories() {
    return this.catalog.categories();
  }

  @Get('products')
  products(@Query() q: Record<string, string | string[]>) {
    return this.catalog.listProducts(listingQuery(q));
  }

  @Public()
  @Get('products/facets')
  facets(@Query() q: Record<string, string | string[]>) {
    return this.catalog.facets(listingQuery(q));
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
    return this.catalog.store(slug, user?.id, user?.sellers.map((x) => x.id) ?? []);
  }

  @Get('stores/:slug/reviews')
  storeReviews(@Param('slug') slug: string, @Query('page') page?: string, @Query('rating') rating?: string) {
    return this.catalog.storeReviews(slug, num(page) ?? 1, num(rating));
  }

  /** Public URLs for the web sitemap: active products, stores and categories (capped). */
  @Get('sitemap')
  sitemap() {
    return this.catalog.sitemap();
  }

  @Get('search/suggest')
  suggest(@Query('q') q: string) {
    return this.catalog.searchSuggestions(q);
  }
}

/** Listing filters from the query string; attribute filters come as f_<code>=value (repeatable or comma separated). */
function listingQuery(raw: Record<string, string | string[]>) {
  const one = (k: string) => (Array.isArray(raw[k]) ? (raw[k] as string[])[0] : (raw[k] as string | undefined));
  const attrs: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    const m = /^f_([a-z0-9_]{1,60})$/.exec(k);
    if (!m) continue;
    const vals = (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter((x) => x && x.length <= 120);
    if (vals.length) attrs[m[1]] = [...new Set(vals)];
  }
  return {
    q: one('q'),
    category: one('category'),
    seller: one('seller'),
    brand: one('brand'),
    minPrice: num(one('minPrice')),
    maxPrice: num(one('maxPrice')),
    inStock: bool(one('inStock')),
    onSale: bool(one('onSale')),
    sort: one('sort') as any,
    page: num(one('page')),
    pageSize: num(one('pageSize')),
    attrs,
  };
}
