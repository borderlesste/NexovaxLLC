import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';
import { badRequest, notFound } from '../common/errors';
import { normalizeCountry } from '../common/geo';
import { normalizeTaxClass, TaxClass } from './tax-calc';
import { stateCode } from './stripe-tax.service';

export interface TaxRate {
  countryCode: string;
  taxName: string;
  rate: string; // decimal string, e.g. "0.18"
  appliesToShipping: boolean;
  /** Rate for the REDUCED tax class (null = standard rate). */
  reducedRate: string | null;
  /** Listed prices already include the tax for buyers in this country. */
  pricesIncludeTax: boolean;
  /** RATES = the configured rates; STRIPE_TAX = Stripe Tax calculates by exact address. */
  calculationProvider: 'RATES' | 'STRIPE_TAX';
  isActive: boolean;
  notes: string | null;
  updatedAt?: string;
  /** State / province whose rate replaced the country rate (null = country rate). */
  regionCode?: string | null;
}

export interface TaxRegionRate {
  countryCode: string;
  regionCode: string;
  regionName: string;
  taxName: string;
  rate: string;
  reducedRate: string | null;
  appliesToShipping: boolean;
  isActive: boolean;
  notes: string | null;
  updatedAt?: string;
}

/** Region key of an address: the state code (US "Florida" -> "FL"), else the stored value upper-cased. */
export function regionKey(country: string, region?: string | null): string | null {
  const v = stateCode(country, region);
  if (!v) return null;
  const k = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  return /^[A-Z0-9]{1,6}$/.test(k) ? k : null;
}

/** Plain decimal string (never exponent notation) for a numeric(7,6) rate. */
function rateString(v: unknown): string {
  const s = Number(v).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return s === '' || s === '-0' ? '0' : s;
}

const ZERO = (country: string): TaxRate => ({ countryCode: country, taxName: 'Tax', rate: '0', appliesToShipping: false, reducedRate: null, pricesIncludeTax: false, calculationProvider: 'RATES', isActive: false, notes: null });

/** Destination-country tax rates (public.marketplace_tax_rates). */
@Injectable()
export class TaxService {
  private cache?: { at: number; rows: Map<string, TaxRate> };
  private regionCache?: { at: number; rows: Map<string, any> };

  constructor(private readonly db: DbService) {}

  private map(r: any): TaxRate {
    return {
      countryCode: r.country_code,
      taxName: r.tax_name,
      rate: rateString(r.rate),
      appliesToShipping: r.applies_to_shipping,
      reducedRate: r.reduced_rate == null ? null : rateString(r.reduced_rate),
      // Stripe Tax computes tax on top of the price (US style), never tax-inclusive.
      pricesIncludeTax: !!r.prices_include_tax && r.calculation_provider !== 'STRIPE_TAX',
      calculationProvider: r.calculation_provider === 'STRIPE_TAX' ? 'STRIPE_TAX' : 'RATES',
      isActive: r.is_active,
      notes: r.notes,
      updatedAt: r.updated_at,
    };
  }

  async list(): Promise<TaxRate[]> {
    const rows = await this.db.many(
      `select t.*, (select count(*) from public.marketplace_tax_region_rates r where r.country_code = t.country_code)::int as region_count,
              (select count(*) from public.marketplace_tax_region_rates r where r.country_code = t.country_code and r.is_active)::int as region_active
         from public.marketplace_tax_rates t order by t.country_code`,
    );
    return rows.map((r) => ({ ...this.map(r), regionCount: r.region_count ?? 0, regionActive: r.region_active ?? 0 }));
  }

  /** Effective rate for a destination country (0 when none configured or inactive). */
  async forCountry(country: string | null | undefined, c?: Queryable): Promise<TaxRate> {
    const code = (country ?? '').toUpperCase();
    if (c) {
      const r = await this.db.one(`select * from public.marketplace_tax_rates where country_code = $1 and is_active`, [code], c);
      return r ? this.map(r) : ZERO(code);
    }
    if (!this.cache || Date.now() - this.cache.at > 60_000) {
      const rows = await this.db.many(`select * from public.marketplace_tax_rates where is_active`);
      this.cache = { at: Date.now(), rows: new Map(rows.map((r) => [r.country_code, this.map(r)])) };
    }
    return this.cache.rows.get(code) ?? ZERO(code);
  }

