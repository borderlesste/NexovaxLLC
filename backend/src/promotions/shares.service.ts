import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DbService } from '../db/db.service';
import { conflict, notFound } from '../common/errors';
import { RequestUser } from '../auth/auth';
import { mediaUrl } from '../catalog/catalog.sql';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const CODE_RE = /^[A-Z0-9]{6,16}$/;
/** Fewest distinct visitors a link needs before its sales are reported to its owner. */
const SHARE_MIN_COHORT = 5;
/** A buyer who arrived through a shared link counts for that link during this many days. */
export const SHARE_WINDOW_DAYS = 30;

/**
 * Shared product links (?s=CODE). Any signed-in user gets one personal link per product;
 * the link counts visits, remembers the signed-in buyers who arrived through it and tells
 * its owner which links ended in a paid sale. No money moves here (store affiliate
 * programs, which pay commissions, live in AffiliatesService).
 */
@Injectable()
export class SharesService {
  constructor(private readonly db: DbService) {}

  /** The user's link for a product (created on first share). */
  async link(user: RequestUser, productId: string) {
    const p = await this.db.one(`select id, slug from public.products where id = $1 and status = 'ACTIVE'`, [productId]);
    if (!p) throw notFound('Producto');
    let row = await this.db.one(
      `update public.nx_share_links set last_shared_at = now() where user_id = $1 and product_id = $2 returning code`,
      [user.id, productId],
    );
    for (let attempt = 0; attempt < 5 && !row; attempt++)
      row = await this.db.one(
        `insert into public.nx_share_links (user_id, product_id, code) values ($1,$2,$3)
         on conflict (user_id, product_id) do update set last_shared_at = now() returning code`,
        [user.id, productId, newCode()],
      ).catch((e) => {
        if (e?.code === '23505') return null; // code collision: retry with another code
        throw e;
      });
    if (!row) throw conflict('SHARE_CODE_FAILED', 'No se pudo generar tu enlace. Inténtalo de nuevo.');
    return { code: row.code as string, slug: p.slug as string };
  }

  /** Counts a visit to a shared link (anonymous visitors too). */
  async visit(code: string, user?: RequestUser | null) {
    const c = String(code ?? '').trim().toUpperCase();
    if (!CODE_RE.test(c)) return { ok: false };
    const r = await this.db.one(
      `update public.nx_share_links set clicks = clicks + 1, last_click_at = now() where code = $1 and ($2::uuid is null or user_id <> $2::uuid) returning id`,
      [c, user?.id ?? null],
    );
    return { ok: !!r };
  }

  /** Remembers that a signed-in buyer arrived through these links (own links are ignored). */
  async track(user: RequestUser, codes: string[]) {
    // Each entry is "CODE@product-slug": a code only counts on the page of the product it was made for,
    // so a code can't be slipped onto an unrelated link to watch what one person buys.
    const pairs = new Map<string, string>();
    for (const raw of codes ?? []) {
      const [code, slug] = String(raw ?? '').trim().split('@');
      const c = (code ?? '').toUpperCase();
      if (CODE_RE.test(c) && slug && /^[a-z0-9-]{1,200}$/.test(slug)) pairs.set(c, slug);
    }
    const list = [...pairs.keys()].slice(0, 10);
    if (!list.length) return { tracked: 0 };
    const rows = await this.db.many(
      `insert into public.nx_share_attributions (link_id, customer_id, attributed_at, expires_at)
       select l.id, $2, now(), now() + $4 * interval '1 day'
         from public.nx_share_links l join public.products p on p.id = l.product_id
         join unnest($1::text[], $3::text[]) as x(code, slug) on x.code = l.code and x.slug = p.slug
        where l.user_id <> $2
       on conflict (link_id, customer_id) do update set attributed_at = now(), expires_at = excluded.expires_at
       returning link_id`,
      [list, user.id, list.map((c) => pairs.get(c)!), SHARE_WINDOW_DAYS],
    );
    return { tracked: rows.length };
  }

  /** The user's shared links with visits, buyers and paid sales of the shared product. */
  async mine(user: RequestUser) {
    const rows = await this.db.many(
      `select l.code, l.clicks::int as clicks, l.created_at, l.last_shared_at, l.last_click_at,
              p.id as product_id, p.slug, p.title, p.status,
              (select pm.asset_id from public.product_media pm where pm.product_id = p.id and pm.media_role in ('COVER','GALLERY')
                order by pm.is_primary desc, pm.sort_order, pm.created_at limit 1) as image_id,
              (select count(*)::int from public.nx_share_attributions a where a.link_id = l.id) as visitors,
              s.orders, s.units, s.amount, s.currency, s.last_sale_at
         from public.nx_share_links l join public.products p on p.id = l.product_id
         left join lateral (
           select count(distinct o.id)::int as orders,
                  coalesce(sum(oi.quantity - oi.cancelled_quantity - oi.refunded_quantity),0)::int as units,
                  coalesce(sum(f.product_net_amount),0)::text as amount, max(o.currency_code) as currency, max(o.paid_at) as last_sale_at
             from public.nx_share_attributions a
             join public.orders o on o.customer_id = a.customer_id and o.paid_at is not null and o.cancelled_at is null
                                 and o.placed_at >= a.attributed_at and o.placed_at <= a.expires_at
             join public.order_items oi on oi.order_id = o.id and oi.product_id = l.product_id and oi.quantity > oi.cancelled_quantity
             left join public.order_item_financial_snapshots f on f.order_item_id = oi.id
            where a.link_id = l.id
         ) s on true
        where l.user_id = $1
        order by l.last_shared_at desc
        limit 200`,
      [user.id],
    );
    const links = rows.map((r: any) => ({
      code: r.code,
      product: { id: r.product_id, slug: r.slug, title: r.title, active: r.status === 'ACTIVE', imageUrl: r.image_id ? mediaUrl(r.image_id) : null },
      createdAt: r.created_at, lastSharedAt: r.last_shared_at, lastClickAt: r.last_click_at,
      clicks: r.clicks, visitors: r.visitors,
      // Sales are shown only for links several people used, and without exact amounts or times, so a
      // link sent to one person never reveals what that person bought.
      ...(r.visitors >= SHARE_MIN_COHORT
        ? { orders: r.orders ?? 0, units: r.units ?? 0, amount: null, currency: r.currency, lastSaleAt: null }
        : { orders: 0, units: 0, amount: null, currency: r.currency, lastSaleAt: null, hidden: (r.orders ?? 0) > 0 }),
    }));
    return {
      windowDays: SHARE_WINDOW_DAYS,
      totals: {
        links: links.length,
        clicks: links.reduce((s, l) => s + l.clicks, 0),
        withSales: links.filter((l) => l.orders > 0).length,
        orders: links.reduce((s, l) => s + l.orders, 0),
      },
      links,
    };
  }
}
