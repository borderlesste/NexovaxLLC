import { currentClientIp } from '../common/client-ip';
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { realOrder } from '../common/live-orders';

export type ClientEvent = { type: 'VIEW'; productId: string; dwellMs?: number; source?: string };
export type ServerEventType = 'ADD_TO_CART' | 'FAVORITE' | 'UNFAVORITE';

const SOURCES = ['DIRECT', 'SEARCH', 'CATALOG', 'STORE', 'HOME', 'PRODUCT', 'EXTERNAL', 'AFFILIATE'];
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|monitor|curl|wget|python-requests|axios\//i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A consented visitor's repeated views of the same product within this window count once. */
const VIEW_DEDUPE_MIN = 30;

/**
 * Product engagement analytics (phase 1). Stores views, add-to-cart and favorites as raw
 * events (identity only with analytics consent), rolls them into daily totals and gives
 * sellers aggregate statistics with suggestions. Sellers never see who did what.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private lastTodayAggregation = 0;

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ intake
  /** Browser events (views). Anonymous unless the visitor accepted analytics cookies. */
  private readonly limiter = new ViewLimiter();

  async record(events: ClientEvent[], ctx: { userId?: string | null; visitorId?: string | null; consent: boolean; userAgent?: string }) {
    if (!events?.length || BOT_UA.test(ctx.userAgent ?? '') || !ctx.userAgent) return { recorded: 0 };
    const ip = currentClientIp()?.ip ?? 'unknown';
    // A browser keeps one visitor id; a source that rotates them is fabricating visitors, so only the
    // first few ids seen from an IP in an hour count as identities.
    let visitorId = ctx.consent && ctx.visitorId && UUID.test(ctx.visitorId) ? ctx.visitorId : null;
    if (visitorId && !ctx.userId && !this.limiter.visitorAllowed(ip, visitorId)) visitorId = null;
    const userId = ctx.consent ? ctx.userId ?? null : null;
    const who = userId ?? visitorId ?? `ip:${ip}`;
    let recorded = 0;
    const seen = new Set<string>();
    for (const e of events.slice(0, 20)) {
      if (e?.type !== 'VIEW' || !UUID.test(String(e.productId ?? ''))) continue;
      // One view per product per batch, per viewer (or IP) per 30 minutes, and a cap per IP and hour.
      if (seen.has(e.productId)) continue;
      seen.add(e.productId);
      if (!this.limiter.viewAllowed(ip, who, e.productId)) continue;
      const dwell = Number.isFinite(Number(e.dwellMs)) ? Math.min(Math.max(Math.round(Number(e.dwellMs)), 0), 3600000) : null;
      const source = SOURCES.includes(String(e.source)) ? String(e.source) : null;
      const r = await this.db.one(
        `insert into public.nx_product_events (event_type, product_id, seller_id, user_id, visitor_id, consented, dwell_ms, source)
         select 'VIEW', p.id, p.seller_id, $2, $3, $4, $5, $6 from public.products p
          where p.id = $1 and p.status = 'ACTIVE'
            and not ($7::uuid is not null and (p.seller_id in (select seller_id from public.seller_members where user_id = $7 and status = 'ACTIVE')
                                               or p.seller_id in (select id from public.sellers where owner_user_id = $7)))
            and not ($4 and exists (select 1 from public.nx_product_events x where x.product_id = p.id and x.event_type = 'VIEW'
                     and coalesce(x.user_id, x.visitor_id) = coalesce($2::uuid, $3::uuid) and x.occurred_at > now() - make_interval(mins => ${VIEW_DEDUPE_MIN})))
         returning id`,
        [e.productId, userId, visitorId, ctx.consent && !!(userId || visitorId), dwell, source, ctx.userId ?? null],
      ).catch((err) => {
        this.logger.warn(`event: ${err.message}`);
        return null;
      });
      if (r) recorded++;
    }
    return { recorded };
  }

  /** Events the API sees directly (add to cart, favorites). */
  async recordServer(type: ServerEventType, productId: string, userId: string, consent: boolean) {
    try {
      const r = await this.db.one<{ seller_id: string; title: string }>(
        `insert into public.nx_product_events (event_type, product_id, seller_id, user_id, consented)
         select $1, p.id, p.seller_id, $3, $4 from public.products p where p.id = $2
         returning seller_id, (select title from public.products where id = $2) as title`,
        [type, productId, consent ? userId : null, consent],
      );
      if (r && type === 'FAVORITE') await this.favoriteNotice(r.seller_id, productId, r.title);
    } catch (e: any) {
      this.logger.warn(`server event ${type}: ${e.message}`);
    }
  }

  /** Anonymous notice to the store: at most one per product per day (the count keeps growing in its stats). */
  private async favoriteNotice(sellerId: string, productId: string, title: string) {
    const owner = await this.db.one<{ owner_user_id: string }>(`select owner_user_id from public.sellers where id = $1`, [sellerId]);
    if (!owner) return;
    const day = new Date().toISOString().slice(0, 10);
    await this.notifications.notify(owner.owner_user_id, {
      category: 'STORE', eventType: 'PRODUCT_FAVORITED', title: 'A alguien le gustó tu producto',
      body: `«${title}» se agregó a favoritos. Revisa sus estadísticas: una oferta o un cupón puede convertir ese interés en venta.`,
      localized: {
        en: { title: 'Someone liked your product', body: `“${title}” was added to favorites. Check its statistics: a deal or a coupon can turn that interest into a sale.` },
        fr: { title: 'Quelqu’un a aimé votre produit', body: `« ${title} » a été ajouté aux favoris. Consultez ses statistiques : une offre ou un coupon peut transformer cet intérêt en vente.` },
        ht: { title: 'Yon moun renmen pwodwi ou', body: `«${title}» ajoute nan favori. Gade estatistik li: yon òf oswa yon koupon ka fè enterè sa a tounen yon vant.` },
      },
      url: '/vendedor/estadisticas', entityType: 'PRODUCT', entityId: productId, dedupeKey: `favorite:${productId}:${day}`,
    });
  }

  // ------------------------------------------------------------------ aggregation
  async aggregate(daysBack = 1) {
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
    return (await this.db.one<{ n: number }>(`select public.nx_aggregate_product_events($1::date, $2::date) as n`, [from, today]))!.n;
  }

  async purge(keepDays = 90) {
    return (await this.db.one<{ n: number }>(`select public.nx_purge_product_events($1) as n`, [keepDays]))!.n;
  }

  // ------------------------------------------------------------------ seller statistics
  async sellerStats(sellerId: string, days: number) {
    if (Date.now() - this.lastTodayAggregation > 60_000) {
      this.lastTodayAggregation = Date.now();
      await this.aggregate(0).catch((e) => this.logger.warn(`aggregate: ${e.message}`));
    }
    const period = [days];
    const [rows, series, totals] = await Promise.all([
      this.db.many(
        `with st as (
           select product_id, sum(views)::int as views, sum(unique_visitors)::int as visitors, sum(add_to_cart)::int as cart,
                  greatest(sum(favorites) - sum(unfavorites), 0)::int as fav_added, sum(dwell_ms_total)::bigint as dwell_total, sum(dwell_samples)::int as dwell_n
             from public.nx_product_daily_stats where seller_id = $1 and day > current_date - $2::int group by product_id),
         sales as (
           select oi.product_id, count(distinct so.order_id)::int as orders, sum(oi.quantity)::int as units, sum(f.product_net_amount)::text as revenue
             from public.order_items oi join public.seller_orders so on so.id = oi.seller_order_id join public.orders o on o.id = so.order_id
             join public.order_item_financial_snapshots f on f.order_item_id = oi.id
            where so.seller_id = $1 and o.paid_at > now() - make_interval(days => $2::int) and so.lifecycle_status <> 'CANCELLED' and ${realOrder('o.id')}
            group by oi.product_id)
         select p.id, p.slug, p.title, p.status, p.published_at, p.created_at,
                coalesce(st.views,0) as views, coalesce(st.visitors,0) as visitors, coalesce(st.cart,0) as cart, coalesce(st.fav_added,0) as fav_added,
                case when coalesce(st.dwell_n,0) > 0 then (st.dwell_total / st.dwell_n)::int end as avg_dwell_ms,
                coalesce(sales.orders,0) as orders, coalesce(sales.units,0) as units, coalesce(sales.revenue,'0') as revenue,
                (select count(*)::int from public.customer_favorites cf where cf.product_id = p.id) as fav_total,
                (select count(*)::int from public.nx_product_alerts a where a.product_id = p.id and a.status = 'ACTIVE') as waiting,
                (select coalesce(sum(ii.available_to_sell),0)::int from public.inventory_items ii join public.product_variants v on v.id = ii.variant_id where v.product_id = p.id and ii.status = 'ACTIVE') as stock,
                (select min(vpv.amount)::text from public.product_variants v join public.variant_price_versions vpv on vpv.variant_id = v.id and vpv.status = 'ACTIVE' where v.product_id = p.id) as price,
                (select bool_or(vpv.compare_at_amount > vpv.amount) from public.product_variants v join public.variant_price_versions vpv on vpv.variant_id = v.id and vpv.status = 'ACTIVE' where v.product_id = p.id) as on_sale,
                exists (select 1 from public.promotion_codes pc join public.business_rule_groups g on g.id = pc.rule_group_id
                         left join lateral (select conditions from public.business_rule_versions x where x.rule_group_id = g.id and x.status = 'ACTIVE' order by version_number desc limit 1) v on true
                         where g.scope_seller_id = $1 and g.rule_type_code = 'PROMOTION' and pc.status = 'ACTIVE' and (pc.ends_at is null or pc.ends_at > now())
                           and (coalesce(jsonb_array_length(v.conditions->'productIds'),0) = 0 or v.conditions->'productIds' ? p.id::text)) as has_coupon,
                (select ssp.display_name from public.seller_store_profiles ssp where ssp.seller_id = $1) as store
           from public.products p left join st on st.product_id = p.id left join sales on sales.product_id = p.id
          where p.seller_id = $1 and p.status in ('ACTIVE','PAUSED','OUT_OF_STOCK')
          order by coalesce(st.views,0) desc, coalesce(sales.units,0) desc, p.created_at desc`,
        [sellerId, ...period],
      ),
      this.db.many(
        `select d::date as day,
                coalesce((select sum(views) from public.nx_product_daily_stats s where s.seller_id = $1 and s.day = d::date),0)::int as views,
                coalesce((select sum(add_to_cart) from public.nx_product_daily_stats s where s.seller_id = $1 and s.day = d::date),0)::int as cart,
                coalesce((select count(distinct so.order_id) from public.seller_orders so join public.orders o on o.id = so.order_id
                           where so.seller_id = $1 and so.lifecycle_status <> 'CANCELLED' and (o.paid_at at time zone 'UTC')::date = d::date and ${realOrder('o.id')}),0)::int as orders
           from generate_series(current_date - ($2::int - 1), current_date, interval '1 day') d order by d`,
        [sellerId, ...period],
      ),
      this.db.one(
        `select coalesce(sum(views),0)::int as views, coalesce(sum(unique_visitors),0)::int as visitors, coalesce(sum(add_to_cart),0)::int as cart,
                greatest(coalesce(sum(favorites),0) - coalesce(sum(unfavorites),0), 0)::int as fav_added
           from public.nx_product_daily_stats where seller_id = $1 and day > current_date - $2::int`,
        [sellerId, ...period],
      ),
    ]);
    const products = rows.map((r: any) => {
      const conversion = r.visitors > 0 ? r.orders / r.visitors : null;
      return {
        id: r.id, slug: r.slug, title: r.title, status: r.status, price: r.price, onSale: !!r.on_sale, hasCoupon: !!r.has_coupon, stock: r.stock, waiting: r.waiting,
        views: r.views, visitors: r.visitors, addToCart: r.cart, favoritesAdded: r.fav_added, favorites: r.fav_total,
        orders: r.orders, units: r.units, revenue: r.revenue, avgDwellSeconds: r.avg_dwell_ms != null ? Math.round(r.avg_dwell_ms / 1000) : null,
        conversion: conversion != null ? Math.round(conversion * 1000) / 10 : null,
        suggestions: suggest(r, conversion, days),
      };
    });
    const orders = products.reduce((a: number, p: any) => a + p.orders, 0);
    return {
      days,
      summary: {
        views: totals!.views, visitors: totals!.visitors, addToCart: totals!.cart, favoritesAdded: totals!.fav_added,
        favorites: products.reduce((a: number, p: any) => a + p.favorites, 0),
        orders, units: products.reduce((a: number, p: any) => a + p.units, 0),
        revenue: products.reduce((a: number, p: any) => a + Number(p.revenue), 0).toFixed(2),
        conversion: totals!.visitors > 0 ? Math.round((orders / totals!.visitors) * 1000) / 10 : null,
      },
      series,
      products,
    };
  }
}