  /**
   * Effective rate for a shipping address: the country rate, replaced by the active rate of the
   * address's state / province when one exists (e.g. US sales tax by state). Regions never apply
   * when the country is inactive or calculated by Stripe Tax.
   */
  async forDestination(country: string | null | undefined, region: string | null | undefined, c?: Queryable): Promise<TaxRate> {
    const base = await this.forCountry(country, c);
    if (!base.isActive || base.calculationProvider === 'STRIPE_TAX') return base;
    const rc = regionKey(base.countryCode, region);
    const name = (region ?? '').trim().toLowerCase();
    if (!rc && !name) return base;
    let r: any;
    if (c) {
      r = await this.db.one(
        `select * from public.marketplace_tax_region_rates where country_code = $1 and is_active and (region_code = $2 or lower(region_name) = $3) order by (region_code = $2) desc limit 1`,
        [base.countryCode, rc, name],
        c,
      );
    } else {
      if (!this.regionCache || Date.now() - this.regionCache.at > 60_000) {
        const rows = await this.db.many(`select * from public.marketplace_tax_region_rates where is_active`);
        const m = new Map<string, any>();
        for (const x of rows) {
          m.set(`${x.country_code}|name:${String(x.region_name).toLowerCase()}`, x);
          m.set(`${x.country_code}|${x.region_code}`, x);
        }
        this.regionCache = { at: Date.now(), rows: m };
      }
      r = (rc && this.regionCache.rows.get(`${base.countryCode}|${rc}`)) || (name && this.regionCache.rows.get(`${base.countryCode}|name:${name}`));
    }
    if (!r) return base;
    return {
      ...base,
      taxName: r.tax_name,
      rate: rateString(r.rate),
      reducedRate: r.reduced_rate == null ? null : rateString(r.reduced_rate),
      appliesToShipping: r.applies_to_shipping,
      regionCode: r.region_code,
    };
  }

  private mapRegion(r: any): TaxRegionRate {
    return {
      countryCode: r.country_code,
      regionCode: r.region_code,
      regionName: r.region_name,
      taxName: r.tax_name,
      rate: rateString(r.rate),
      reducedRate: r.reduced_rate == null ? null : rateString(r.reduced_rate),
      appliesToShipping: r.applies_to_shipping,
      isActive: r.is_active,
      notes: r.notes,
      updatedAt: r.updated_at,
    };
  }

  async listRegions(countryCode: string): Promise<TaxRegionRate[]> {
    const rows = await this.db.many(`select * from public.marketplace_tax_region_rates where country_code = $1 order by region_name`, [countryCode.toUpperCase()]);
    return rows.map((r) => this.mapRegion(r));
  }

