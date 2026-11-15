import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { SettingsService } from '../settings/settings.service';
import { mapProductCard, PRODUCT_CARD_JOINS, PRODUCT_CARD_SELECT } from '../catalog/catalog.sql';

export type RecoContext = 'home' | 'product' | 'cart';
export interface Viewer {
  userId?: string | null;
  visitorId?: string | null;
  /** Analytics consent: only then is browsing history used to personalize. */
  consent: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PER_STORE = 3;

/**
 * Recommendations (phase 3). A small scoring model over:
 *  - the viewer's signals (with consent): recent views (decaying weekly), favorites, cart, purchases;
 *  - the context anchors (the product being viewed, the cart lines);
 *  - product affinities (co-viewed / co-bought), same-category similarity and popularity.
 * Out of stock, already bought, already in the cart and the viewer's own store are excluded,
 * and no store takes more than a few slots.
 */
@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
  ) {}

  async rebuild(days = 90) {
    return (await this.db.one<{ r: any }>(`select public.nx_rebuild_recommendations($1) as r`, [days]))!.r;
  }

  async recommend(ctx: RecoContext, viewer: Viewer, opts: { productId?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 12, 1), 24);
    const personal = viewer.consent;
    const userId = viewer.userId && UUID.test(viewer.userId) ? viewer.userId : null;
    const visitorId = personal && viewer.visitorId && UUID.test(viewer.visitorId) ? viewer.visitorId : null;
    let anchors: string[] = [];
    let anchorWeight = 0;
    if (ctx === 'product' && opts.productId && UUID.test(opts.productId)) {
      anchors = [opts.productId];
      anchorWeight = 5;
    } else if (ctx === 'cart' && userId) {
      anchors = (await this.db.many<{ product_id: string }>(
        `select distinct ci.product_id from public.cart_items ci where ci.customer_id = $1 and ci.status = 'ACTIVE'`, [userId],
      )).map((r) => r.product_id);
      anchorWeight = 4;
    }
    const signals = personal && (userId || visitorId)
      ? (await this.db.one<{ n: number }>(
          `select (select count(*) from public.nx_product_events e where e.consented and e.event_type = 'VIEW' and e.occurred_at > now() - interval '30 days'
                     and (e.user_id = $1 or e.visitor_id = $2))
                + (select count(*) from public.customer_favorites where user_id = $1)
                + (select count(*) from public.cart_items where customer_id = $1 and status = 'ACTIVE')
                + (select count(*) from public.order_items oi join public.orders o on o.id = oi.order_id where o.customer_id = $1 and o.paid_at is not null)::int as n`,
          [userId, visitorId],
        ))!.n
      : 0;
    const currency = await this.settings.currency();
    const rows = await this.db.many(
      `with sig as (
         select e.product_id, max(1.0 / (1 + extract(epoch from now() - e.occurred_at) / 604800.0)) as w
           from public.nx_product_events e
          where $5 and e.consented and e.event_type = 'VIEW' and e.occurred_at > now() - interval '30 days'
            and (e.user_id = $2 or e.visitor_id = $3)
          group by e.product_id
         union all select cf.product_id, 3 from public.customer_favorites cf where $5 and cf.user_id = $2
         union all select ci.product_id, 4 from public.cart_items ci where $5 and ci.customer_id = $2 and ci.status = 'ACTIVE'
         union all select oi.product_id, 1 from public.order_items oi join public.orders o on o.id = oi.order_id
                    where $5 and o.customer_id = $2 and o.paid_at > now() - interval '180 days'
         union all select x, $6::numeric from unnest($4::uuid[]) x),
       sg as (select product_id, sum(w) as w from sig group by product_id),
       aff as (select a.related_product_id as pid, sum(sg.w * a.score * case when a.kind = 'CO_BUY' then 2 else 1 end) as sc
                 from public.nx_product_affinities a join sg on sg.product_id = a.product_id group by 1),
       cats as (select p.category_id, sum(sg.w) as w from sg join public.products p on p.id = sg.product_id group by 1),
       cand as (
         select pid, sum(sc) as sc from (
           select pid, sc from aff
           union all select p.id, c.w * 0.6 from public.products p join cats c on c.category_id = p.category_id where p.status = 'ACTIVE'
           union all select pp.product_id, ln(1 + pp.score) * 0.3 from public.nx_product_popularity pp
           union all select p.id, 0.001 from public.products p where p.status = 'ACTIVE'
         ) x group by pid)
       select ${PRODUCT_CARD_SELECT('$1')}, cand.sc as score
         from cand join public.products p on p.id = cand.pid ${PRODUCT_CARD_JOINS('$1')}
        where p.status = 'ACTIVE' and s.status = 'ACTIVE' and pr.min_amount is not null and coalesce(st.available, 0) > 0
          and p.id <> all($4::uuid[])
          and not ($7::uuid is not null and s.owner_user_id = $7)
          and not ($7::uuid is not null and exists (select 1 from public.cart_items ci where ci.customer_id = $7 and ci.status = 'ACTIVE' and ci.product_id = p.id))
          and not ($5 and $2::uuid is not null and exists (select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
                                                           where o.customer_id = $2 and o.paid_at is not null and oi.product_id = p.id))
          -- Home: show something new, not what was just viewed or is already saved.
          and not ($5 and $8 and exists (select 1 from public.nx_product_events e where e.product_id = p.id and e.consented and e.event_type = 'VIEW'
                                           and (e.user_id = $2 or e.visitor_id = $3) and e.occurred_at > now() - interval '2 days'))
          and not ($5 and $8 and $2::uuid is not null and exists (select 1 from public.customer_favorites cf where cf.user_id = $2 and cf.product_id = p.id))
        order by cand.sc desc, coalesce(sold.qty, 0) desc, p.published_at desc nulls last
        limit 60`,
      [currency, personal ? userId : null, visitorId, anchors, personal, anchorWeight, userId, ctx === 'home'],
    );
    // Diversity: a few products per store at most.
    const perStore = new Map<string, number>();
    const items: any[] = [];
    for (const r of rows) {
      const n = perStore.get(r.seller_id) ?? 0;
      if (n >= PER_STORE) continue;
      perStore.set(r.seller_id, n + 1);
      items.push(mapProductCard(r));
      if (items.length >= limit) break;
    }
    const personalized = signals > 0;
    const title =
      ctx === 'cart' ? 'COMPLETE_CART'
      : ctx === 'product' ? (personalized ? 'FOR_YOU_RELATED' : 'RELATED')
      : personalized ? 'FOR_YOU' : 'POPULAR';
    return { context: ctx, title, personalized, items };
  }
}