/** Plain rules that turn the numbers into next steps for the seller. */
function suggest(r: any, conversion: number | null, days: number) {
  const out: { code: string; tone: 'red' | 'amber' | 'blue' | 'green'; message: string; params?: Record<string, unknown>; actions: string[] }[] = [];
  const ageDays = (Date.now() - new Date(r.published_at ?? r.created_at).getTime()) / 86400_000;
  if (r.stock <= 0 && r.waiting > 0)
    out.push({ code: 'OUT_OF_STOCK_DEMAND', tone: 'red', message: r.waiting === 1 ? '1 persona espera que vuelva a estar disponible: repón inventario y le avisaremos automáticamente.' : '{n} personas esperan que vuelva a estar disponible: repón inventario y les avisaremos automáticamente.', params: { n: r.waiting }, actions: ['STOCK'] });
  else if (r.stock <= 0 && r.views >= 10)
    out.push({ code: 'OUT_OF_STOCK_DEMAND', tone: 'red', message: 'Se agotó y la gente lo sigue visitando: repón inventario para no perder ventas.', actions: ['STOCK'] });
  if (r.visitors >= 30 && (conversion ?? 0) < 0.01)
    out.push({ code: 'LOW_CONVERSION', tone: 'amber', message: 'Muchas visitas y pocas ventas: prueba bajar el precio, ponerlo en oferta o crear un cupón.', actions: r.has_coupon ? ['PRICE'] : ['COUPON', 'PRICE'] });
  if (r.cart >= 5 && r.orders / r.cart < 0.2)
    out.push({ code: 'CART_ABANDON', tone: 'amber', message: 'Lo agregan al carrito pero no lo compran: envíales un cupón o mejora el envío.', actions: ['OFFER', 'PRICE'] });
  if (r.fav_total >= 3 && !r.on_sale)
    out.push({ code: 'FAVORITES', tone: 'blue', message: '{n} personas lo tienen en favoritos: envíales un cupón para convertirlas en compras.', params: { n: r.fav_total }, actions: ['OFFER', 'PRICE'] });
  if (r.views < 5 && ageDays >= 7 && days >= 7 && r.status === 'ACTIVE')
    out.push({ code: 'LOW_VISIBILITY', tone: 'blue', message: 'Pocas visitas: mejora las fotos, el título y la descripción, o compártelo con tu enlace.', actions: ['EDIT'] });
  if (r.orders >= 5 && (conversion ?? 0) >= 0.05)
    out.push({ code: 'TOP', tone: 'green', message: 'Se vende bien: asegúrate de tener inventario suficiente.', actions: ['STOCK'] });
  return out;
}

