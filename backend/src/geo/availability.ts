import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';
import { REAL_COUNTRY } from '../common/geo';
import { badRequest } from '../common/errors';
import { toMinor } from '../common/money';
import { rateCoversRoute, SettingsService, ShippingRate } from '../settings/settings.service';
import { ShippoService } from '../shipping/shippo.service';

export type AvailabilityStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'UNCONFIRMED';
/** Why: the UI explains it in the buyer's language (NX-GEO-001 §4). */
export type AvailabilityReason =
  | 'NO_SHIPPING_NEEDED'
  | 'ROUTE_OK'
  | 'PICKUP_ONLY'
  | 'MARKETPLACE_NOT_SERVED'
  | 'STORE_DOMESTIC_ONLY'
  | 'STORE_EXCLUDED'
  | 'PRODUCT_EXCLUDED'
  | 'FREE_SHIPPING_MINIMUM'
  | 'NO_SHIPPING_OPTION'
  | 'NO_ORIGIN'
  | 'NEEDS_ADDRESS'
  | 'NOT_FOUND';

export interface Availability {
  status: AvailabilityStatus;
  reason: AvailabilityReason;
  /** Country the store ships from (not the store's domicile or where the item was made). */
  shipsFrom: string | null;
}

export type RestrictionMode = 'ALL' | 'DOMESTIC' | 'ONLY' | 'EXCEPT';
export interface Restriction {
  mode: RestrictionMode;
  countries: string[];
}

export interface RouteFacts {
  destination: string;
  /** Destinations the marketplace offers; empty = all. */
  offered: string[];
  requiresShipping: boolean;
  origin: string | null;
  store: Restriction | null;
  product: Restriction | null;
  flatRates: ShippingRate[];
  /** Null when there is no promotion for this route; zero when there is no minimum. */
  sellerFreeShippingMinimum?: string | null;
  liveRates: boolean;
  /** The store got live carrier rates to this country recently. */
  knownLane: boolean;
}

const allows = (r: Restriction | null, dest: string, origin: string | null): boolean | 'DOMESTIC' => {
  if (!r || r.mode === 'ALL') return true;
  if (r.mode === 'DOMESTIC') return origin ? origin === dest || 'DOMESTIC' : 'DOMESTIC';
  if (r.mode === 'ONLY') return r.countries.includes(dest);
  return !r.countries.includes(dest);
};

/**
 * Country-level availability of one product for a destination. Informative: it never replaces
 * the checkout validation with the confirmed address. Uncertainty (no address, a provider that
 * can't be reached, unknown origin) is "Por confirmar", never a prohibition.
 */
export function evaluateRoute(f: RouteFacts): Availability {
  const shipsFrom = f.origin;
  const out = (status: AvailabilityStatus, reason: AvailabilityReason): Availability => ({ status, reason, shipsFrom });
  if (f.offered.length && !f.offered.includes(f.destination)) return out('UNAVAILABLE', 'MARKETPLACE_NOT_SERVED');
  if (!f.requiresShipping) return out('AVAILABLE', 'NO_SHIPPING_NEEDED');
  const store = allows(f.store, f.destination, f.origin);
  if (store === 'DOMESTIC') return f.origin ? out('UNAVAILABLE', 'STORE_DOMESTIC_ONLY') : out('UNCONFIRMED', 'NO_ORIGIN');
  if (!store) return out('UNAVAILABLE', 'STORE_EXCLUDED');
  if (!allows(f.product, f.destination, f.origin)) return out('UNAVAILABLE', 'PRODUCT_EXCLUDED');
  if (!f.origin) return out('UNCONFIRMED', 'NO_ORIGIN');
  const dest = { country_code: f.destination, region: null };
  const flat = f.flatRates.some((r) => r.code !== 'PICKUP' && rateCoversRoute({ ...r, regions: undefined }, f.origin, dest));
  const freeMinimum = f.sellerFreeShippingMinimum;
  if (flat || (f.liveRates && f.knownLane) || (freeMinimum != null && toMinor(freeMinimum) === 0n))
    return out('AVAILABLE', 'ROUTE_OK');
  if (!f.liveRates && f.origin === f.destination && f.flatRates.some((r) => r.code === 'PICKUP'))
    return out('AVAILABLE', 'PICKUP_ONLY');
  if (freeMinimum != null) return out('UNCONFIRMED', 'FREE_SHIPPING_MINIMUM');
  if (f.liveRates) return out('UNCONFIRMED', 'NEEDS_ADDRESS');
  return out('UNAVAILABLE', 'NO_SHIPPING_OPTION');
}

