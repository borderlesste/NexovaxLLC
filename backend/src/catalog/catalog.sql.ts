/**
 * Shared SQL fragments for catalog read models.
 * Prices come from the pricing domain (active variant_price_versions); stock is
 * the sum of available_to_sell across ACTIVE inventory items.
 */
export const ACTIVE_PRICE_LATERAL = (variantAlias: string, currencyParam: string) => `
  select vpv.id as price_version_id, vpv.amount, vpv.compare_at_amount
    from public.variant_price_versions vpv
   where vpv.variant_id = ${variantAlias}.id
     and vpv.currency_code = ${currencyParam}
     and vpv.status = 'ACTIVE'
     and vpv.effective_from <= now()
     and (vpv.effective_to is null or vpv.effective_to > now())
   order by vpv.effective_from desc
   limit 1`;

/** Card-level projection for a product (one row per product). */
export const PRODUCT_CARD_SELECT = (currencyParam: string) => `
  p.id, p.slug, p.title, p.short_description, p.status, p.created_at, p.published_at,
  p.category_id, c.name as category_name, c.slug as category_slug,
  s.id as seller_id, s.slug as seller_slug, coalesce(ssp.display_name, s.slug) as seller_name,
  (s.verification_status = 'VERIFIED') as seller_verified,
  pr.min_amount as price, pr.compare_at as compare_at_price,
  (select pm.asset_id from public.product_media pm
     where pm.product_id = p.id and pm.media_role in ('COVER','GALLERY')
     order by pm.is_primary desc, pm.sort_order, pm.created_at limit 1) as image_id,
  coalesce(rv.avg_rating, 0)::numeric(3,2)::text as rating,
  coalesce(rv.review_count, 0)::int as review_count,
  coalesce(st.available, 0)::int as stock,
  coalesce(sold.qty, 0)::int as sold_count`;

export const PRODUCT_CARD_JOINS = (currencyParam: string) => `
  join public.sellers s on s.id = p.seller_id
  left join public.seller_store_profiles ssp on ssp.seller_id = s.id
  join public.categories c on c.id = p.category_id
  left join lateral (
    select min(ap.amount) as min_amount,
           (array_agg(ap.compare_at_amount order by ap.amount))[1] as compare_at
      from public.product_variants v
      cross join lateral (${ACTIVE_PRICE_LATERAL('v', currencyParam)}) ap
     where v.product_id = p.id and v.status = 'ACTIVE'
  ) pr on true
  left join lateral (
    select avg(r.rating) as avg_rating, count(*) as review_count
      from public.product_reviews r where r.product_id = p.id and r.status = 'PUBLISHED'
  ) rv on true
  left join lateral (
    select sum(ii.available_to_sell) as available
      from public.inventory_items ii
      join public.product_variants v2 on v2.id = ii.variant_id and v2.status = 'ACTIVE'
     where v2.product_id = p.id and ii.status = 'ACTIVE'
  ) st on true
  left join lateral (
    select sum(oi.quantity) as qty from public.order_items oi where oi.product_id = p.id
  ) sold on true`;

export function mapProductCard(r: any) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    shortDescription: r.short_description,
    status: r.status,
    category: { id: r.category_id, name: r.category_name, slug: r.category_slug },
    seller: { id: r.seller_id, slug: r.seller_slug, name: r.seller_name, verified: r.seller_verified },
    price: r.price,
    compareAtPrice: r.compare_at_price,
    discountPercent:
      r.price && r.compare_at_price && Number(r.compare_at_price) > Number(r.price)
        ? Math.round((1 - Number(r.price) / Number(r.compare_at_price)) * 100)
        : null,
    imageUrl: r.image_id ? mediaUrl(r.image_id) : null,
    rating: Number(r.rating),
    reviewCount: r.review_count,
    stock: r.stock,
    soldCount: r.sold_count,
    createdAt: r.created_at,
  };
}

export const mediaUrl = (assetId: string) => `/api/media/${assetId}`;
