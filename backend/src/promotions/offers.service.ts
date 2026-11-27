import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DbService } from '../db/db.service';
import { badRequest, conflict, notFound } from '../common/errors';
import { RequestUser } from '../auth/auth';
import { MailService } from '../mail/mail.service';
import { CouponsService } from './coupons.service';
import { SettingsService } from '../settings/settings.service';

export type Audience = 'FAVORITES' | 'CART' | 'BOTH';
export interface OfferInput {
  productId: string;
  audience: Audience;
  couponId?: string;
  newCoupon?: { percent: number; days: number };
  message?: string;
}

/** Same product: at most one campaign a week. Each buyer: one offer per store a week, three in total. */
const PRODUCT_COOLDOWN_DAYS = 7;
const PER_STORE_DAYS = 7;
const MAX_OFFERS_PER_WEEK = 3;
const MAX_RECIPIENTS = 5000;

/**
 * Coupon offers to interested buyers (phase 4): a store sends one of its coupons to the
 * people who have its product in their favorites and/or cart. The store only sees counts;
 * the platform delivers the offer (bell + e-mail, "Avisos de productos" category).
 */
@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly db: DbService,
    private readonly mail: MailService,
    private readonly coupons: CouponsService,
    private readonly settings: SettingsService,
  ) {}

  /** Eligible recipients: interested, active, haven't bought it, not the store, within frequency caps, not opted out. */
  private eligibleSql(audience: Audience) {
    const fav = `select cf.user_id from public.customer_favorites cf where cf.product_id = $1`;
    const cart = `select ci.customer_id as user_id from public.cart_items ci where ci.product_id = $1 and ci.status = 'ACTIVE' and ci.customer_id is not null`;
    const src = audience === 'FAVORITES' ? fav : audience === 'CART' ? cart : `${fav} union ${cart}`;
    return `
      with aud as (${src})
      select distinct u.id from aud join public.users u on u.id = aud.user_id and u.status = 'ACTIVE'
       where not exists (select 1 from public.sellers s where s.id = $2 and s.owner_user_id = u.id)
         and not exists (select 1 from public.seller_members m where m.seller_id = $2 and m.user_id = u.id and m.status = 'ACTIVE')
         and not exists (select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
                          where o.customer_id = u.id and oi.product_id = $1 and o.paid_at is not null and o.lifecycle_status <> 'CANCELLED')
         and not exists (select 1 from public.nx_offer_recipients r where r.user_id = u.id and r.seller_id = $2 and r.sent_at > now() - interval '${PER_STORE_DAYS} days')
         and (select count(*) from public.nx_offer_recipients r where r.user_id = u.id and r.sent_at > now() - interval '7 days') < ${MAX_OFFERS_PER_WEEK}
         and not (exists (select 1 from public.notification_preferences p where p.user_id = u.id and p.category_code = 'PRODUCT_ALERTS' and p.channel_code = 'IN_APP' and not p.enabled)
              and exists (select 1 from public.notification_preferences p where p.user_id = u.id and p.category_code = 'PRODUCT_ALERTS' and p.channel_code = 'EMAIL' and not p.enabled))`;
  }

  private async ownProduct(sellerId: string, productId: string) {
    const p = await this.db.one(`select id, title, slug, status from public.products where id = $1 and seller_id = $2`, [productId, sellerId]);
    if (!p) throw notFound('Producto');
    return p;
  }

  async audience(sellerId: string, productId: string) {
    const p = await this.ownProduct(sellerId, productId);
    const count = async (a: Audience) => (await this.db.one<{ n: number }>(`select count(*)::int as n from (${this.eligibleSql(a)} limit ${MAX_RECIPIENTS}) x`, [productId, sellerId]))!.n;
    const [favorites, cart, both, last] = await Promise.all([
      count('FAVORITES'), count('CART'), count('BOTH'),
      this.db.one(`select created_at from public.nx_offer_campaigns where product_id = $1 order by created_at desc limit 1`, [productId]),
    ]);
    const next = last ? new Date(new Date(last.created_at).getTime() + PRODUCT_COOLDOWN_DAYS * 86400_000) : null;
    const coupons = (await this.coupons.list(sellerId)).filter((c: any) => c.state === 'ACTIVE' && (!c.productIds.length || c.productIds.includes(productId)));
    return {
      product: { id: p.id, title: p.title, active: p.status === 'ACTIVE' },
      counts: { FAVORITES: favorites, CART: cart, BOTH: both },
      availableAt: next && next > new Date() ? next.toISOString() : null,
      coupons: coupons.map((c: any) => ({ id: c.id, code: c.code, type: c.type, value: c.value, endsAt: c.endsAt })),
    };
  }

  async send(user: RequestUser, sellerId: string, i: OfferInput) {
    const p = await this.ownProduct(sellerId, i.productId);
    if (p.status !== 'ACTIVE') throw conflict('PRODUCT_NOT_ACTIVE', 'El producto debe estar publicado para enviar una oferta.');
    if (!['FAVORITES', 'CART', 'BOTH'].includes(i.audience)) throw badRequest('OFFER_AUDIENCE_INVALID', 'Elige a quién enviar la oferta.');
    const message = i.message?.trim() || null;
    if (message && (message.length > 280 || /(https?:\/\/|www\.|<[a-z])/i.test(message)))
      throw badRequest('OFFER_MESSAGE_INVALID', 'El mensaje admite hasta 280 caracteres y no puede incluir enlaces.');
    const last = await this.db.one(`select created_at from public.nx_offer_campaigns where product_id = $1 and created_at > now() - interval '${PRODUCT_COOLDOWN_DAYS} days' limit 1`, [i.productId]);
    if (last) throw conflict('OFFER_COOLDOWN', `Ya enviaste una oferta de este producto en los últimos ${PRODUCT_COOLDOWN_DAYS} días. Podrás enviar otra después.`);
    const recipients = (await this.db.many<{ id: string }>(`${this.eligibleSql(i.audience)} limit ${MAX_RECIPIENTS}`, [i.productId, sellerId])).map((r) => r.id);
    if (!recipients.length) throw conflict('OFFER_NO_AUDIENCE', 'No hay personas a quienes enviar esta oferta en este momento.');

    // Coupon: one of the store's active coupons that applies to the product, or a new one only for it.
    let coupon: any;
    if (i.couponId) {
      coupon = await this.coupons.get(sellerId, i.couponId);
      if (!coupon || coupon.state !== 'ACTIVE' || (coupon.productIds.length && !coupon.productIds.includes(i.productId)))
        throw badRequest('OFFER_COUPON_INVALID', 'El cupón debe estar activo y aplicar a este producto.');
    } else if (i.newCoupon) {
      const pct = Number(i.newCoupon.percent);
      const days = Number(i.newCoupon.days);
      if (!Number.isFinite(pct) || pct < 1 || pct > 90 || !Number.isInteger(days) || days < 1 || days > 30)
        throw badRequest('OFFER_COUPON_INVALID', 'El descuento debe ser de 1 % a 90 % y durar de 1 a 30 días.');
      const code = `OFERTA${Array.from(randomBytes(5), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('')}`;
      coupon = await this.coupons.create(user, sellerId, {
        code, type: 'PERCENT', value: pct, perCustomer: 1, productIds: [i.productId],
        startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + days * 86400_000).toISOString(), active: true,
      });
    } else throw badRequest('OFFER_COUPON_REQUIRED', 'Elige un cupón o crea uno para esta oferta.');

    let sendTo = recipients;
    const campaign = await this.db.tx(async (c) => {
      // Caps are checked again under one lock: concurrent requests can't each see "no campaign yet".
      // (Per-user caps span every store, so the lock is marketplace-wide; campaigns are rare.)
      await this.db.exec(`select pg_advisory_xact_lock(hashtext('nexovax:offer-campaigns'))`, [], c);
      const again = await this.db.one(
        `select 1 from public.nx_offer_campaigns where product_id = $1 and created_at > now() - interval '${PRODUCT_COOLDOWN_DAYS} days' limit 1`,
        [i.productId],
        c,
      );
      if (again) throw conflict('OFFER_COOLDOWN', `Ya enviaste una oferta de este producto en los últimos ${PRODUCT_COOLDOWN_DAYS} días. Podrás enviar otra después.`);
      sendTo = (await this.db.many<{ id: string }>(`${this.eligibleSql(i.audience)} limit ${MAX_RECIPIENTS}`, [i.productId, sellerId], c)).map((r) => r.id);
      if (!sendTo.length) throw conflict('OFFER_NO_AUDIENCE', 'No hay personas a quienes enviar esta oferta en este momento.');
      const row = await this.db.one<{ id: string }>(
        `insert into public.nx_offer_campaigns (seller_id, product_id, promotion_code_id, audience, message, recipients, created_by)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [sellerId, i.productId, coupon.id, i.audience, message, sendTo.length, user.id],
        c,
      );
      await this.db.exec(
        `insert into public.nx_offer_recipients (campaign_id, user_id, seller_id) select $1, x, $2 from unnest($3::uuid[]) x`,
        [row!.id, sellerId, sendTo],
        c,
      );
      return row!.id;
    });
    const store = await this.db.one<{ name: string }>(`select coalesce(ssp.display_name, s.slug) as name from public.sellers s left join public.seller_store_profiles ssp on ssp.seller_id = s.id where s.id = $1`, [sellerId]);
    const offer = { productId: p.id, slug: p.slug, title: p.title, store: store?.name ?? '', code: coupon.code, type: coupon.type, value: coupon.value, currency: await this.settings.currency(), endsAt: coupon.endsAt, message };
    this.mail.fire(async () => {
      for (const u of sendTo) await this.mail.productOffer(u, offer, `offer:${campaign}:${u}`).catch((e) => this.logger.warn(`offer ${campaign}: ${e.message}`));
    });
    return { id: campaign, recipients: sendTo.length, code: coupon.code };
  }

  /** Campaign results, in totals only. */
  async campaigns(sellerId: string) {
    const rows = await this.db.many(
      `select c.id, c.audience, c.recipients, c.created_at, c.message, p.title, p.slug, pc.code::text as code,
              (select count(distinct o.customer_id)::int from public.order_promotion_snapshots ops join public.orders o on o.id = ops.order_id
                where ops.promotion_code_id = c.promotion_code_id and o.paid_at >= c.created_at and o.lifecycle_status <> 'CANCELLED'
                  and o.customer_id in (select r.user_id from public.nx_offer_recipients r where r.campaign_id = c.id)) as buyers,
              (select coalesce(sum(f.product_net_amount),0)::text from public.order_promotion_snapshots ops join public.orders o on o.id = ops.order_id
                 join public.order_items oi on oi.order_id = o.id and oi.product_id = c.product_id
                 join public.order_item_financial_snapshots f on f.order_item_id = oi.id
                where ops.promotion_code_id = c.promotion_code_id and o.paid_at >= c.created_at and o.lifecycle_status <> 'CANCELLED'
                  and o.customer_id in (select r.user_id from public.nx_offer_recipients r where r.campaign_id = c.id)) as sales
         from public.nx_offer_campaigns c join public.products p on p.id = c.product_id join public.promotion_codes pc on pc.id = c.promotion_code_id
        where c.seller_id = $1 order by c.created_at desc limit 50`,
      [sellerId],
    );
    return rows.map((r: any) => ({ id: r.id, product: r.title, slug: r.slug, code: r.code, audience: r.audience, recipients: r.recipients, buyers: r.buyers, sales: r.sales, message: r.message, createdAt: r.created_at }));
  }
}
