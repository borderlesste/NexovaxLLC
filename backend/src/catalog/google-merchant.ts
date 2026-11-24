import { DbService } from '../db/db.service';
import { rateCoversRoute, SettingsService } from '../settings/settings.service';
import { mediaUrl } from './catalog.sql';

/** Google accepts up to 150 characters in titles and 5,000 in descriptions. */
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const xml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
/** Plain text from the seller's description (it may hold simple HTML/Markdown). */
const plain = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_#`>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const money = (amount: string | number, currency: string) => `${Number(amount).toFixed(2)} ${currency}`;
/** GTIN-8/12/13/14 with a valid check digit; anything else is not sent as a GTIN. */
export function validGtin(code: string | null | undefined): string | null {
  const d = (code ?? '').replace(/[\s-]/g, '');
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(d) || /^0+$/.test(d)) return null;
  const digits = d.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((a, n, i) => a + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? d : null;
}

type Row = {
  id: string; slug: string; title: string; short_description: string | null; description: string | null; requires_shipping: boolean;
  item_condition: 'NEW' | 'USED' | null; brand: string | null; store: string; origin: string | null; category_path: string | null;
  price: string | null; compare_at: string | null; sku: string | null; barcode: string | null; stock: number;
  weight_value: string | null; weight_unit: string | null; images: string[];
  store_mode: string | null; store_countries: string[] | null; product_mode: string | null; product_countries: string[] | null;
};

const allowed = (mode: string | null, countries: string[] | null, dest: string, origin: string | null) => {
  if (!mode || mode === 'ALL') return true;
  if (mode === 'DOMESTIC') return !!origin && origin === dest;
  if (mode === 'ONLY') return (countries ?? []).includes(dest);
  return !(countries ?? []).includes(dest);
};

/**
 * Google Merchant Center product feed (RSS 2.0 + g: namespace), one item per published product of an
 * active store. Price and stock are those of the variant the product page shows first, so they match
 * the landing page. Shipping per country comes from the marketplace flat rates when one covers the route;
 * otherwise Merchant Center's own shipping settings apply.
 */