/**
 * In-process abuse limits for public view beacons (no personal data stored: keys live in memory for
 * at most an hour). Not a distributed limit, but it bounds what one source can inject per instance.
 */
class ViewLimiter {
  private views = new Map<string, number>();
  private perIp = new Map<string, { n: number; at: number }>();
  private visitors = new Map<string, { ids: Set<string>; at: number }>();
  private static readonly VIEW_TTL = 30 * 60_000;
  private static readonly IP_HOURLY = 300;
  private static readonly VISITORS_PER_IP = 5;

  private sweep() {
    if (this.views.size < 50_000 && this.perIp.size < 20_000 && this.visitors.size < 20_000) return;
    const now = Date.now();
    for (const [k, at] of this.views) if (now - at > ViewLimiter.VIEW_TTL) this.views.delete(k);
    for (const [k, v] of this.perIp) if (now - v.at > 3_600_000) this.perIp.delete(k);
    for (const [k, v] of this.visitors) if (now - v.at > 3_600_000) this.visitors.delete(k);
  }

  visitorAllowed(ip: string, visitorId: string) {
    this.sweep();
    const now = Date.now();
    let v = this.visitors.get(ip);
    if (!v || now - v.at > 3_600_000) this.visitors.set(ip, (v = { ids: new Set(), at: now }));
    if (v.ids.has(visitorId)) return true;
    if (v.ids.size >= ViewLimiter.VISITORS_PER_IP) return false;
    v.ids.add(visitorId);
    return true;
  }

  viewAllowed(ip: string, who: string, productId: string) {
    this.sweep();
    const now = Date.now();
    const key = `${who}:${productId}`;
    const last = this.views.get(key);
    if (last && now - last < ViewLimiter.VIEW_TTL) return false;
    let c = this.perIp.get(ip);
    if (!c || now - c.at > 3_600_000) this.perIp.set(ip, (c = { n: 0, at: now }));
    if (c.n >= ViewLimiter.IP_HOURLY) return false;
    c.n++;
    this.views.set(key, now);
    return true;
  }
}
