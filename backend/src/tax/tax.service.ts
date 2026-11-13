import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';
import { badRequest, notFound } from '../common/errors';
import { normalizeCountry } from '../common/geo';

export interface TaxRate {
  countryCode: string;
  taxName: string;
  rate: string; // decimal string, e.g. "0.18"
  appliesToShipping: boolean;
  isActive: boolean;
  notes: string | null;
  updatedAt?: string;
}

const ZERO = (country: string): TaxRate => ({ countryCode: country, taxName: 'Tax', rate: '0', appliesToShipping: false, isActive: false, notes: null });

/** Destination-country tax rates (public.marketplace_tax_rates). */
@Injectable()
export class TaxService {
  private cache?: { at: number; rows: Map<string, TaxRate> };

  constructor(private readonly db: DbService) {}

  private map(r: any): TaxRate {
    return {
      countryCode: r.country_code,
      taxName: r.tax_name,
      rate: String(Number(r.rate)),
      appliesToShipping: r.applies_to_shipping,
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

  async upsert(actorUserId: string, input: { countryCode: string; taxName: string; rate: number; appliesToShipping?: boolean; isActive?: boolean; notes?: string }) {
    const country = await normalizeCountry(this.db, input.countryCode);
    if (!(input.rate >= 0 && input.rate < 1)) throw badRequest('TAX_RATE_INVALID', 'La tasa debe estar entre 0 % y 99 %.');
    await this.db.exec(
      `insert into public.marketplace_tax_rates (country_code, tax_name, rate, applies_to_shipping, is_active, notes, updated_by_user_id)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (country_code) do update set tax_name = excluded.tax_name, rate = excluded.rate, applies_to_shipping = excluded.applies_to_shipping,
              is_active = excluded.is_active, notes = excluded.notes, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()`,
      [country, input.taxName.trim(), input.rate, !!input.appliesToShipping, input.isActive !== false, input.notes?.trim() || null, actorUserId],
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
