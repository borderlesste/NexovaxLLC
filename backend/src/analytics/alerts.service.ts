import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { badRequest, conflict, notFound } from '../common/errors';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';

/** A drop must be at least this much (relative) to be worth telling the buyer. */
const MIN_DROP = 0.01;
const PRICE_NOTICE_DAYS = 7;
const MAX_PRICE_NOTICES_PER_USER_RUN = 5;

/** Current price of a product: its cheapest active variant price. */
const PRICE_SQL = (p: string) => `(select min(vpv.amount) from public.product_variants v join public.variant_price_versions vpv on vpv.variant_id = v.id and vpv.status = 'ACTIVE'
                                   where v.product_id = ${p})`;
const STOCK_SQL = (p: string, variant: string) => `(select coalesce(sum(ii.available_to_sell),0) from public.inventory_items ii join public.product_variants v on v.id = ii.variant_id
                                   where v.product_id = ${p} and ii.status = 'ACTIVE' and (${variant} is null or v.id = ${variant}))`;

/**
 * Buyer product alerts (phase 2): back in stock on request, and price drops on the
 * products in the buyer's favorites or cart. Runs on a schedule and right after a store
 * changes a product or its stock.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly db: DbService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------------ buyer
  async list(userId: string, productId?: string) {
    const rows = await this.db.many(
      `select a.id, a.product_id, a.variant_id, a.status, a.created_at, a.notified_at, p.slug, p.title, v.title as variant_title,
              ${STOCK_SQL('p.id', 'a.variant_id')}::int as stock
         from public.nx_product_alerts a join public.products p on p.id = a.product_id left join public.product_variants v on v.id = a.variant_id
        where a.user_id = $1 and ($2::uuid is null or a.product_id = $2) and (a.status = 'ACTIVE' or a.notified_at > now() - interval '30 days')
        order by a.created_at desc limit 100`,
      [userId, productId ?? null],
    );
    return rows.map((r: any) => ({ id: r.id, productId: r.product_id, variantId: r.variant_id, status: r.status, createdAt: r.created_at, notifiedAt: r.notified_at, slug: r.slug, title: r.title, variant: r.variant_title, stock: r.stock }));
  }

  async create(userId: string, productId: string, variantId?: string | null) {
    const p = await this.db.one(
      `select p.id, p.seller_id, p.status, ${STOCK_SQL('p.id', '$2::uuid')}::int as stock,
              (select 1 from public.product_variants v where v.id = $2 and v.product_id = p.id) as variant_ok
         from public.products p where p.id = $1`,
      [productId, variantId ?? null],
    );
    if (!p || !['ACTIVE', 'OUT_OF_STOCK', 'PAUSED'].includes(p.status)) throw notFound('Producto');
    if (variantId && !p.variant_ok) throw badRequest('VARIANT_INVALID', 'La variante no pertenece a este producto.');
    if (p.stock > 0 && p.status === 'ACTIVE') throw conflict('PRODUCT_IN_STOCK', 'Este producto ya está disponible: puedes comprarlo ahora.');
    const own = await this.db.one(`select 1 from public.sellers where id = $1 and owner_user_id = $2`, [p.seller_id, userId]);
    if (own) throw badRequest('ALERT_OWN_PRODUCT', 'No puedes pedir avisos de tus propios productos.');
    await this.db.exec(
      `insert into public.nx_product_alerts (user_id, product_id, variant_id) values ($1,$2,$3)
       on conflict (user_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'ACTIVE' do nothing`,
      [userId, productId, variantId ?? null],
    );
    return this.list(userId, productId);
  }

  async cancel(userId: string, id: string) {
    const r = await this.db.one(`update public.nx_product_alerts set status = 'CANCELLED' where id = $1 and user_id = $2 and status = 'ACTIVE' returning product_id`, [id, userId]);
    if (!r) throw notFound('Aviso');
    return { ok: true };
  }

  /** Starts watching the price of a product the buyer saved or put in the cart. */
  async watch(userId: string, productId: string, source: 'FAVORITE' | 'CART') {
    await this.db.exec(
      `insert into public.nx_price_watches (user_id, product_id, reference_price, source)
       select $1, $2, ${PRICE_SQL('$2::uuid')}, $3 where ${PRICE_SQL('$2::uuid')} is not null
       on conflict (user_id, product_id) do nothing`,
      [userId, productId, source],
    ).catch((e) => this.logger.warn(`watch: ${e.message}`));
  }

  /** People waiting for each of a store's products to be back (aggregate, for its statistics). */
  async waitingBySeller(sellerId: string) {
    const rows = await this.db.many(
      `select a.product_id, count(*)::int as n from public.nx_product_alerts a join public.products p on p.id = a.product_id
        where p.seller_id = $1 and a.status = 'ACTIVE' group by a.product_id`,
      [sellerId],
    );
    return new Map(rows.map((r: any) => [r.product_id as string, r.n as number]));
  }

  // ------------------------------------------------------------------ detection
  /** Full run (schedule) or only some products (right after a store changes them). */
  async scan(productIds?: string[]) {
    const ids = productIds?.length ? productIds : null;
    const stock = await this.backInStock(ids);
    const price = await this.priceDrops(ids);
    return { stock, price };
  }

  /** Fire-and-forget check after a store edits a product or adjusts stock. */
  touch(productIds: string[]) {
    if (!productIds.length) return;
    setImmediate(() => this.scan(productIds).catch((e) => this.logger.warn(`alerts touch: ${e.message}`)));
  }

  /** Free preorder reservations wait for the inventory like a back-in-stock request (also covers older reservations). */
  private async syncPreorders(ids: string[] | null) {
    await this.db.exec(
      `insert into public.nx_product_alerts (user_id, product_id, variant_id)
       select distinct r.buyer_id, v.product_id, v.id
         from public.nx_preorder_reservations r join public.nx_preorder_offers o on o.id = r.offer_id
         join public.product_variants v on v.id = o.variant_id
        where r.cancelled_at is null and o.status in ('OPEN','IN_STOCK','EXPIRED') and ($1::uuid[] is null or v.product_id = any($1))
          and not exists (select 1 from public.nx_product_alerts a where a.user_id = r.buyer_id and a.variant_id = v.id and a.created_at >= r.created_at)
       on conflict (user_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'ACTIVE' do nothing`,
      [ids],
    ).catch((e) => this.logger.warn(`preorder alerts: ${e.message}`));
  }

  private async backInStock(ids: string[] | null) {
    const currency = await this.settings.currency();
    await this.syncPreorders(ids);
    const due = await this.db.many(
      `select a.id, a.user_id, p.id as product_id, p.slug, p.title, ${PRICE_SQL('p.id')}::text as price,
              coalesce(ssp.display_name, s.slug) as store,
              exists (select 1 from public.nx_preorder_reservations r join public.nx_preorder_offers o on o.id = r.offer_id
                       join public.product_variants pv on pv.id = o.variant_id
                      where r.buyer_id = a.user_id and r.cancelled_at is null and pv.product_id = p.id
                        and (a.variant_id is null or pv.id = a.variant_id)) as preorder
         from public.nx_product_alerts a join public.products p on p.id = a.product_id and p.status = 'ACTIVE'
         join public.sellers s on s.id = p.seller_id and s.status = 'ACTIVE' left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where a.status = 'ACTIVE' and ($1::uuid[] is null or a.product_id = any($1)) and ${STOCK_SQL('p.id', 'a.variant_id')} > 0
        limit 500`,
      [ids],
    );
    for (const a of due) {
      const claimed = await this.db.one(`update public.nx_product_alerts set status = 'SENT', notified_at = now() where id = $1 and status = 'ACTIVE' returning id`, [a.id]);
      if (!claimed) continue;
      const prod = { id: a.product_id, slug: a.slug, title: a.title, price: a.price ?? '0', currency, store: a.store };
      await (a.preorder ? this.mail.preorderAvailable(a.user_id, prod, `alert-stock:${a.id}`) : this.mail.productAlert(a.user_id, 'STOCK', prod, `alert-stock:${a.id}`))
        .catch((e) => this.logger.warn(`stock alert ${a.id}: ${e.message}`));
    }
    return due.length;
  }

  private async priceDrops(ids: string[] | null) {
    const currency = await this.settings.currency();
    // Watch favorites and active cart lines (new watches start at today's price); forget the rest.
    await this.db.exec(
      `insert into public.nx_price_watches (user_id, product_id, reference_price, source)
       select w.user_id, w.product_id, ${PRICE_SQL('w.product_id')}, min(w.source)
         from (select cf.user_id, cf.product_id, 'FAVORITE' as source from public.customer_favorites cf
               union all
               select c.customer_id, ci.product_id, 'CART' from public.cart_items ci join public.carts c on c.id = ci.cart_id
                where ci.status = 'ACTIVE' and c.customer_id is not null) w
        where ($1::uuid[] is null or w.product_id = any($1)) and ${PRICE_SQL('w.product_id')} is not null
        group by w.user_id, w.product_id
       on conflict (user_id, product_id) do nothing`,
      [ids],
    );
    await this.db.exec(
      `delete from public.nx_price_watches pw where ($1::uuid[] is null or pw.product_id = any($1))
         and not exists (select 1 from public.customer_favorites cf where cf.user_id = pw.user_id and cf.product_id = pw.product_id)
         and not exists (select 1 from public.cart_items ci join public.carts c on c.id = ci.cart_id
                          where ci.status = 'ACTIVE' and c.customer_id = pw.user_id and ci.product_id = pw.product_id)`,
      [ids],
    );
    // A price that went up becomes the new reference (the next drop is measured from it).
    await this.db.exec(
      `update public.nx_price_watches pw set reference_price = ${PRICE_SQL('pw.product_id')}, updated_at = now()
        where ($1::uuid[] is null or pw.product_id = any($1)) and ${PRICE_SQL('pw.product_id')} > pw.reference_price`,
      [ids],
    );
    const drops = await this.db.many(
      `select pw.user_id, pw.product_id, pw.reference_price::text as previous, ${PRICE_SQL('p.id')}::text as price, p.slug, p.title,
              coalesce(ssp.display_name, s.slug) as store
         from public.nx_price_watches pw join public.products p on p.id = pw.product_id and p.status = 'ACTIVE'
         join public.sellers s on s.id = p.seller_id and s.status = 'ACTIVE' left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where ($1::uuid[] is null or pw.product_id = any($1))
          and ${PRICE_SQL('p.id')} <= pw.reference_price * (1 - $2::numeric) and ${PRICE_SQL('p.id')} < pw.reference_price - 0.009
          and ${STOCK_SQL('p.id', 'null::uuid')} > 0
          and (pw.last_notified_at is null or pw.last_notified_at < now() - make_interval(days => $3::int))
          and s.owner_user_id <> pw.user_id
        order by pw.user_id, (pw.reference_price - ${PRICE_SQL('p.id')}) / nullif(pw.reference_price, 0) desc
        limit 1000`,
      [ids, MIN_DROP, PRICE_NOTICE_DAYS],
    );
    const perUser = new Map<string, number>();
    let sent = 0;
    for (const d of drops) {
      const n = perUser.get(d.user_id) ?? 0;
      if (n >= MAX_PRICE_NOTICES_PER_USER_RUN) continue;
      const claimed = await this.db.one(
        `update public.nx_price_watches set reference_price = $3, last_notified_at = now(), updated_at = now()
          where user_id = $1 and product_id = $2 and reference_price = $4 returning user_id`,
        [d.user_id, d.product_id, d.price, d.previous],
      );
      if (!claimed) continue;
      perUser.set(d.user_id, n + 1);
      sent++;
      await this.mail.productAlert(d.user_id, 'PRICE', { id: d.product_id, slug: d.slug, title: d.title, price: d.price, previous: d.previous, currency, store: d.store },
        `alert-price:${d.user_id}:${d.product_id}:${Date.now()}`).catch((e) => this.logger.warn(`price alert: ${e.message}`));
    }
    return sent;
  }
}
