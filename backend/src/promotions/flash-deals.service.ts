import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { SettingsService } from '../settings/settings.service';
import { SellerService } from '../seller/seller.service';
import { NotificationsService } from '../notifications/notifications.service';
import { badRequest, conflict, notFound } from '../common/errors';
import { RequestUser } from '../auth/auth';
import { applyRate, fromMinor, toMinor } from '../common/money';
import { mediaUrl } from '../catalog/catalog.sql';

export interface FlashDealInput {
  productId: string;
  discountPercent: number;
  /** Empty = now. */
  startsAt?: string | null;
  endsAt: string;
}

/** Shown state: SCHEDULED (not started), LIVE, ENDED, CANCELLED (by the store) or REMOVED (by the marketplace team). */
const STATE_SQL = `case when fd.status <> 'ACTIVE' then fd.status when fd.ends_at <= now() then 'ENDED' when fd.starts_at > now() then 'SCHEDULED' else 'LIVE' end`;

/**
 * Flash deals ("Ofertas relámpago"): each store puts its own products on sale for a short window with a
 * real end. The sale price is a real price version for [startsAt, endsAt) followed by the regular price
 * from endsAt, so catalog, cart and checkout charge exactly what the countdown promises, and the regular
 * price comes back on its own. Rules (minimum discount, longest duration, deals per store) are set by the
 * marketplace in Admin → Configuración → Portada; the team can also take a deal down.
 */
@Injectable()
export class FlashDealsService {
  private readonly logger = new Logger(FlashDealsService.name);
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly seller: SellerService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Activates price versions whose time came (a deal starting or ending). Catalog and cart already read them on time. */
  @Cron(CronExpression.EVERY_MINUTE)
  async activateDuePrices() {
    try {
      await this.db.exec(`select public.activate_due_variant_prices(500)`);
    } catch (e: any) {
      this.logger.warn(`activate_due_variant_prices: ${e?.message ?? e}`);
    }
  }

  async rules() {
    const layout = await this.settings.get('home.layout');
    const s = layout.sections.find((x) => x.key === 'flash_deals');
    return { enabled: s?.enabled !== false, minDiscount: s?.minDiscount ?? 10, maxHours: s?.maxHours ?? 72, maxPerSeller: s?.maxPerSeller ?? 10 };
  }

  private async rows(where: string, params: unknown[]) {
    const rows = await this.db.many(
      `select fd.id, fd.product_id, fd.discount_percent::text as discount, fd.starts_at, fd.ends_at, fd.status, fd.removal_reason, fd.ended_at, fd.created_at,
              ${STATE_SQL} as state, p.title, p.slug, s.id as seller_id, coalesce(ssp.display_name, s.slug) as seller_name, s.slug as seller_slug,
              (select pm.asset_id from public.product_media pm where pm.product_id = p.id and pm.media_role in ('COVER','GALLERY')
                order by pm.is_primary desc, pm.sort_order limit 1) as image_id,
              (select min(fv.regular_amount)::text from public.nx_flash_deal_variants fv where fv.deal_id = fd.id) as regular_price,
              (select min(fv.flash_amount)::text from public.nx_flash_deal_variants fv where fv.deal_id = fd.id) as flash_price
         from public.nx_flash_deals fd
         join public.products p on p.id = fd.product_id
         join public.sellers s on s.id = fd.seller_id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where ${where}
        order by (fd.status = 'ACTIVE' and fd.ends_at > now()) desc, fd.starts_at desc
        limit 200`,
      params,
    );
    return rows.map((r: any) => ({
      id: r.id, productId: r.product_id, title: r.title, slug: r.slug, imageUrl: r.image_id ? mediaUrl(r.image_id) : null,
      seller: { id: r.seller_id, name: r.seller_name, slug: r.seller_slug },
      discountPercent: Number(r.discount), regularPrice: r.regular_price, flashPrice: r.flash_price,
      startsAt: r.starts_at, endsAt: r.ends_at, state: r.state, removalReason: r.removal_reason, endedAt: r.ended_at, createdAt: r.created_at,
    }));
  }

  async list(sellerId: string) {
    const [items, rules] = await Promise.all([this.rows(`fd.seller_id = $1`, [sellerId]), this.rules()]);
    return { items, rules };
  }

