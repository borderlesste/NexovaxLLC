import { DbService } from '../db/db.service';
import { GoogleSettings, PlatformSettings, rateCoversRoute, SettingsService } from '../settings/settings.service';
import type { ResolvedPolicy } from '../returns/return-policy.service';
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

/** Published products of active stores with the variant the product page shows first (one row each). */
function loadRows(db: DbService, currency: string, slug?: string) {
  return db.many<Row>(
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
              where vpv.variant_id = pv.id and vpv.currency_code = $1 and vpv.status in ('ACTIVE','SCHEDULED')
                and vpv.effective_from <= now() and (vpv.effective_to is null or vpv.effective_to > now())
              order by vpv.effective_from desc limit 1) ap on true
          where pv.product_id = p.id and pv.status = 'ACTIVE'
          order by (coalesce((select sum(ii.available_to_sell) from public.inventory_items ii where ii.variant_id = pv.id and ii.status = 'ACTIVE'), 0) > 0) desc,
                   pv.is_default desc, pv.created_at
          limit 1) v on true
      where p.status in ('ACTIVE', 'OUT_OF_STOCK') and s.status = 'ACTIVE' and v.amount > 0
      ${slug ? 'and p.slug = $2' : ''}
      order by p.published_at desc nulls last
      limit ${slug ? 1 : 45000}`,
    slug ? [currency, slug] : [currency],
  );
}

/** Feed and product-page structured data read the same settings, so Google sees one set of facts. */
function context(s: PlatformSettings) {
  const g: Partial<GoogleSettings> = s['google.integrations'] ?? {};
  const currency = s['marketplace.currency'] || 'USD';
  const base = (s['seo.defaults']?.canonicalUrl || s['marketplace.base_url'] || '').replace(/\/+$/, '');
  const name = s['seo.defaults']?.siteName || s['marketplace.name'] || 'Marketplace';
  const offered = (s['geo.delivery']?.countries ?? []).map((c) => c.toUpperCase());
  const shipCountries = (g.merchantShippingCountries?.length ? g.merchantShippingCountries : [s['marketplace.default_country'] || 'US'])
    .map((c) => c.toUpperCase())
    .filter((c) => !offered.length || offered.includes(c));
  const rates = (s['shipping.rates'] ?? []).filter((r) => r.code !== 'PICKUP');
  return { g, currency, base, name, shipCountries, rates, times: deliveryTimes(g) };
}
type Ctx = ReturnType<typeof context>;

/** Handling and transit days (Admin → Configuración → Google); a range is only sent when it is coherent. */
export function deliveryTimes(g: Partial<GoogleSettings>) {
  const range = (min: unknown, max: unknown) => {
    const a = Number(min), b = Number(max);
    return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a ? { min: a, max: b } : null;
  };
  return { handling: range(g.merchantHandlingMinDays, g.merchantHandlingMaxDays), transit: range(g.merchantTransitMinDays, g.merchantTransitMaxDays) };
}

/** What Google is told about one product: text, identifiers and the cheapest flat rate per destination. */
function facts(r: Row, c: Ctx) {
  const brand = r.brand || (c.g.merchantStoreAsBrand ? r.store : null);
  const gtin = validGtin(r.barcode);
  const shipping: { country: string; service: string; amount: number }[] = [];
  if (r.requires_shipping !== false) {
    for (const cc of c.shipCountries) {
      if (!allowed(r.store_mode, r.store_countries, cc, r.origin) || !allowed(r.product_mode, r.product_countries, cc, r.origin)) continue;
      const cover = c.rates.filter((x) => rateCoversRoute({ ...x, regions: undefined }, r.origin, { country_code: cc }));
      if (!cover.length) continue;
      const best = cover.reduce((a, b) => (Number(b.amount) < Number(a.amount) ? b : a));
      shipping.push({ country: cc, service: clip(best.name || 'Standard', 100), amount: Number(best.amount) });
    }
  }
  return {
    description: clip(plain(r.description) || plain(r.short_description) || r.title, 5000),
    brand: brand ? clip(brand, 70) : null,
    gtin,
    // Without a GTIN, brand + seller SKU (as MPN) identify the item; otherwise identifier_exists = no.
    mpn: r.sku && brand && !gtin ? clip(r.sku, 70) : null,
    condition: r.item_condition?.toLowerCase() || c.g.merchantCondition || 'new',
    onSale: r.compare_at != null && Number(r.compare_at) > Number(r.price),
    shipping,
  };
}

/**
 * Google Merchant Center product feed (RSS 2.0 + g: namespace), one item per published product of an
 * active store. Price and stock are those of the variant the product page shows first, so they match
 * the landing page. Shipping per country comes from the marketplace flat rates when one covers the route;
 * otherwise Merchant Center's own shipping settings apply.
 */
export async function googleMerchantFeed(db: DbService, settings: SettingsService): Promise<string | null> {
  const s = await settings.all();
  if (!s['google.integrations']?.merchantFeedEnabled) return null;
  const c = context(s);
  const { g, currency, base, name, times } = c;
  const rows = await loadRows(db, currency);

  const items: string[] = [];
  for (const r of rows) {
    const inStock = r.stock > 0;
    if (!inStock && !g.merchantIncludeOutOfStock) continue;
    if (!r.images.length) continue; // Google rejects items without an image
    const x = facts(r, c);
    const f: string[] = [
      `<g:id>${xml(r.id)}</g:id>`,
      `<g:title>${xml(clip(r.title, 150))}</g:title>`,
      `<g:description>${xml(x.description)}</g:description>`,
      `<g:link>${xml(`${base}/producto/${encodeURIComponent(r.slug)}`)}</g:link>`,
      `<g:image_link>${xml(base + mediaUrl(r.images[0]))}</g:image_link>`,
      ...r.images.slice(1, 11).map((a) => `<g:additional_image_link>${xml(base + mediaUrl(a))}</g:additional_image_link>`),
      `<g:availability>${inStock ? 'in_stock' : 'out_of_stock'}</g:availability>`,
      `<g:price>${money(x.onSale ? r.compare_at! : r.price!, currency)}</g:price>`,
      ...(x.onSale ? [`<g:sale_price>${money(r.price!, currency)}</g:sale_price>`] : []),
      `<g:condition>${x.condition}</g:condition>`,
      ...(x.brand ? [`<g:brand>${xml(x.brand)}</g:brand>`] : []),
      ...(x.gtin ? [`<g:gtin>${x.gtin}</g:gtin>`] : []),
      ...(x.mpn ? [`<g:mpn>${xml(x.mpn)}</g:mpn>`] : []),
      ...(!x.gtin && !x.mpn ? ['<g:identifier_exists>no</g:identifier_exists>'] : []),
      ...(r.category_path ? [`<g:product_type>${xml(clip(r.category_path, 750))}</g:product_type>`] : []),
      `<g:custom_label_0>${xml(clip(r.store, 100))}</g:custom_label_0>`,
    ];
    if (r.weight_value && Number(r.weight_value) > 0 && ['kg', 'g', 'lb', 'oz'].includes((r.weight_unit ?? '').toLowerCase()))
      f.push(`<g:shipping_weight>${Number(r.weight_value)} ${(r.weight_unit ?? '').toLowerCase()}</g:shipping_weight>`);
    for (const sh of x.shipping) {
      const transit = times.transit ? `<g:min_transit_time>${times.transit.min}</g:min_transit_time><g:max_transit_time>${times.transit.max}</g:max_transit_time>` : '';
      f.push(`<g:shipping><g:country>${sh.country}</g:country><g:service>${xml(sh.service)}</g:service><g:price>${money(sh.amount, currency)}</g:price>${transit}</g:shipping>`);
    }
    if (x.shipping.length && times.handling) f.push(`<g:min_handling_time>${times.handling.min}</g:min_handling_time><g:max_handling_time>${times.handling.max}</g:max_handling_time>`);
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

const RETURN_FEES = {
  CUSTOMER: 'https://schema.org/ReturnFeesCustomerResponsibility',
  STORE: 'https://schema.org/FreeReturn',
  MARKETPLACE: 'https://schema.org/FreeReturn',
} as const;

/** schema.org MerchantReturnPolicy from the single marketplace return policy (Admin → Devoluciones). */
export function returnPolicyJsonLd(p: ResolvedPolicy, countries: string[], origin: string | null, base: string) {
  const out: Record<string, unknown> = {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: countries.length === 1 ? countries[0] : countries,
    ...(origin ? { returnPolicyCountry: origin } : {}),
    merchantReturnLink: base ? `${base}/politica-de-devoluciones` : undefined,
  };
  if (p.windowDays <= 0) return { ...out, returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted' };
  Object.assign(out, {
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: p.windowDays,
    returnMethod: 'https://schema.org/ReturnByMail',
    refundType: 'https://schema.org/FullRefund',
  });
  if (p.labelPayer === 'BY_REASON') {
    // The store pays the label when the problem is the store's; otherwise the customer pays the return.
    out.customerRemorseReturnFees = RETURN_FEES.CUSTOMER;
    out.itemDefectReturnFees = RETURN_FEES.STORE;
  } else out.returnFees = RETURN_FEES[p.labelPayer] ?? RETURN_FEES.CUSTOMER;
  if (p.restockingFeePercent > 0) out.restockingFee = p.restockingFeePercent;
  return out;
}

/**
 * schema.org Product for the product page (JSON-LD), built from the same row and settings as the
 * Merchant Center feed: description, brand/GTIN/MPN, shipping per destination with handling and
 * transit days, and the marketplace return policy. Null when the product isn't published.
 */
export async function productJsonLd(db: DbService, settings: SettingsService, policy: () => Promise<ResolvedPolicy | null>, slug: string) {
  const s = await settings.all();
  const c = context(s);
  const [r] = await loadRows(db, c.currency, slug);
  if (!r) return null;
  const x = facts(r, c);
  const p = await policy().catch(() => null);
  const url = `${c.base}/producto/${encodeURIComponent(r.slug)}`;
  const { handling, transit } = c.times;
  const shippingDetails = x.shipping.map((sh) => ({
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: sh.amount.toFixed(2), currency: c.currency },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: sh.country },
    ...(handling || transit
      ? {
          deliveryTime: {
            '@type': 'ShippingDeliveryTime',
            ...(handling ? { handlingTime: { '@type': 'QuantitativeValue', minValue: handling.min, maxValue: handling.max, unitCode: 'DAY' } } : {}),
            ...(transit ? { transitTime: { '@type': 'QuantitativeValue', minValue: transit.min, maxValue: transit.max, unitCode: 'DAY' } } : {}),
          },
        }
      : {}),
  }));
  const countries = x.shipping.length ? x.shipping.map((sh) => sh.country) : c.shipCountries;
  const condition = { new: 'NewCondition', used: 'UsedCondition', refurbished: 'RefurbishedCondition' }[x.condition] ?? 'NewCondition';
  const gtinKey = x.gtin ? `gtin${x.gtin.length}` : null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: r.title,
    description: x.description,
    url,
    image: r.images.slice(0, 10).map((a) => c.base + mediaUrl(a)),
    ...(r.sku ? { sku: r.sku } : {}),
    ...(x.brand ? { brand: { '@type': 'Brand', name: x.brand } } : {}),
    ...(gtinKey ? { [gtinKey]: x.gtin } : {}),
    ...(x.mpn ? { mpn: x.mpn } : {}),
    ...(r.category_path ? { category: r.category_path } : {}),
    offers: {
      '@type': 'Offer',
      url,
      price: Number(r.price).toFixed(2),
      priceCurrency: c.currency,
      itemCondition: `https://schema.org/${condition}`,
      availability: r.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: r.store },
      ...(shippingDetails.length ? { shippingDetails } : {}),
      ...(p && countries.length ? { hasMerchantReturnPolicy: returnPolicyJsonLd(p, countries, r.origin, c.base) } : {}),
    },
  };
}
