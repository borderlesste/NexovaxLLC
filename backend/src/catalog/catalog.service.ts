import { cached } from '../common/single-flight';
import { Injectable } from '@nestjs/common';
import { taxonomyOptionLabel } from '../common/i18n-catalog';
import { attributeLabel } from '../common/attributes';
import { DbService } from '../db/db.service';
import { SettingsService, CATALOG_PAGE_SIZE_MAX } from '../settings/settings.service';
import { notFound } from '../common/errors';
import { clampPage, clampPageSize } from '../common/paging';
import { soldOrder } from '../common/sales-sql';
import { productHasPreorderSql } from '../preorders/preorders.sql';
import { FLASH_ENDS_SQL, mapProductCard, mediaUrl, PRODUCT_CARD_JOINS, PRODUCT_CARD_SELECT } from './catalog.sql';
import type { HomeSection, HomeSectionKey } from './home-layout';
import { SELLER_TRUST_SQL, sellerTrust } from '../common/seller-trust';

export interface ProductQuery {
  q?: string;
  category?: string;
  seller?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  onSale?: boolean;
  /** Only products the team featured (home page). */
  featured?: boolean;
  /** Only these products (recently viewed, max 24). */
  ids?: string[];
  /** Only out-of-stock products with an open preorder. */
  preorder?: boolean;
  /** Only products sold in the last N days, best sellers of the window first (home "Más vendidos"). */
  soldDays?: number;
  /** Only products published in the last N days. */
  publishedDays?: number;
  /** Only products discounted at least this %. */
  minDiscount?: number;
  /** Only products with a running store flash deal, ending soonest first (home "Ofertas relámpago"). */
  flash?: boolean;
  sort?: 'relevance' | 'newest' | 'price_asc' | 'price_desc' | 'rating' | 'best_selling' | 'featured' | 'flash_ending';
  page?: number;
  pageSize?: number;
  /** Attribute filters: attribute code -> accepted values (option codes, free text or true/false). */
  attrs?: Record<string, string[]>;
}

const FACET_LIMIT = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Units of the product sold in the last N days (paid, not cancelled, real orders). */
const recentSales = (daysParam: string) =>
  `coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id
     where oi.product_id = p.id and ${soldOrder('o')} and o.placed_at >= now() - make_interval(days => ${daysParam}::int)), 0)`;

/** Words of a search term, normalized (no accents, lower case). */
const searchWords = (param: string) =>
  `(select array_agg(w) from (select distinct w from unnest(regexp_split_to_array(public.nx_search_norm(${param}), '[^[:alnum:]]+')) w
     where w <> '' limit 6) x)`;

/**
 * Every word of the term must appear (accent/case-insensitive) in the product title, description, store, brand or
 * category; words of 4+ letters also match the title with typos (pg_trgm word similarity).
 * Expects aliases p (products), s (sellers) and ssp (seller_store_profiles).
 */
export function searchMatch(param: string) {
  return `not exists (select 1 from unnest(coalesce(${searchWords(param)}, '{}')) w where not (
            public.nx_search_norm(p.title) like '%' || w || '%'
            or public.nx_search_norm(p.short_description) like '%' || w || '%'
            or public.nx_search_norm(coalesce(ssp.display_name, s.slug)) like '%' || w || '%'
            or exists (select 1 from public.brands b where b.id = p.brand_id and public.nx_search_norm(b.name) like '%' || w || '%')
            or exists (select 1 from public.categories cc where cc.id = p.category_id and public.nx_search_norm(cc.name) like '%' || w || '%')
            or (length(w) >= 4 and extensions.word_similarity(w, public.nx_search_norm(p.title)) >= 0.5)))`;
}

/** Relevance of a product title for a search term: exact phrase first, then by similarity. */
export function searchScore(param: string) {
  return `((case when public.nx_search_norm(p.title) like '%' || public.nx_search_norm(${param}) || '%' then 2 else 0 end)
           + extensions.word_similarity(public.nx_search_norm(${param}), public.nx_search_norm(p.title)))`;
}