export async function googleMerchantFeed(db: DbService, settings: SettingsService): Promise<string | null> {
  const s = await settings.all();
  const g = s['google.integrations'];
  if (!g?.merchantFeedEnabled) return null;
  const currency = s['marketplace.currency'] || 'USD';
  const base = (s['seo.defaults']?.canonicalUrl || s['marketplace.base_url'] || '').replace(/\/+$/, '');
  const name = s['seo.defaults']?.siteName || s['marketplace.name'] || 'Marketplace';
  const offered = (s['geo.delivery']?.countries ?? []).map((c) => c.toUpperCase());
  const shipCountries = (g.merchantShippingCountries?.length ? g.merchantShippingCountries : [s['marketplace.default_country'] || 'US'])
    .map((c) => c.toUpperCase())
    .filter((c) => !offered.length || offered.includes(c));
  const rates = (s['shipping.rates'] ?? []).filter((r) => r.code !== 'PICKUP');

  const rows = await db.many<Row>(
    `select p.id, p.slug, p.title, p.short_description, p.description, p.requires_shipping, p.item_condition,
            b.name as brand, coalesce(ssp.display_name, s.slug) as store,
            (select a.country_code from public.seller_ship_from_addresses a where a.seller_id = p.seller_id and a.status = 'ACTIVE'
              order by a.is_default desc, a.created_at limit 1) as origin,
            (with recursive up as (select id, parent_id, name, 0 as depth from public.categories where id = p.category_id
                                    union all select c.id, c.parent_id, c.name, up.depth + 1 from public.categories c join up on c.id = up.parent_id)
              select string_agg(name, ' > ' order by depth desc) from up) as category_path,
            v.amount::text as price, v.compare_at_amount::text as compare_at, v.sku, v.barcode, coalesce(v.stock, 0)::int as stock,
            v.weight_value::text as weight_value, v.weight_unit,
            coalesce((select array_agg(pm.asset_id::text order by pm.is_primary desc, pm.sort_order, pm.created_at)
                        from public.product_media pm where pm.product_id = p.id and pm.media_role in ('COVER','GALLERY')), '{}') as images,
            sr.mode as store_mode, sr.countries::text[] as store_countries, pr.mode as product_mode, pr.countries::text[] as product_countries
       from public.products p
       join public.sellers s on s.id = p.seller_id
       left join public.seller_store_profiles ssp on ssp.seller_id = s.id
       left join public.brands b on b.id = p.brand_id
       left join public.destination_restrictions sr on sr.seller_id = p.seller_id and sr.product_id is null
       left join public.destination_restrictions pr on pr.product_id = p.id
       join lateral (
         select pv.sku, pv.barcode, pv.weight_value, pv.weight_unit, ap.amount, ap.compare_at_amount,
                (select sum(ii.available_to_sell) from public.inventory_items ii where ii.variant_id = pv.id and ii.status = 'ACTIVE') as stock
           from public.product_variants pv
           join lateral (
             select vpv.amount, vpv.compare_at_amount from public.variant_price_versions vpv
              where vpv.variant_id = pv.id and vpv.currency_code = $1 and vpv.status = 'ACTIVE'
                and vpv.effective_from <= now() and (vpv.effective_to is null or vpv.effective_to > now())
              order by vpv.effective_from desc limit 1) ap on true
          where pv.product_id = p.id and pv.status = 'ACTIVE'
          order by (coalesce((select sum(ii.available_to_sell) from public.inventory_items ii where ii.variant_id = pv.id and ii.status = 'ACTIVE'), 0) > 0) desc,
                   pv.is_default desc, pv.created_at
          limit 1) v on true
      where p.status in ('ACTIVE', 'OUT_OF_STOCK') and s.status = 'ACTIVE' and v.amount > 0
      order by p.published_at desc nulls last
      limit 45000`,
    [currency],
  );

  const items: string[] = [];
  for (const r of rows) {
    const inStock = r.stock > 0;
    if (!inStock && !g.merchantIncludeOutOfStock) continue;
    if (!r.images.length) continue; // Google rejects items without an image
    const description = clip(plain(r.description) || plain(r.short_description) || r.title, 5000);
    const brand = r.brand || (g.merchantStoreAsBrand ? r.store : null);
    const gtin = validGtin(r.barcode);
    const onSale = r.compare_at != null && Number(r.compare_at) > Number(r.price);
    const f: string[] = [
      `<g:id>${xml(r.id)}</g:id>`,
      `<g:title>${xml(clip(r.title, 150))}</g:title>`,
      `<g:description>${xml(description)}</g:description>`,
      `<g:link>${xml(`${base}/producto/${encodeURIComponent(r.slug)}`)}</g:link>`,
      `<g:image_link>${xml(base + mediaUrl(r.images[0]))}</g:image_link>`,
      ...r.images.slice(1, 11).map((a) => `<g:additional_image_link>${xml(base + mediaUrl(a))}</g:additional_image_link>`),
      `<g:availability>${inStock ? 'in_stock' : 'out_of_stock'}</g:availability>`,
      `<g:price>${money(onSale ? r.compare_at! : r.price!, currency)}</g:price>`,
      ...(onSale ? [`<g:sale_price>${money(r.price!, currency)}</g:sale_price>`] : []),
      `<g:condition>${r.item_condition?.toLowerCase() || g.merchantCondition || 'new'}</g:condition>`,
      ...(brand ? [`<g:brand>${xml(clip(brand, 70))}</g:brand>`] : []),
      ...(gtin ? [`<g:gtin>${gtin}</g:gtin>`] : []),
      ...(r.sku && brand && !gtin ? [`<g:mpn>${xml(clip(r.sku, 70))}</g:mpn>`] : []),
      ...(!gtin && !(brand && r.sku) ? ['<g:identifier_exists>no</g:identifier_exists>'] : []),
      ...(r.category_path ? [`<g:product_type>${xml(clip(r.category_path, 750))}</g:product_type>`] : []),
      `<g:custom_label_0>${xml(clip(r.store, 100))}</g:custom_label_0>`,
    ];
    if (r.weight_value && Number(r.weight_value) > 0 && ['kg', 'g', 'lb', 'oz'].includes((r.weight_unit ?? '').toLowerCase()))
      f.push(`<g:shipping_weight>${Number(r.weight_value)} ${(r.weight_unit ?? '').toLowerCase()}</g:shipping_weight>`);
    if (r.requires_shipping !== false) {
      for (const cc of shipCountries) {
        if (!allowed(r.store_mode, r.store_countries, cc, r.origin) || !allowed(r.product_mode, r.product_countries, cc, r.origin)) continue;
        const cover = rates.filter((x) => rateCoversRoute({ ...x, regions: undefined }, r.origin, { country_code: cc }));
        if (!cover.length) continue;
        const best = cover.reduce((a, b) => (Number(b.amount) < Number(a.amount) ? b : a));
        f.push(`<g:shipping><g:country>${cc}</g:country><g:service>${xml(clip(best.name || 'Standard', 100))}</g:service><g:price>${money(best.amount, currency)}</g:price></g:shipping>`);
      }
    }
    items.push(`<item>${f.join('')}</item>`);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '<channel>',
    `<title>${xml(name)}</title>`,
    `<link>${xml(base || '/')}</link>`,
    `<description>${xml(`${name} · Google Merchant Center`)}</description>`,
    ...items,
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
}