  /** Admin: running and scheduled deals first, then the latest ended ones. */
  async adminList() {
    return this.rows(`(fd.status = 'ACTIVE' and fd.ends_at > now()) or fd.created_at > now() - interval '30 days'`, []);
  }

  async create(user: RequestUser, sellerId: string, i: FlashDealInput) {
    const rules = await this.rules();
    if (!rules.enabled) throw badRequest('FLASH_DEALS_DISABLED', 'Las ofertas relámpago no están disponibles en este momento.');
    const discount = Math.round(Number(i.discountPercent) * 100) / 100;
    if (!(discount >= rules.minDiscount && discount <= 90))
      throw badRequest('FLASH_DEAL_DISCOUNT', `El descuento debe estar entre ${rules.minDiscount} % y 90 %.`);
    const now = Date.now();
    const start = i.startsAt ? new Date(i.startsAt) : new Date(now);
    const end = new Date(i.endsAt);
    if (isNaN(+start) || isNaN(+end)) throw badRequest('FLASH_DEAL_DATES', 'Las fechas no son válidas.');
    if (+start < now - 60_000) throw badRequest('FLASH_DEAL_DATES', 'El inicio no puede estar en el pasado.');
    if (+start > now + 30 * 86400_000) throw badRequest('FLASH_DEAL_DATES', 'La oferta debe empezar en los próximos 30 días.');
    if (+end <= Math.max(+start, now) + 15 * 60_000) throw badRequest('FLASH_DEAL_DATES', 'La oferta debe durar al menos 15 minutos.');
    if (+end - +start > rules.maxHours * 3600_000) throw badRequest('FLASH_DEAL_DATES', `Una oferta relámpago dura como máximo ${rules.maxHours} horas.`);
    const startAt = new Date(Math.max(+start, now));
    const currency = await this.settings.currency();

    const id = await this.db.tx(async (c) => {
      // Deals for different products of the same store are created one at a time, so the per-store cap holds.
      await this.db.exec(`select pg_advisory_xact_lock(hashtext('nexovax:flash-deals:' || $1::text))`, [sellerId], c);
      const p = await this.db.one(
        `select p.id, p.status, p.title, s.status as seller_status from public.products p join public.sellers s on s.id = p.seller_id
          where p.id = $1 and p.seller_id = $2 for update of p`,
        [i.productId, sellerId],
        c,
      );
      if (!p) throw notFound('Producto');
      if (p.seller_status !== 'ACTIVE') throw badRequest('SELLER_NOT_ACTIVE', 'Tu tienda debe estar activa para crear ofertas.');
      if (p.status !== 'ACTIVE') throw badRequest('FLASH_DEAL_PRODUCT', 'Solo puedes poner en oferta relámpago productos publicados.');
      const open = await this.db.one<{ n: number }>(
        `select count(*)::int as n from public.nx_flash_deals where seller_id = $1 and status = 'ACTIVE' and ends_at > now()`,
        [sellerId],
        c,
      );
      if (open!.n >= rules.maxPerSeller)
        throw conflict('FLASH_DEAL_LIMIT', `Puedes tener hasta ${rules.maxPerSeller} ofertas relámpago activas o programadas a la vez.`);
      // One live or scheduled deal per product at a time: a second deal would be priced off the first
      // deal's discounted price (and restore to it), compounding discounts past the 90 % cap.
      const overlap = await this.db.one(
        `select 1 from public.nx_flash_deals where product_id = $1 and status = 'ACTIVE' and ends_at > now() limit 1`,
        [i.productId],
        c,
      );
      if (overlap) throw conflict('FLASH_DEAL_OVERLAP', 'Este producto ya tiene una oferta relámpago activa o programada. Espera a que termine para crear otra.');
      const variants = await this.db.many(
        `select v.id, ep.amount::text as amount, ep.compare_at_amount::text as compare_at
           from public.product_variants v
           cross join lateral public.get_effective_variant_price(v.id, $2, now()) ep
          where v.product_id = $1 and v.status = 'ACTIVE' order by v.id for update of v`,
        [i.productId, currency],
        c,
      );
      if (!variants.length) throw badRequest('FLASH_DEAL_PRODUCT', 'El producto no tiene precio publicado.');
      const rate = (Math.round((100 - discount) * 100) / 10000).toFixed(4);
      const deal = await this.db.one<{ id: string }>(
        `insert into public.nx_flash_deals (seller_id, product_id, currency_code, discount_percent, starts_at, ends_at, created_by)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [sellerId, i.productId, currency, discount, startAt, end, user.id],
        c,
      );
      for (const v of variants) {
        const regular = toMinor(v.amount);
        const flash = applyRate(regular, rate);
        if (flash <= 0n || flash >= regular) throw badRequest('FLASH_DEAL_DISCOUNT', 'El descuento no cambia el precio de una de las variantes.');
        await this.db.exec(
          `insert into public.nx_flash_deal_variants (deal_id, variant_id, regular_amount, regular_compare_at, flash_amount) values ($1,$2,$3,$4,$5)`,
          [deal!.id, v.id, v.amount, v.compare_at, fromMinor(flash)],
          c,
        );
        // The struck-through "before" price is the price right now, never an older, higher one.
        await this.seller.publishPrice(c, user.id, sellerId, v.id, currency, fromMinor(flash), v.amount, startAt);
        await this.seller.publishPrice(c, user.id, sellerId, v.id, currency, v.amount, v.compare_at, end);
      }
      return deal!.id;
    });
    return (await this.rows(`fd.id = $1`, [id]))[0];
  }

  /** Ends a running or scheduled deal now and puts the regular price back. */
  private async end(c: PoolClient, actor: string, deal: any, status: 'CANCELLED' | 'REMOVED', reason: string | null) {
    const variants = await this.db.many(
      `select variant_id, regular_amount::text as amount, regular_compare_at::text as compare_at from public.nx_flash_deal_variants where deal_id = $1`,
      [deal.id],
      c,
    );
    // Publishing the regular price now cancels the scheduled flash/regular versions and supersedes the flash price.
    for (const v of variants) await this.seller.publishPrice(c, actor, deal.seller_id, v.variant_id, deal.currency_code, v.amount, v.compare_at);
    await this.db.exec(
      `update public.nx_flash_deals set status = $2, ended_at = now(), ended_by = $3, removal_reason = $4 where id = $1`,
      [deal.id, status, actor, reason],
      c,
    );
  }

  private async lockLive(c: PoolClient, id: string, sellerId?: string) {
    const d = await this.db.one(
      `select fd.*, p.title, s.owner_user_id from public.nx_flash_deals fd join public.products p on p.id = fd.product_id
         join public.sellers s on s.id = fd.seller_id
        where fd.id = $1 and ($2::uuid is null or fd.seller_id = $2) for update of fd`,
      [id, sellerId ?? null],
      c,
    );
    if (!d) throw notFound('Oferta');
    if (d.status !== 'ACTIVE' || new Date(d.ends_at) <= new Date()) throw conflict('FLASH_DEAL_ENDED', 'Esta oferta ya terminó.');
    return d;
  }

  async cancel(user: RequestUser, sellerId: string, id: string) {
    await this.db.tx(async (c) => this.end(c, user.id, await this.lockLive(c, id, sellerId), 'CANCELLED', null));
    return { ok: true };
  }

  /** Marketplace team takes a deal down (misleading price, policy breach…); the store is told why. */
  async remove(admin: RequestUser, id: string, reason: string) {
    const why = reason.trim().slice(0, 500);
    if (why.length < 5) throw badRequest('REASON_REQUIRED', 'Indica el motivo (mínimo 5 caracteres).');
    const d = await this.db.tx(async (c) => {
      const deal = await this.lockLive(c, id);
      await this.end(c, admin.id, deal, 'REMOVED', why);
      return deal;
    });
    await this.notifications.notify(d.owner_user_id, {
      category: 'STORE', eventType: 'FLASH_DEAL_REMOVED', entityType: 'FLASH_DEAL', entityId: id, url: '/vendedor/ofertas-relampago',
      dedupeKey: `flash-deal-removed-${id}`,
      title: `Retiramos tu oferta relámpago: ${d.title}`, body: `Motivo: ${why}. El producto volvió a su precio normal.`,
      localized: {
        en: { title: `We took down your flash deal: ${d.title}`, body: `Reason: ${why}. The product is back to its regular price.` },
        fr: { title: `Nous avons retiré votre vente flash : ${d.title}`, body: `Motif : ${why}. Le produit est revenu à son prix normal.` },
        ht: { title: `Nou retire pwomosyon flash ou a: ${d.title}`, body: `Rezon: ${why}. Pwodwi a tounen nan pri nòmal li.` },
      },
    });
    return { ok: true };
  }
}
