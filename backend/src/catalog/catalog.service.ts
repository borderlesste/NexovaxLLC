import { Injectable } from '@nestjs/common';
import { attributeLabel } from '../common/attributes';
import { DbService } from '../db/db.service';
import { SettingsService } from '../settings/settings.service';
import { notFound } from '../common/errors';
import { mapProductCard, mediaUrl, PRODUCT_CARD_JOINS, PRODUCT_CARD_SELECT } from './catalog.sql';

export interface ProductQuery {
  q?: string;
  category?: string;
  seller?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  onSale?: boolean;
  sort?: 'relevance' | 'newest' | 'price_asc' | 'price_desc' | 'rating' | 'best_selling';
  page?: number;
  pageSize?: number;
  /** Attribute filters: attribute code -> accepted values (option codes, free text or true/false). */
  attrs?: Record<string, string[]>;
}

const FACET_LIMIT = 12;

@Injectable()
export class CatalogService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
  ) {}

  /** WHERE of the public listing (shared by the product list and its facets). */
  private listingWhere(query: ProductQuery, currency: string, withAttrs = true) {
    const params: unknown[] = [currency];
    const where: string[] = [`p.status = 'ACTIVE'`, `s.status = 'ACTIVE'`, `pr.min_amount is not null`];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (query.q?.trim()) {
      const term = add(`%${query.q.trim()}%`);
      where.push(`(p.title ilike ${term} or p.short_description ilike ${term} or coalesce(ssp.display_name, s.slug) ilike ${term}
                  or exists (select 1 from public.brands b where b.id = p.brand_id and b.name ilike ${term}))`);
    }
    if (query.category) {
      const cat = add(query.category);
      where.push(`p.category_id in (
        with recursive tree as (
          select id from public.categories where slug = ${cat} or id::text = ${cat}
          union all select k.id from public.categories k join tree t on k.parent_id = t.id)
        select id from tree)`);
    }
    if (query.seller) where.push(`(s.slug = ${add(query.seller)})`);
    if (query.brand) where.push(`exists (select 1 from public.brands b where b.id = p.brand_id and b.slug = ${add(query.brand)})`);
    if (query.minPrice != null) where.push(`pr.min_amount >= ${add(query.minPrice)}`);
    if (query.maxPrice != null) where.push(`pr.min_amount <= ${add(query.maxPrice)}`);
    if (query.inStock) where.push(`coalesce(st.available, 0) > 0`);
    if (query.onSale) where.push(`pr.compare_at > pr.min_amount`);
    if (withAttrs)
      for (const [code, values] of Object.entries(query.attrs ?? {}).slice(0, 10)) {
        if (!values.length) continue;
        where.push(`exists (select 1 from public.product_attribute_values pav join public.attribute_definitions ad on ad.id = pav.attribute_definition_id
                             where pav.product_id = p.id and ad.code = ${add(code)}
                               and coalesce(pav.value_text, pav.value_boolean::text) = any(${add(values.slice(0, 30))}::text[]))`);
      }
    return { where, params };
  }

  /** Public listing of ACTIVE products from ACTIVE sellers. */
  async listProducts(query: ProductQuery) {
    const currency = await this.settings.currency();
    const { where, params } = this.listingWhere(query, currency);

    const order =
      {
        newest: 'p.published_at desc nulls last',
        price_asc: 'pr.min_amount asc',
        price_desc: 'pr.min_amount desc',
        rating: 'coalesce(rv.avg_rating,0) desc, coalesce(rv.review_count,0) desc',
        best_selling: 'coalesce(sold.qty,0) desc',
        relevance: 'coalesce(sold.qty,0) desc, coalesce(rv.avg_rating,0) desc, p.published_at desc',
      }[query.sort ?? 'relevance'] ?? 'p.published_at desc';

    const pageSize = Math.min(Math.max(query.pageSize ?? 24, 1), 60);
    const page = Math.max(query.page ?? 1, 1);
    const sql = `
      select ${PRODUCT_CARD_SELECT('$1')}, count(*) over() as total
        from public.products p
        ${PRODUCT_CARD_JOINS('$1')}
       where ${where.join(' and ')}
       order by ${order}, p.id
       limit ${pageSize} offset ${(page - 1) * pageSize}`;
    const rows = await this.db.many(sql, params);
    return {
      items: rows.map(mapProductCard),
      total: rows[0] ? Number(rows[0].total) : 0,
      page,
      pageSize,
      currency,
    };
  }

  /**
   * Attribute filters for the current listing (category/search/price...): list-type and yes/no
   * attributes that the matching products actually have, with how many products carry each value.
   */
  async facets(query: ProductQuery) {
    const currency = await this.settings.currency();
    const { where, params } = this.listingWhere(query, currency, false);
    const rows = await this.db.many(
      `with base as (select p.id from public.products p ${PRODUCT_CARD_JOINS('$1')} where ${where.join(' and ')})
       select ad.code, ad.name, ad.data_type, ad.validation_rules, coalesce(pav.value_text, pav.value_boolean::text) as v, count(distinct pav.product_id)::int as n,
              bool_or(coalesce(cad.is_filterable, false)) as filterable
         from base b join public.product_attribute_values pav on pav.product_id = b.id
         join public.attribute_definitions ad on ad.id = pav.attribute_definition_id and ad.status = 'ACTIVE'
         left join public.category_attribute_definitions cad on cad.attribute_definition_id = ad.id
        where ad.data_type = 'BOOLEAN' or ad.validation_rules->>'input' in ('select','combobox')
        group by 1,2,3,4,5`,
      params,
    );
    type Facet = { code: string; name: string; type: string; total: number; filterable: boolean; options: { code: string; label: string; labelEn: string; count: number }[] };
    const byCode = new Map<string, Facet>();
    for (const r of rows) {
      if (r.v == null) continue;
      const f: Facet = byCode.get(r.code) ?? { code: r.code, name: r.name, type: r.data_type === 'BOOLEAN' ? 'boolean' : 'list', total: 0, filterable: r.filterable, options: [] };
      const label = r.data_type === 'BOOLEAN' ? (r.v === 'true' ? 'Sí' : 'No') : attributeLabel(r.validation_rules, r.v, 'es') ?? r.v;
      const labelEn = r.data_type === 'BOOLEAN' ? (r.v === 'true' ? 'Yes' : 'No') : attributeLabel(r.validation_rules, r.v, 'en') ?? r.v;
      f.options.push({ code: r.v, label, labelEn, count: r.n });
      f.total += r.n;
      byCode.set(r.code, f);
    }
    // Option order of the definition first; free values alphabetically after them.
    const order = new Map<string, string[]>(rows.map((r: any) => [r.code, (r.validation_rules?.options ?? []).map((o: any) => o.value)]));
    return [...byCode.values()]
      .sort((a, b) => Number(b.filterable) - Number(a.filterable) || b.total - a.total || a.name.localeCompare(b.name))
      .slice(0, FACET_LIMIT)
      .map((f) => {
        const ord = order.get(f.code) ?? [];
        const rank = (c: string) => (ord.indexOf(c) === -1 ? 9999 : ord.indexOf(c));
        f.options.sort((x, y) => rank(x.code) - rank(y.code) || x.label.localeCompare(y.label));
        return { code: f.code, name: f.name, type: f.type, options: f.options.slice(0, 40) };
      });
  }

  async productDetail(slug: string, viewerUserId?: string) {
    const currency = await this.settings.currency();
    const row = await this.db.one(
      `select ${PRODUCT_CARD_SELECT('$2')}, p.description, p.brand_id, b.name as brand_name, p.requires_shipping,
              seo.meta_title, seo.meta_description, c.parent_id as category_parent_id
         from public.products p
         ${PRODUCT_CARD_JOINS('$2')}
         left join public.brands b on b.id = p.brand_id
         left join public.product_seo seo on seo.product_id = p.id
        where (p.slug = $1 or p.id::text = $1) and p.status in ('ACTIVE','OUT_OF_STOCK') and s.status = 'ACTIVE'
        limit 1`,
      [slug, currency],
    );
    if (!row) throw notFound('Producto');
    const productId = row.id;

    const [media, options, variants, attributes, sellerStats, ratingDist, breadcrumbs, fav] = await Promise.all([
      this.db.many(
        `select asset_id, alt_text, variant_id from public.product_media
          where product_id = $1 and media_role in ('COVER','GALLERY') order by is_primary desc, sort_order, created_at`,
        [productId],
      ),
      this.db.many(
        `select o.id, o.code, o.name, o.display_type,
                coalesce(json_agg(json_build_object('id', v.id, 'code', v.code, 'label', v.label, 'swatch', v.swatch_value)
                         order by v.sort_order, v.label) filter (where v.id is not null), '[]') as values
           from public.product_options o left join public.product_option_values v on v.option_id = o.id
          where o.product_id = $1 group by o.id order by o.sort_order, o.name`,
        [productId],
      ),
      this.db.many(
        `select v.id, v.sku, v.title, v.is_default, ap.amount as price, ap.compare_at_amount as compare_at_price,
                coalesce((select sum(ii.available_to_sell) from public.inventory_items ii
                           where ii.variant_id = v.id and ii.status = 'ACTIVE'), 0)::int as stock,
                coalesce((select json_object_agg(voa.option_id, voa.option_value_id)
                            from public.variant_option_assignments voa where voa.variant_id = v.id), '{}') as option_values
           from public.product_variants v
           left join lateral (
             select vpv.amount, vpv.compare_at_amount from public.variant_price_versions vpv
              where vpv.variant_id = v.id and vpv.currency_code = $2 and vpv.status = 'ACTIVE'
                and vpv.effective_from <= now() and (vpv.effective_to is null or vpv.effective_to > now())
              order by vpv.effective_from desc limit 1) ap on true
          where v.product_id = $1 and v.status = 'ACTIVE'
          order by v.is_default desc, v.created_at`,
        [productId, currency],
      ),
      this.db.many(
        `select ad.code, ad.name, ad.unit_code, ad.validation_rules, pav.value_text, pav.value_number::text as value_number, pav.value_boolean
           from public.product_attribute_values pav join public.attribute_definitions ad on ad.id = pav.attribute_definition_id
          where pav.product_id = $1 order by ad.name, pav.position`,
        [productId],
      ),
      this.sellerStats(row.seller_id),
      this.db.many(
        `select rating, count(*)::int as count from public.product_reviews
          where product_id = $1 and status = 'PUBLISHED' group by rating`,
        [productId],
      ),
      this.db.many(
        `with recursive up as (
           select id, parent_id, name, slug, 0 as depth from public.categories where id = $1
           union all select c.id, c.parent_id, c.name, c.slug, up.depth + 1 from public.categories c join up on c.id = up.parent_id)
         select name, slug from up order by depth desc`,
        [row.category_id],
      ),
      viewerUserId
        ? this.db.one(`select 1 as fav from public.customer_favorites where user_id = $1 and product_id = $2`, [viewerUserId, productId])
        : Promise.resolve(null),
    ]);

    const related = await this.db.many(
      `select ${PRODUCT_CARD_SELECT('$3')} from public.products p ${PRODUCT_CARD_JOINS('$3')}
        where p.status = 'ACTIVE' and s.status = 'ACTIVE' and p.id <> $1 and pr.min_amount is not null
          and (p.category_id = $2 or p.category_id in (select id from public.categories where parent_id = (select parent_id from public.categories where id = $2)))
        order by coalesce(sold.qty,0) desc, p.published_at desc limit 8`,
      [productId, row.category_id, currency],
    );

    return {
      ...mapProductCard(row),
      description: row.description,
      brand: row.brand_id ? { id: row.brand_id, name: row.brand_name } : null,
      requiresShipping: row.requires_shipping,
      seo: { title: row.meta_title ?? row.title, description: row.meta_description ?? row.short_description },
      images: media.map((m: any) => ({ url: mediaUrl(m.asset_id), alt: m.alt_text ?? row.title, variantId: m.variant_id })),
      options: options.map((o: any) => ({ id: o.id, code: o.code, name: o.name, displayType: o.display_type, values: o.values })),
      variants: variants.map((v: any) => ({
        id: v.id,
        sku: v.sku,
        title: v.title,
        isDefault: v.is_default,
        price: v.price,
        compareAtPrice: v.compare_at_price,
        stock: v.stock,
        optionValues: v.option_values,
      })),
      specifications: attributes.map((a: any) => {
        const num = a.value_number != null ? `${Number(a.value_number)}${a.unit_code ? ' ' + a.unit_code : ''}` : null;
        return {
          code: a.code,
          name: a.name,
          value: a.value_text != null ? attributeLabel(a.validation_rules, a.value_text, 'es') : num ?? (a.value_boolean != null ? (a.value_boolean ? 'Sí' : 'No') : ''),
          // English label; the locale interceptor swaps it in for English clients.
          valueEn: a.value_text != null ? attributeLabel(a.validation_rules, a.value_text, 'en') : num ?? (a.value_boolean != null ? (a.value_boolean ? 'Yes' : 'No') : ''),
        };
      }),
      ratingDistribution: [5, 4, 3, 2, 1].map((n) => ({ rating: n, count: ratingDist.find((d: any) => d.rating === n)?.count ?? 0 })),
      breadcrumbs,
      sellerStats,
      isFavorite: !!fav,
      related: related.map(mapProductCard),
      currency,
    };
  }

  async productReviews(slug: string, page = 1) {
    const rows = await this.db.many(
      `select r.id, r.rating, r.title, r.body, r.created_at,
              coalesce(up.display_name, nullif(trim(coalesce(up.first_name,'') || ' ' || coalesce(left(up.last_name,1),'')), ''), 'Cliente') as author,
              count(*) over() as total
         from public.product_reviews r
         join public.products p on p.id = r.product_id
         left join public.user_profiles up on up.user_id = r.user_id
        where (p.slug = $1 or p.id::text = $1) and r.status = 'PUBLISHED'
        order by r.created_at desc limit 10 offset $2`,
      [slug, (Math.max(page, 1) - 1) * 10],
    );
    return {
      items: rows.map((r: any) => ({ id: r.id, rating: r.rating, title: r.title, body: r.body, author: r.author, createdAt: r.created_at })),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  }

  async sellerStats(sellerId: string) {
    const r = await this.db.one(
      `select (select count(*) from public.products p where p.seller_id = $1 and p.status = 'ACTIVE')::int as products,
              (select coalesce(avg(rating),0)::numeric(3,2)::text from public.product_reviews where seller_id = $1 and status='PUBLISHED') as rating,
              (select count(*) from public.product_reviews where seller_id = $1 and status='PUBLISHED')::int as reviews,
              (select count(*) from public.seller_followers where seller_id = $1)::int as followers,
              (select coalesce(sum(oi.quantity),0) from public.order_items oi where oi.seller_id = $1)::int as sales`,
      [sellerId],
    );
    return { products: r.products, rating: Number(r.rating), reviews: r.reviews, followers: r.followers, sales: r.sales };
  }

  async categories() {
    const rows = await this.db.many(
      `select c.id, c.parent_id, c.name, c.slug, c.sort_order, c.image_asset_id,
              (select count(*) from public.products p where p.category_id = c.id and p.status = 'ACTIVE')::int as direct_products
         from public.categories c where c.status = 'ACTIVE' order by c.sort_order, c.name`,
    );
    const byParent = new Map<string | null, any[]>();
    for (const r of rows) {
      const k = r.parent_id ?? null;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(r);
    }
    const build = (parent: string | null): any[] =>
      (byParent.get(parent) ?? []).map((c) => {
        const children = build(c.id);
        const productCount = c.direct_products + children.reduce((a: number, k: any) => a + k.productCount, 0);
        return { id: c.id, name: c.name, slug: c.slug, productCount, children };
      });
    return build(null);
  }

  async sellers(q?: string) {
    const rows = await this.db.many(
      `select s.id, s.slug, coalesce(ssp.display_name, s.slug) as name, ssp.short_description, ssp.logo_asset_id,
              (s.verification_status = 'VERIFIED') as verified,
              (select count(*) from public.products p where p.seller_id = s.id and p.status = 'ACTIVE')::int as products,
              (select coalesce(avg(rating),0)::numeric(3,2)::text from public.product_reviews r where r.seller_id = s.id and r.status='PUBLISHED') as rating,
              (select count(*) from public.product_reviews r where r.seller_id = s.id and r.status='PUBLISHED')::int as reviews
         from public.sellers s left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where s.status = 'ACTIVE' and ($1::text is null or coalesce(ssp.display_name, s.slug) ilike '%' || $1 || '%')
        order by products desc, name`,
      [q?.trim() || null],
    );
    return rows.map((r: any) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      shortDescription: r.short_description,
      logoUrl: r.logo_asset_id ? mediaUrl(r.logo_asset_id) : null,
      verified: r.verified,
      products: r.products,
      rating: Number(r.rating),
      reviews: r.reviews,
    }));
  }

  async store(slug: string, viewerUserId?: string) {
    const s = await this.db.one(
      `select s.id, s.slug, s.status, s.verification_status, s.activated_at, s.created_at,
              coalesce(ssp.display_name, s.slug) as name, ssp.short_description, ssp.description,
              ssp.support_email, ssp.support_phone, ssp.logo_asset_id, ssp.banner_asset_id
         from public.sellers s left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where s.slug = $1 and s.status = 'ACTIVE'`,
      [slug],
    );
    if (!s) throw notFound('Tienda');
    const [stats, dist, brands, cats, follow] = await Promise.all([
      this.sellerStats(s.id),
      this.db.many(
        `select rating, count(*)::int as count from public.product_reviews where seller_id = $1 and status='PUBLISHED' group by rating`,
        [s.id],
      ),
      this.db.many(
        `select b.slug, b.name, count(*)::int as count from public.products p join public.brands b on b.id = p.brand_id
          where p.seller_id = $1 and p.status = 'ACTIVE' group by b.slug, b.name order by count desc`,
        [s.id],
      ),
      this.db.many(
        `select c.slug, c.name, count(*)::int as count from public.products p join public.categories c on c.id = p.category_id
          where p.seller_id = $1 and p.status = 'ACTIVE' group by c.slug, c.name order by count desc`,
        [s.id],
      ),
      viewerUserId
        ? this.db.one(`select 1 as f from public.seller_followers where user_id = $1 and seller_id = $2`, [viewerUserId, s.id])
        : Promise.resolve(null),
    ]);
    const offers = await this.db.one(
      `select count(*)::int as n from public.products p
        where p.seller_id = $1 and p.status = 'ACTIVE' and exists (
          select 1 from public.product_variants v join public.variant_price_versions vpv on vpv.variant_id = v.id
           where v.product_id = p.id and vpv.status = 'ACTIVE' and vpv.compare_at_amount > vpv.amount)`,
      [s.id],
    );
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      shortDescription: s.short_description,
      description: s.description,
      supportEmail: s.support_email,
      supportPhone: s.support_phone,
      logoUrl: s.logo_asset_id ? mediaUrl(s.logo_asset_id) : null,
      bannerUrl: s.banner_asset_id ? mediaUrl(s.banner_asset_id) : null,
      verified: s.verification_status === 'VERIFIED',
      memberSince: s.activated_at ?? s.created_at,
      stats,
      offers: offers?.n ?? 0,
      ratingDistribution: [5, 4, 3, 2, 1].map((n) => ({ rating: n, count: dist.find((d: any) => d.rating === n)?.count ?? 0 })),
      brands,
      categories: cats,
      isFollowing: !!follow,
    };
  }

  async home() {
    const [categories, featured, newest, deals, sellers] = await Promise.all([
      this.categories(),
      this.listProducts({ sort: 'relevance', pageSize: 12 }),
      this.listProducts({ sort: 'newest', pageSize: 6 }),
      this.listProducts({ onSale: true, sort: 'relevance', pageSize: 6 }),
      this.sellers(),
    ]);
    return {
      categories: categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, productCount: c.productCount })),
      featured: featured.items,
      newest: newest.items,
      deals: deals.items,
      sellers: sellers.slice(0, 8),
      currency: featured.currency,
    };
  }

  async searchSuggestions(q: string) {
    if (!q?.trim()) return { products: [], stores: [], categories: [] };
    const term = `%${q.trim()}%`;
    const [products, stores, categories] = await Promise.all([
      this.db.many(
        `select p.slug, p.title from public.products p join public.sellers s on s.id = p.seller_id
          where p.status='ACTIVE' and s.status='ACTIVE' and p.title ilike $1 order by p.published_at desc limit 6`,
        [term],
      ),
      this.db.many(
        `select s.slug, coalesce(ssp.display_name, s.slug) as name from public.sellers s
           left join public.seller_store_profiles ssp on ssp.seller_id = s.id
          where s.status='ACTIVE' and coalesce(ssp.display_name, s.slug) ilike $1 limit 4`,
        [term],
      ),
      this.db.many(`select slug, name from public.categories where status='ACTIVE' and name ilike $1 order by sort_order limit 4`, [term]),
    ]);
    return { products, stores, categories };
  }
}
