import { cached } from '../common/single-flight';
import { Throttle } from '@nestjs/throttler';
import { DbService } from '../db/db.service';
import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { googleMerchantFeed, productJsonLd } from './google-merchant';
import { ReturnPolicyService } from '../returns/return-policy.service';
import { ApiTags } from '@nestjs/swagger';
import { config } from '../config';
import { CurrentUser, Public, RequestUser } from '../auth/auth';
import { CatalogService } from './catalog.service';
import { SettingsService } from '../settings/settings.service';
import { PaymentsService } from '../payments/payments.service';

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
    private readonly payments: PaymentsService,
    private readonly returnPolicies: ReturnPolicyService,
  ) {}

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
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
      browserLanguage: s['features.browser_language'] !== false,
      defaultCountry: s['marketplace.default_country'],
      supportEmail: s['marketplace.support_email'],
      liveShippingRates: !!s['shipping.shippo_enabled'],
      bankTransfer: !!s['payments.bank_transfer']?.enabled,
      // Methods the checkout really offers right now (product page "payment methods" line).
      paymentMethods: {
        card: !!this.payments.providerFor('CARD') || config.paymentSandboxEnabled,
        paypal: !!this.payments.providerFor('PAYPAL'),
        bankTransfer: !!s['payments.bank_transfer']?.enabled,
      },
      // Destinations the marketplace serves (Admin → Configuración → Entregas); empty = every country.
      deliveryCountries: ((s['geo.delivery']?.countries ?? []) as string[]).map((c) => c.toUpperCase()),
      stripePublishableKey: config.stripePublishableKey && config.stripeSecretKey ? config.stripePublishableKey : null,
      turnstileSiteKey: config.turnstileSiteKey && config.turnstileSecretKey ? config.turnstileSiteKey : null,
      sellerRegistration: s['features.seller_registration'],
      productModeration: s['features.mandatory_moderation'] === true,
      maintenance: !!s['features.maintenance_mode'],
      social: s['social.links'] ?? [],
      company: s['company.info'],
      seo: s['seo.defaults'],
      // GA4 loads in the browser only after the visitor accepts analytics cookies.
      ga4MeasurementId: s['google.integrations']?.ga4Enabled && s['google.integrations'].ga4MeasurementId ? s['google.integrations'].ga4MeasurementId : null,
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
        // Funds wait for the longer of the payout policy's hold and the dispute window (Admin → Configuración →
        // Seguridad), the same rule the release job applies, so the help center and legal pages quote the real wait.
        holdDays: Math.max(payout ? Math.round(Number(payout.hold) / 86400) : 0, Number(s['security.controls']?.payoutHoldDays ?? 0)),
        currency,
      },
      social: s['social.links'] ?? [],
    };
  }

  @Get('categories')
  categories() {
    return this.catalog.categories();
  }

  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  @Get('products')
  products(@Query() q: Record<string, string | string[]>) {
    return this.catalog.listProducts(listingQuery(q));
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('products/facets')
  facets(@Query() q: Record<string, string | string[]>) {
    return this.catalog.facets(listingQuery(q));
  }

  @Get('products/:slug')
  product(@Param('slug') slug: string, @CurrentUser() user?: RequestUser) {
    return this.catalog.productDetail(slug, user?.id);
  }

  /**
   * schema.org Product (JSON-LD) for the product page: the same description, identifiers, shipping
   * and return policy as the Merchant Center feed. The web caches it for 5 minutes.
   */
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('products/:slug/structured-data')
  async structuredData(@Param('slug') slug: string) {
    const data = await productJsonLd(this.db, this.settings, () => this.returnPolicies.global(), String(slug).slice(0, 200));
    if (!data) throw new NotFoundException('Producto no encontrado.');
    return data;
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

  /** Google Merchant Center product feed (Admin → Configuración → Google). 404 while it is off. */
  @Get('feeds/google-merchant.xml')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async googleMerchant(@Res() res: Response) {
    // Built at most once every 15 minutes (single-flight); query strings never bypass it.
    const body = await cached('feed:google-merchant', 15 * 60_000, () => googleMerchantFeed(this.db, this.settings));
    if (body == null) throw new NotFoundException('El feed de Google Merchant Center está desactivado.');
    res.setHeader('content-type', 'application/xml; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=900');
    res.send(body);
  }

  @Throttle({ default: { limit: 90, ttl: 60_000 } })
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
    preorder: bool(one('preorder')),
    flash: bool(one('flash')),
    ids: one('ids') ? String(one('ids')).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 24) : undefined,
    sort: one('sort') as any,
    page: num(one('page')),
    pageSize: num(one('pageSize')),
    attrs,
  };
}
