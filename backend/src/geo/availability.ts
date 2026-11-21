import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { REAL_COUNTRY } from '../common/geo';
import { badRequest } from '../common/errors';
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
  if (flat || (f.liveRates && f.knownLane)) return out('AVAILABLE', 'ROUTE_OK');
  if (f.liveRates) return out('UNCONFIRMED', 'NEEDS_ADDRESS');
  if (f.origin === f.destination && f.flatRates.some((r) => r.code === 'PICKUP')) return out('AVAILABLE', 'PICKUP_ONLY');
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

  private async country(code: string) {
    const cc = (code ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc) || !(await this.db.one(`select 1 from public.countries where alpha2 = $1 and is_active and ${REAL_COUNTRY}`, [cc])))
      throw badRequest('COUNTRY_INVALID', 'Selecciona un país válido.');
    return cc;
  }

  /** Availability of up to 100 published products for one destination country. */
  async forProducts(countryCode: string, productIds: string[]): Promise<{ country: string; items: Record<string, Availability> }> {
    const country = await this.country(countryCode);
    const ids = [...new Set(productIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, MAX_AVAILABILITY_ITEMS);
    const items: Record<string, Availability> = {};
    if (!ids.length) return { country, items };
    const s = await this.settings.all();
    const geo = s['geo.delivery'] ?? { ipDetection: true, showSelector: true, countries: [] };
    const days = Math.min(Math.max(Number(geo.laneHistoryDays ?? 90) || 90, 1), 365);
    const liveRates = this.shippo.enabled && !!s['shipping.shippo_enabled'];
    const rows = await this.db.many<{
      id: string; seller_id: string; requires_shipping: boolean; origin: string | null;
      store_mode: RestrictionMode | null; store_countries: string[] | null; product_mode: RestrictionMode | null; product_countries: string[] | null; lane: boolean;
    }>(
      `select p.id, p.seller_id, p.requires_shipping,
              (select a.country_code from public.seller_ship_from_addresses a where a.seller_id = p.seller_id and a.status = 'ACTIVE'
                order by a.is_default desc, a.created_at limit 1) as origin,
              sr.mode as store_mode, sr.countries::text[] as store_countries, pr.mode as product_mode, pr.countries::text[] as product_countries,
              ($3 and exists (select 1 from public.shipping_quote_requests q
                         join public.shipping_rate_options o on o.quote_request_id = q.id and o.shipping_provider_code = 'SHIPPO'
                        where q.seller_id = p.seller_id and q.request_snapshot -> 'destination' ->> 'country' = $2
                          and q.created_at > now() - make_interval(days => $4))) as lane
         from public.products p
         left join public.destination_restrictions sr on sr.seller_id = p.seller_id and sr.product_id is null
         left join public.destination_restrictions pr on pr.product_id = p.id
        where p.id = any($1::uuid[]) and p.status = 'ACTIVE'`,
      [ids, country, liveRates, days],
    );
    const offered = (geo.countries ?? []).map((c: string) => c.toUpperCase());
    for (const r of rows)
      items[r.id] = evaluateRoute({
        destination: country,
        offered,
        requiresShipping: r.requires_shipping !== false,
        origin: r.origin,
        store: r.store_mode ? { mode: r.store_mode, countries: r.store_countries ?? [] } : null,
        product: r.product_mode ? { mode: r.product_mode, countries: r.product_countries ?? [] } : null,
        flatRates: s['shipping.rates'] ?? [],
        liveRates,
        knownLane: r.lane,
      });
    for (const id of ids) items[id] ??= { status: 'UNCONFIRMED', reason: 'NOT_FOUND', shipsFrom: null };
    return { country, items };
  }

  // ------------------------------------------------------------ store / product rules

  private async cleanCountries(list: unknown) {
    if (!Array.isArray(list) || list.length > 300) throw badRequest('COUNTRIES_INVALID', 'Lista de países inválida.');
    const out: string[] = [];
    for (const c of list) {
      const cc = await this.country(String(c));
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