  async upsertRegion(actorUserId: string, input: { countryCode: string; regionCode: string; regionName?: string; taxName: string; rate: number; reducedRate?: number | null; appliesToShipping?: boolean; isActive?: boolean; notes?: string }) {
    const country = await normalizeCountry(this.db, input.countryCode);
    const exists = await this.db.one(`select 1 from public.marketplace_tax_rates where country_code = $1`, [country]);
    if (!exists) throw badRequest('TAX_COUNTRY_REQUIRED', 'Configura primero el impuesto del país.');
    const code = input.regionCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(code)) throw badRequest('TAX_REGION_INVALID', 'Código de estado o provincia inválido.');
    if (!(input.rate >= 0 && input.rate < 1)) throw badRequest('TAX_RATE_INVALID', 'La tasa debe estar entre 0 % y 99 %.');
    const reduced = input.reducedRate == null ? null : input.reducedRate;
    if (reduced != null && !(reduced >= 0 && reduced <= input.rate))
      throw badRequest('TAX_REDUCED_RATE_INVALID', 'La tasa reducida debe estar entre 0 % y la tasa general.');
    // Region name: given, else the geo reference (geo_regions), else the code.
    const geo = await this.db.one(`select name from public.geo_regions where country_code = $1 and (short_code = $2 or code = $2) limit 1`, [country, code]);
    const regionName = input.regionName?.trim() || geo?.name || code;
    await this.db.exec(
      `insert into public.marketplace_tax_region_rates (country_code, region_code, region_name, tax_name, rate, reduced_rate, applies_to_shipping, is_active, notes, updated_by_user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (country_code, region_code) do update set region_name = excluded.region_name, tax_name = excluded.tax_name, rate = excluded.rate,
              reduced_rate = excluded.reduced_rate, applies_to_shipping = excluded.applies_to_shipping, is_active = excluded.is_active,
              notes = excluded.notes, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()`,
      [country, code, regionName, input.taxName.trim(), input.rate, reduced, !!input.appliesToShipping, input.isActive !== false, input.notes?.trim() || null, actorUserId],
    );
    this.regionCache = undefined;
    return this.listRegions(country);
  }

  async removeRegion(countryCode: string, regionCode: string) {
    const n = await this.db.exec(`delete from public.marketplace_tax_region_rates where country_code = $1 and region_code = $2`, [countryCode.toUpperCase(), regionCode.toUpperCase()]);
    if (!n) throw notFound('Impuesto');
    this.regionCache = undefined;
    return this.listRegions(countryCode);
  }

  /** Effective tax class per product: the product's own class, else its category's, else STANDARD. */
  async classesFor(productIds: string[], c?: Queryable): Promise<Map<string, TaxClass>> {
    const ids = [...new Set(productIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const rows = await this.db.many(
      `select p.id, coalesce(p.tax_class, cat.tax_class, 'STANDARD') as cls
         from public.products p left join public.categories cat on cat.id = p.category_id where p.id = any($1::uuid[])`,
      [ids],
      c,
    );
    return new Map(rows.map((r) => [r.id, normalizeTaxClass(r.cls)]));
  }

  async upsert(actorUserId: string, input: { countryCode: string; taxName: string; rate: number; reducedRate?: number | null; appliesToShipping?: boolean; pricesIncludeTax?: boolean; calculationProvider?: 'RATES' | 'STRIPE_TAX'; isActive?: boolean; notes?: string }) {
    const country = await normalizeCountry(this.db, input.countryCode);
    if (!(input.rate >= 0 && input.rate < 1)) throw badRequest('TAX_RATE_INVALID', 'La tasa debe estar entre 0 % y 99 %.');
    const reduced = input.reducedRate == null ? null : input.reducedRate;
    if (reduced != null && !(reduced >= 0 && reduced <= input.rate))
      throw badRequest('TAX_REDUCED_RATE_INVALID', 'La tasa reducida debe estar entre 0 % y la tasa general.');
    await this.db.exec(
      `insert into public.marketplace_tax_rates (country_code, tax_name, rate, applies_to_shipping, is_active, notes, updated_by_user_id, reduced_rate, prices_include_tax, calculation_provider)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (country_code) do update set tax_name = excluded.tax_name, rate = excluded.rate, applies_to_shipping = excluded.applies_to_shipping,
              is_active = excluded.is_active, notes = excluded.notes, updated_by_user_id = excluded.updated_by_user_id, updated_at = now(),
              reduced_rate = excluded.reduced_rate, prices_include_tax = excluded.prices_include_tax, calculation_provider = excluded.calculation_provider`,
      [country, input.taxName.trim(), input.rate, !!input.appliesToShipping, input.isActive !== false, input.notes?.trim() || null, actorUserId, reduced, !!input.pricesIncludeTax, input.calculationProvider === 'STRIPE_TAX' ? 'STRIPE_TAX' : 'RATES'],
    );
    this.cache = undefined;
    this.regionCache = undefined;
    return this.list();
  }

  async remove(countryCode: string) {
    const n = await this.db.exec(`delete from public.marketplace_tax_rates where country_code = $1`, [countryCode.toUpperCase()]);
    if (!n) throw notFound('Impuesto');
    this.cache = undefined;
    return this.list();
  }
}