/** Accent/case-insensitive, typo-tolerant match of a name column against $1. */
const nameMatch = (col: string) =>
  `(public.nx_search_norm(${col}) like '%' || public.nx_search_norm($1) || '%'
    or (length($1) >= 4 and extensions.word_similarity(public.nx_search_norm($1), public.nx_search_norm(${col})) >= 0.5))`;

@Injectable()
export class CatalogService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
  ) {}

  /** WHERE of the public listing (shared by the product list and its facets). */
  private listingWhere(query: ProductQuery, currency: string, withAttrs = true) {
    const params: unknown[] = [currency];
    const where: string[] = [
      `(p.status = 'ACTIVE' or (p.status = 'OUT_OF_STOCK' and ${productHasPreorderSql('p')}))`,
      `s.status = 'ACTIVE'`, `pr.min_amount is not null`,
    ];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (query.featured) where.push(`exists (select 1 from public.nx_featured_products fp where fp.product_id = p.id)`);
    if (query.q?.trim()) where.push(searchMatch(add(query.q.trim().slice(0, 120))));
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
    if (query.minDiscount) where.push(`pr.compare_at > 0 and pr.min_amount <= pr.compare_at * (1 - ${add(query.minDiscount)}::numeric / 100)`);
    if (query.flash) where.push(`${FLASH_ENDS_SQL('p')} is not null`);
    if (query.ids) where.push(`p.id = any(${add(query.ids.filter((x) => UUID.test(x)).slice(0, 24))}::uuid[])`);
    if (query.preorder) where.push(`coalesce(st.available, 0) <= 0 and ${productHasPreorderSql('p')}`);
    if (query.publishedDays) where.push(`p.published_at >= now() - make_interval(days => ${add(Math.trunc(query.publishedDays))}::int)`);
    if (query.soldDays) where.push(`${recentSales(add(Math.trunc(query.soldDays)))} > 0`);
    if (withAttrs)
      for (const [code, values] of Object.entries(query.attrs ?? {}).slice(0, 10)) {
        if (!values.length) continue;
        where.push(`exists (select 1 from public.product_attribute_values pav join public.attribute_definitions ad on ad.id = pav.attribute_definition_id
                             where pav.product_id = p.id and ad.code = ${add(code)}
                               and coalesce(pav.value_text, pav.value_boolean::text) = any(${add(values.slice(0, 30))}::text[]))`);
      }
    return { where, params };
  }

  /** Public listings include out-of-stock products with an open preorder. */
  async listProducts(query: ProductQuery) {
    const currency = await this.settings.currency();
    const { where, params } = this.listingWhere(query, currency);
    const q = query.q?.trim().slice(0, 120);
    const scored = q && (query.sort ?? 'relevance') === 'relevance' ? `${searchScore(`$${params.push(q)}`)} desc, ` : '';
    const recent = query.soldDays ? `${recentSales(`$${params.push(Math.trunc(query.soldDays))}`)} desc, ` : '';

    const order =
      {
        newest: 'p.published_at desc nulls last',
        price_asc: 'pr.min_amount asc',
        price_desc: 'pr.min_amount desc',
        rating: 'coalesce(rv.avg_rating,0) desc, coalesce(rv.review_count,0) desc',
        best_selling: 'coalesce(sold.qty,0) desc',
        relevance: 'coalesce(sold.qty,0) desc, coalesce(rv.avg_rating,0) desc, p.published_at desc',
        flash_ending: `${FLASH_ENDS_SQL('p')} asc nulls last, p.published_at desc`,
        featured: '(select fp.sort_order from public.nx_featured_products fp where fp.product_id = p.id) asc nulls last, p.published_at desc',
      }[query.sort ?? 'relevance'] ?? 'p.published_at desc';

    // No ?pageSize → the admin's catalog page size (Admin → Configuración → General → Catálogo).
    const pageSize = clampPageSize(query.pageSize, (await this.settings.get('catalog.listing')).pageSize, CATALOG_PAGE_SIZE_MAX);
    const page = clampPage(query.page);
    const sql = `
      select ${PRODUCT_CARD_SELECT('$1')}, count(*) over() as total
        from public.products p
        ${PRODUCT_CARD_JOINS('$1')}
       where ${where.join(' and ')}
       order by ${scored}${recent}${order}, p.id
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
    // Same filters → same facets for 60 s, built once (single-flight) however many visitors ask.
    return cached(`catalog:facets:${JSON.stringify(query)}`.slice(0, 600), 60_000, () => this.buildFacets(query));
  }

  private async buildFacets(query: ProductQuery) {
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
        group by 1,2,3,4,5
        order by n desc limit 2000`,
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
      `select ${PRODUCT_CARD_SELECT('$2')}, p.description, p.item_condition, p.size_guide, p.brand_id, b.name as brand_name, p.requires_shipping,
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
           from public.product_options o join public.product_option_values v on v.option_id = o.id
          -- only values of ACTIVE variants: options/values the seller removed are not offered
          where o.product_id = $1 and exists (select 1 from public.variant_option_assignments a join public.product_variants pv on pv.id = a.variant_id
                                                where a.option_value_id = v.id and pv.status = 'ACTIVE')
          group by o.id order by o.sort_order, o.name`,
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
              where vpv.variant_id = v.id and vpv.currency_code = $2 and vpv.status in ('ACTIVE','SCHEDULED')
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

    const attributeGroups = new Map<string, typeof attributes>();
    for (const attribute of attributes) {
      const group = attributeGroups.get(attribute.code) ?? [];
      group.push(attribute);
      attributeGroups.set(attribute.code, group);
    }
    const specifications = [...attributeGroups.values()].map((group) => {
      const labels = group.map((a) => {
        const number = a.value_number != null ? `${Number(a.value_number)}${a.unit_code ? ' ' + a.unit_code : ''}` : '';
        const es = attributeLabel(a.validation_rules, a.value_text) ?? (a.value_boolean != null ? (a.value_boolean ? 'Sí' : 'No') : number);
        const en = attributeLabel(a.validation_rules, a.value_text, 'en') ?? (a.value_boolean != null ? (a.value_boolean ? 'Yes' : 'No') : number);
        return { es, en };
      });
      return {
        code: group[0].code, name: group[0].name,
        value: labels.map((l) => l.es).join(', '),
        valueEn: labels.map((l) => l.en).join(', '),
        ...(labels.length > 1 ? {
          valueFr: labels.map((l) => taxonomyOptionLabel(l.es, l.en, 'fr')).join(', '),
          valueHt: labels.map((l) => taxonomyOptionLabel(l.es, l.en, 'ht')).join(', '),
        } : {}),
      };
    });

    return {
      ...mapProductCard(row),
      description: row.description,
      condition: row.item_condition ?? null,
      sizeGuide: row.size_guide ?? null,
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
      specifications,
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
      [slug, (clampPage(page) - 1) * 10],
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
    return cached('catalog:categories', 60_000, () => this.buildCategories());
  }

  private async buildCategories() {
    const rows = await this.db.many(
      `select c.id, c.parent_id, c.name, c.slug, c.description, c.sort_order, c.image_asset_id, c.tax_class,
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
        return { id: c.id, name: c.name, slug: c.slug, description: c.description ?? null, imageUrl: c.image_asset_id ? mediaUrl(c.image_asset_id) : null, taxClass: c.tax_class, productCount, children };
      });
    return build(null);
  }

  async sellers(q?: string) {
    const term = q?.trim().slice(0, 80) || null;
    return cached(`catalog:sellers:${term ?? ''}`, term ? 30_000 : 60_000, () => this.buildSellers(term));
  }

  private async buildSellers(term: string | null) {
    const rows = await this.db.many(
      `select s.id, s.slug, coalesce(ssp.display_name, s.slug) as name, ssp.short_description, ssp.logo_asset_id,
              ${SELLER_TRUST_SQL('s')},
              (select count(*) from public.products p where p.seller_id = s.id and p.status = 'ACTIVE')::int as products,
              (select coalesce(avg(rating),0)::numeric(3,2)::text from public.product_reviews r where r.seller_id = s.id and r.status='PUBLISHED') as rating,
              (select count(*) from public.product_reviews r where r.seller_id = s.id and r.status='PUBLISHED')::int as reviews
         from public.sellers s left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where s.status = 'ACTIVE' and ($1::text is null or coalesce(ssp.display_name, s.slug) ilike '%' || $1 || '%')
        order by products desc, name limit 200`,
      [term],
    );
    return rows.map((r: any) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      shortDescription: r.short_description,
      logoUrl: r.logo_asset_id ? mediaUrl(r.logo_asset_id) : null,
      trust: sellerTrust(r),
      products: r.products,
      rating: Number(r.rating),
      reviews: r.reviews,
    }));
  }

  async store(slug: string, viewerUserId?: string, viewerSellerIds: string[] = []) {
    const s = await this.db.one(
      `select s.id, s.slug, s.status, s.activated_at, s.created_at, ${SELLER_TRUST_SQL('s')},
              coalesce(ssp.display_name, s.slug) as name, ssp.short_description, ssp.description,
              ssp.support_email, ssp.support_phone, ssp.logo_asset_id, ssp.banner_asset_id
         from public.sellers s left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where s.slug = $1 and s.status = 'ACTIVE'`,
      [slug],
    );
    if (!s) throw notFound('Tienda');
    const [stats, dist, brands, cats, follow, shipFrom] = await Promise.all([
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
      // Where the store ships from (its default active ship-from address), shown instead of a generic shipping claim.
      this.db.one(
        `select city, country_code from public.seller_ship_from_addresses
          where seller_id = $1 and status = 'ACTIVE' order by is_default desc, created_at limit 1`,
        [s.id],
      ),
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
      trust: sellerTrust(s),
      memberSince: s.activated_at ?? s.created_at,
      stats,
      offers: offers?.n ?? 0,
      ratingDistribution: [5, 4, 3, 2, 1].map((n) => ({ rating: n, count: dist.find((d: any) => d.rating === n)?.count ?? 0 })),
      brands,
      categories: cats,
      isFollowing: !!follow,
      isOwnStore: viewerSellerIds.includes(s.id),
      // Country only: the city comes from the private ship-from address (it can be a home address).
      shipsFrom: shipFrom ? { city: null, countryCode: shipFrom.country_code } : null,
    };
  }

  /** Published reviews of every product of a store, newest first (optionally only one star rating). */
  async storeReviews(slug: string, page = 1, rating?: number) {
    const stars = rating && rating >= 1 && rating <= 5 ? Math.trunc(rating) : null;
    const rows = await this.db.many(
      `select r.id, r.rating, r.title, r.body, r.created_at, p.title as product_title,
              case when p.status = 'ACTIVE' then p.slug end as product_slug,
              coalesce(up.display_name, nullif(trim(coalesce(up.first_name,'') || ' ' || coalesce(left(up.last_name,1),'')), ''), 'Cliente') as author,
              count(*) over() as total
         from public.product_reviews r
         join public.sellers s on s.id = r.seller_id
         join public.products p on p.id = r.product_id
         left join public.user_profiles up on up.user_id = r.user_id
        where s.slug = $1 and s.status = 'ACTIVE' and r.status = 'PUBLISHED' and ($3::int is null or r.rating = $3)
        order by r.created_at desc limit 10 offset $2`,
      [slug, (clampPage(page) - 1) * 10, stars],
    );
    return {
      items: rows.map((r: any) => ({
        id: r.id, rating: r.rating, title: r.title, body: r.body, author: r.author, createdAt: r.created_at,
        product: { title: r.product_title, slug: r.product_slug },
      })),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  }

  /**
   * Home page: the sections of Admin → Configuración → Portada, in their order, each with what it shows.
   * Sections with nothing to show come back empty and the page leaves them out. Cached for 30 s (the web
   * revalidates the page every 30 s too), so the many listings here run at most twice a minute.
   */
  async home() {
    return cached('catalog:home', 30_000, () => this.buildHome());
  }

  private async buildHome() {
    const [layout, featuredOn, categories, popular] = await Promise.all([
      this.settings.get('home.layout'),
      this.settings.get('features.featured_products').then((v) => !!v),
      this.categories(),
      this.listProducts({ sort: 'relevance', pageSize: 12 }),
    ]);
    const on = layout.sections.filter((s) => s.enabled);
    // Sections that may skip products shown above them: fetch more, so they still fill up.
    const extra = (limit: number) => (layout.avoidRepeats ? Math.min(60, limit * 2) : limit);
    const list = (q: ProductQuery) => this.listProducts(q).then((r) => r.items);
    const fetchers: Partial<Record<HomeSectionKey, (s: HomeSection) => Promise<unknown>>> = {
      flash_deals: (s) => list({ flash: true, sort: 'flash_ending', pageSize: extra(s.limit) }),
      best_sellers: (s) => list({ soldDays: s.days || 30, sort: 'relevance', pageSize: extra(s.limit) }),
      featured: async (s) => {
        if (!featuredOn) return [];
        const curated = await list({ featured: true, sort: 'featured', pageSize: extra(s.limit) });
        return curated.length ? curated : popular.items;
      },
      new_arrivals: (s) => list({ sort: 'newest', publishedDays: s.days || undefined, pageSize: extra(s.limit) }),
      deals: (s) => list({ onSale: true, sort: 'relevance', pageSize: extra(s.limit) }),
      preorders: (s) => list({ preorder: true, sort: 'newest', pageSize: extra(s.limit) }),
      category_rows: async (s) => {
        const pool = categories.filter((c) => c.productCount > 0);
        const all = new Map<string, any>();
        const walk = (cs: any[]) => cs.forEach((c) => { all.set(c.slug, c); walk(c.children); });
        walk(categories);
        const picked = s.categories?.length
          ? s.categories.map((slug) => all.get(slug)).filter((c) => c && c.productCount > 0)
          : [...pool].sort((a, b) => b.productCount - a.productCount);
        const rows = await Promise.all(
          picked.slice(0, s.rows ?? 4).map(async (c: any) => ({
            category: { id: c.id, slug: c.slug, name: c.name },
            items: await list({ category: c.slug, sort: 'relevance', pageSize: s.limit }),
          })),
        );
        return rows.filter((r) => r.items.length);
      },
      price_ranges: async (s) => {
        const ranges = await Promise.all(
          (s.thresholds ?? []).map(async (max) => ({ max, items: await list({ maxPrice: max, sort: 'relevance', pageSize: s.limit }) })),
        );
        return ranges.filter((r) => r.items.length);
      },
      top_stores: (s) => this.topStores(s.limit, s.minRating ?? 0),
    };
    const loaded = await Promise.all(on.map((s) => (fetchers[s.key] ? fetchers[s.key]!(s) : Promise.resolve(null))));

    // Same product in two rows looks repetitive: skip it below, unless the section would be left too short.
    const shown = new Set<string>();
    const sections = on.map((s, i) => {
      const data: any = loaded[i];
      const base = { key: s.key, title: s.title, titleEn: s.titleEn, titleFr: s.titleFr, titleHt: s.titleHt, limit: s.limit };
      if (s.key === 'category_rows') return { ...base, rows: data };
      if (s.key === 'price_ranges') return { ...base, ranges: data };
      if (s.key === 'top_stores') return { ...base, stores: data };
      if (!Array.isArray(data)) return base; // rendered by the web (categories, recommended, recently viewed, banners)
      let items = data as any[];
      if (layout.avoidRepeats) {
        const fresh = items.filter((p) => !shown.has(p.id));
        if (fresh.length >= Math.min(4, items.length)) items = fresh;
      }
      items = items.slice(0, s.limit);
      items.forEach((p) => shown.add(p.id));
      return {
        ...base,
        items,
        ...(s.key === 'best_sellers' ? { days: s.days || 30 } : {}),
      };
    });
    const pick = (k: HomeSectionKey) => (sections.find((x) => x.key === k) as any)?.items ?? [];
    return {
      categories: categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, productCount: c.productCount })),
      sections,
      // Kept for the hero preview and for older web builds.
      featured: pick('featured'),
      featuredEnabled: featuredOn && on.some((s) => s.key === 'featured'),
      popular: popular.items,
      newest: pick('new_arrivals'),
      deals: pick('deals'),
      currency: popular.currency,
    };
  }

  /** Stores with published products, best rated first (home "Tiendas destacadas"). */
  private async topStores(limit: number, minRating: number) {
    const rows = await this.db.many(
      `select s.id, s.slug, coalesce(ssp.display_name, s.slug) as name, ssp.short_description, ssp.logo_asset_id, ssp.banner_asset_id,
              ${SELLER_TRUST_SQL('s')}, x.products, coalesce(r.rating, 0)::numeric(3,2)::text as rating, coalesce(r.reviews, 0)::int as reviews
         from public.sellers s
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         join lateral (select count(*)::int as products from public.products p where p.seller_id = s.id and p.status = 'ACTIVE') x on x.products > 0
         left join lateral (select avg(pr.rating) as rating, count(*) as reviews from public.product_reviews pr
                             where pr.seller_id = s.id and pr.status = 'PUBLISHED') r on true
        where s.status = 'ACTIVE' and coalesce(r.rating, 0) >= $1
        order by coalesce(r.rating, 0) desc, coalesce(r.reviews, 0) desc, (s.identity_verified_at is not null) desc, x.products desc, s.created_at
        limit $2`,
      [minRating, limit],
    );
    return rows.map((r: any) => ({
      id: r.id, slug: r.slug, name: r.name, shortDescription: r.short_description,
      logoUrl: r.logo_asset_id ? mediaUrl(r.logo_asset_id) : null,
      bannerUrl: r.banner_asset_id ? mediaUrl(r.banner_asset_id) : null,
      trust: sellerTrust(r), products: r.products, rating: Number(r.rating), reviews: r.reviews,
    }));
  }

  /** Slugs and last change of everything public, for search engines (sitemap.xml holds up to 50,000 URLs). */
  async sitemap() {
    const [products, stores, categories] = await Promise.all([
      this.db.many(
        `select p.slug, coalesce(p.updated_at, p.published_at, p.created_at) as updated_at from public.products p
           join public.sellers s on s.id = p.seller_id
          where p.status = 'ACTIVE' and s.status = 'ACTIVE' order by p.published_at desc nulls last limit 45000`,
      ),
      this.db.many(
        `select s.slug, coalesce(ssp.updated_at, s.updated_at, s.created_at) as updated_at from public.sellers s
           left join public.seller_store_profiles ssp on ssp.seller_id = s.id
          where s.status = 'ACTIVE' order by s.created_at limit 4000`,
      ),
      this.db.many(`select slug, coalesce(updated_at, created_at) as updated_at from public.categories where status = 'ACTIVE' order by sort_order limit 1000`),
    ]);
    const map = (rows: any[]) => rows.map((r) => ({ slug: r.slug, updatedAt: r.updated_at }));
    return { products: map(products), stores: map(stores), categories: map(categories) };
  }

  async searchSuggestions(q: string) {
    if (!q?.trim()) return { products: [], stores: [], categories: [] };
    const term = q.trim().slice(0, 120);
    const [products, stores, categories] = await Promise.all([
      this.db.many(
        `select p.slug, p.title from public.products p join public.sellers s on s.id = p.seller_id
           left join public.seller_store_profiles ssp on ssp.seller_id = s.id
          where p.status='ACTIVE' and s.status='ACTIVE' and ${searchMatch('$1')}
          order by ${searchScore('$1')} desc, p.published_at desc limit 6`,
        [term],
      ),
      this.db.many(
        `select s.slug, coalesce(ssp.display_name, s.slug) as name from public.sellers s
           left join public.seller_store_profiles ssp on ssp.seller_id = s.id
          where s.status='ACTIVE' and ${nameMatch('coalesce(ssp.display_name, s.slug)')}
          order by extensions.word_similarity(public.nx_search_norm($1), public.nx_search_norm(coalesce(ssp.display_name, s.slug))) desc limit 4`,
        [term],
      ),
      this.db.many(
        `select slug, name from public.categories where status='ACTIVE' and ${nameMatch('name')}
          order by extensions.word_similarity(public.nx_search_norm($1), public.nx_search_norm(name)) desc, sort_order limit 4`,
        [term],
      ),
    ]);
    return { products, stores, categories };
  }
}