export const MAX_AVAILABILITY_ITEMS = 100;

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly shippo: ShippoService,
  ) {}

  private async country(code: string, client?: Queryable) {
    const cc = (code ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc) || !(await this.db.one(`select 1 from public.countries where alpha2 = $1 and is_active and ${REAL_COUNTRY}`, [cc], client)))
      throw badRequest('COUNTRY_INVALID', 'Selecciona un país válido.');
    return cc;
  }

  /** Availability of up to 100 published products for one destination country. */
  async forProducts(countryCode: string, productIds: string[]): Promise<{ country: string; items: Record<string, Availability> }> {
    const r = await this.forItems(countryCode, productIds, []);
    return { country: r.country, items: r.items };
  }

  /**
   * Availability by product and, when given, by variant: a variant ships from the warehouse that
   * holds its stock (its origin may differ from the store's default), so its route is evaluated
   * with that origin. Restrictions stay per store and product.
   */
  async forItems(countryCode: string, productIds: string[], variantIds: string[] = [], client?: Queryable) {
    const country = await this.country(countryCode, client);
    const uuid = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
    const ids = [...new Set(productIds.filter(uuid))].slice(0, MAX_AVAILABILITY_ITEMS);
    const vids = [...new Set(variantIds.filter(uuid))].slice(0, MAX_AVAILABILITY_ITEMS);
    const items: Record<string, Availability> = {};
    const variants: Record<string, Availability> = {};
    if (!ids.length && !vids.length) return { country, items, variants };
    const s = await this.settings.all(client);
    const geo = s['geo.delivery'] ?? { ipDetection: true, showSelector: true, countries: [] };
    const days = Math.min(Math.max(Number(geo.laneHistoryDays ?? 90) || 90, 1), 365);
    const liveRates = this.shippo.enabled && !!s['shipping.shippo_enabled'];
    // Variants: their own origin (the highest-priority active fulfillment location that stocks them).
    const vrows = vids.length
      ? await this.db.many<{ id: string; product_id: string; origin: string | null }>(
          `select v.id, v.product_id,
                  (select a.country_code from public.inventory_items ii
                     join public.inventory_locations il on il.id = ii.location_id
                     join public.seller_ship_from_addresses a on a.id = il.ship_from_address_id and a.status = 'ACTIVE'
                    where ii.variant_id = v.id and ii.status = 'ACTIVE' and il.status = 'ACTIVE' and il.fulfillment_enabled
                    order by (ii.available_to_sell > 0) desc, il.fulfillment_priority, ii.available_to_sell desc limit 1) as origin
             from public.product_variants v where v.id = any($1::uuid[])`,
          [vids], client,
        )
      : [];
    const allIds = [...new Set([...ids, ...vrows.map((v) => v.product_id)])];
    const rows = await this.db.many<{
      id: string; seller_id: string; requires_shipping: boolean; origin: string | null; free_shipping_minimum: string | null;
      store_mode: RestrictionMode | null; store_countries: string[] | null; product_mode: RestrictionMode | null; product_countries: string[] | null; lane: boolean;
    }>(
      `select p.id, p.seller_id, p.requires_shipping,
              (select a.country_code from public.seller_ship_from_addresses a where a.seller_id = p.seller_id and a.status = 'ACTIVE'
                order by a.is_default desc, a.created_at limit 1) as origin,
              sr.mode as store_mode, sr.countries::text[] as store_countries, pr.mode as product_mode, pr.countries::text[] as product_countries,
              (case when fs.product_id is not null then coalesce(fs.minimum_subtotal, 0) end)::text as free_shipping_minimum,
              ($3 and exists (select 1 from public.shipping_quote_requests q
                         join public.shipping_rate_options o on o.quote_request_id = q.id and o.shipping_provider_code = 'SHIPPO'
                        where q.seller_id = p.seller_id and q.request_snapshot -> 'destination' ->> 'country' = $2
                          and q.created_at > now() - make_interval(days => $4))) as lane
         from public.products p
         left join public.destination_restrictions sr on sr.seller_id = p.seller_id and sr.product_id is null
         left join public.destination_restrictions pr on pr.product_id = p.id
         left join public.nx_product_free_shipping fs on fs.product_id = p.id and fs.enabled
           and fs.currency_code = $5 and $2 = any(fs.country_codes)
        where p.id = any($1::uuid[]) and p.status = 'ACTIVE'`,
      [allIds, country, liveRates, days, s['marketplace.currency'] || 'USD'], client,
    );
    const offered = (geo.countries ?? []).map((c: string) => c.toUpperCase());
    const facts = (r: (typeof rows)[number], origin: string | null): RouteFacts => ({
      destination: country,
      offered,
      requiresShipping: r.requires_shipping !== false,
      origin,
      store: r.store_mode ? { mode: r.store_mode, countries: r.store_countries ?? [] } : null,
      product: r.product_mode ? { mode: r.product_mode, countries: r.product_countries ?? [] } : null,
      flatRates: s['shipping.rates'] ?? [],
      sellerFreeShippingMinimum: r.free_shipping_minimum,
      liveRates,
      knownLane: r.lane,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const r = byId.get(id);
      items[id] = r ? evaluateRoute(facts(r, r.origin)) : { status: 'UNCONFIRMED', reason: 'NOT_FOUND', shipsFrom: null };
    }
    const vById = new Map(vrows.map((v) => [v.id, v]));
    for (const vid of vids) {
      const v = vById.get(vid);
      const r = v ? byId.get(v.product_id) : undefined;
      variants[vid] = r ? evaluateRoute(facts(r, v!.origin ?? r.origin)) : { status: 'UNCONFIRMED', reason: 'NOT_FOUND', shipsFrom: null };
    }
    return { country, items, variants };
  }

  // ------------------------------------------------------------ store / product rules

  private async cleanCountries(list: unknown) {
    if (!Array.isArray(list) || list.length > 300) throw badRequest('COUNTRIES_INVALID', 'Lista de países inválida.');
    // Dedupe and shape-check first; then validate each distinct code once (at most ~250 countries exist).
    const unique = [...new Set(list.map((c) => String(c ?? '').trim().toUpperCase()))];
    if (unique.length > 260 || unique.some((c) => !/^[A-Z]{2}$/.test(c))) throw badRequest('COUNTRIES_INVALID', 'Lista de países inválida.');
    const out: string[] = [];
    for (const c of unique) {
      const cc = await this.country(c);
      if (!out.includes(cc)) out.push(cc);
    }
    return out;
  }

  async get(sellerId: string, productId: string | null) {
    const r = await this.db.one<{ mode: RestrictionMode; countries: string[]; note: string | null; updated_at: string }>(
      `select mode, countries::text[] as countries, note, updated_at from public.destination_restrictions
        where seller_id = $1 and product_id is not distinct from $2::uuid`,
      [sellerId, productId],
    );
    return r ? { mode: r.mode, countries: r.countries, note: r.note, updatedAt: r.updated_at } : { mode: 'ALL' as RestrictionMode, countries: [], note: null, updatedAt: null };
  }

  /** Saves the store's (productId null) or one product's destinations; the product must belong to the store. */
  async set(sellerId: string, productId: string | null, actorUserId: string, input: { mode: string; countries?: unknown; note?: string | null }) {
    const modes: RestrictionMode[] = productId ? ['ALL', 'ONLY', 'EXCEPT'] : ['ALL', 'DOMESTIC', 'ONLY', 'EXCEPT'];
    if (!modes.includes(input.mode as RestrictionMode)) throw badRequest('MODE_INVALID', 'Opción de destinos inválida.');
    const mode = input.mode as RestrictionMode;
    const countries = mode === 'ONLY' || mode === 'EXCEPT' ? await this.cleanCountries(input.countries ?? []) : [];
    if ((mode === 'ONLY' || mode === 'EXCEPT') && !countries.length) throw badRequest('COUNTRIES_REQUIRED', 'Elige al menos un país.');
    const note = (input.note ?? '').trim().slice(0, 300) || null;
    if (productId && !(await this.db.one(`select 1 from public.products where id = $1 and seller_id = $2`, [productId, sellerId])))
      throw badRequest('PRODUCT_NOT_FOUND', 'Producto no encontrado.');
    await this.db.exec(
      productId
        ? `insert into public.destination_restrictions (seller_id, product_id, mode, countries, note, updated_by_user_id)
           values ($1, $2, $3, $4::varchar(2)[], $5, $6)
           on conflict (product_id) where product_id is not null
           do update set mode = excluded.mode, countries = excluded.countries, note = excluded.note, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()`
        : `insert into public.destination_restrictions (seller_id, product_id, mode, countries, note, updated_by_user_id)
           values ($1, $2, $3, $4::varchar(2)[], $5, $6)
           on conflict (seller_id) where product_id is null
           do update set mode = excluded.mode, countries = excluded.countries, note = excluded.note, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()`,
      [sellerId, productId, mode, countries, note, actorUserId],
    );
    return this.get(sellerId, productId);
  }
}
