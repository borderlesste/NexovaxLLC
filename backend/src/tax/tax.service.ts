import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';
import { badRequest, notFound } from '../common/errors';
import { normalizeCountry } from '../common/geo';
import { normalizeTaxClass, TaxClass } from './tax-calc';

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
    const rows = await this.db.many(`select * from public.marketplace_tax_rates order by country_code`);
    return rows.map((r) => this.map(r));
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
    return this.list();
  }

  async remove(countryCode: string) {
    const n = await this.db.exec(`delete from public.marketplace_tax_rates where country_code = $1`, [countryCode.toUpperCase()]);
    if (!n) throw notFound('Impuesto');
    this.cache = undefined;
    return this.list();
  }
}
