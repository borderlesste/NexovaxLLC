import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AppError } from '../common/errors';
import { fromMinor, Minor, toMinor } from '../common/money';
import { fromStripeAmount, StripeService, toStripeAmount } from '../payments/stripe.service';
import type { TaxClass } from './tax-calc';

export interface StripeTaxLine {
  /** Unique per calculation: checkout item id, variant id or `ship:<group>`. */
  reference: string;
  /** Tax-exclusive amount of the line (after discounts). */
  amount: Minor;
  quantity?: number;
  taxClass?: TaxClass;
  shipping?: boolean;
}

export interface StripeTaxAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country_code: string;
}

/** Stripe tax codes: general tangible goods, nontaxable, shipping. */
const TAX_CODE: Record<TaxClass | 'SHIPPING', string> = {
  STANDARD: 'txcd_99999999',
  REDUCED: 'txcd_99999999',
  EXEMPT: 'txcd_00000000',
  SHIPPING: 'txcd_92010001',
};

const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR',
};

export function stateCode(country: string, region?: string | null) {
  const r = (region ?? '').trim();
  if (!r) return undefined;
  if (country === 'US') {
    if (/^[A-Za-z]{2}$/.test(r)) return r.toUpperCase();
    return US_STATES[r.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()] ?? r;
  }
  return r;
}

/**
 * Stripe Tax: exact sales tax by address for the countries set to STRIPE_TAX (meant for the US).
 * Stripe only charges tax where the platform added a registration in its dashboard; elsewhere the
 * calculation returns 0. Paid orders are recorded as Stripe tax transactions for the filing
 * reports, and completed refunds as reversals.
 */
@Injectable()
export class StripeTaxService {
  private readonly logger = new Logger(StripeTaxService.name);
  private cache = new Map<string, { at: number; value: { id: string | null; byRef: Map<string, Minor>; total: Minor } }>();

  constructor(
    private readonly db: DbService,
    private readonly stripe: StripeService,
  ) {}

  async calculate(currency: string, address: StripeTaxAddress, lines: StripeTaxLine[], opts: { cache?: boolean } = {}) {
    if (!this.stripe.enabled) throw new AppError('TAX_UNAVAILABLE', 'No pudimos calcular los impuestos. Inténtalo de nuevo en unos minutos.', HttpStatus.SERVICE_UNAVAILABLE);
    const country = address.country_code.toUpperCase();
    // Stripe only taxes shipping through `shipping_cost` (one amount per calculation); a line item with
    // the shipping tax code is rejected. Multi-seller carts add up their shipping and the tax is split back.
    const shipLines = lines.filter((l) => l.shipping && l.amount > 0n);
    const shipTotal = shipLines.reduce((a, l) => a + l.amount, 0n);
    const items = lines
      .filter((l) => !l.shipping && l.amount > 0n)
      .map((l) => ({
        reference: l.reference.slice(0, 200),
        amount: toStripeAmount(fromMinor(l.amount), currency),
        quantity: l.quantity && l.quantity > 0 ? l.quantity : 1,
        tax_code: TAX_CODE[l.taxClass ?? 'STANDARD'],
        tax_behavior: 'exclusive' as const,
      }));
    if (!items.length) return { id: null as string | null, byRef: new Map<string, Minor>(), total: 0n };
    const params = {
      currency: currency.toLowerCase(),
      customer_details: {
        address: {
          country,
          postal_code: address.postal_code?.trim() || undefined,
          state: stateCode(country, address.region),
          city: address.city?.trim() || undefined,
          line1: address.line1?.trim() || undefined,
          line2: address.line2?.trim() || undefined,
        },
        address_source: 'shipping' as const,
      },
      line_items: items,
      ...(shipTotal > 0n
        ? { shipping_cost: { amount: toStripeAmount(fromMinor(shipTotal), currency), tax_behavior: 'exclusive' as const, tax_code: TAX_CODE.SHIPPING } }
        : {}),
    };
    // The per-seller shipping split is part of the result, so it is part of the key too.
    const key = createHash('sha256').update(JSON.stringify([params, shipLines.map((l) => [l.reference, l.amount.toString()])])).digest('hex');
    const hit = opts.cache ? this.cache.get(key) : undefined;
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
    try {
      const calc = await this.stripe.api.tax.calculations.create(params);
      const byRef = new Map<string, Minor>();
      let total = 0n;
      for await (const li of this.stripe.api.tax.calculations.listLineItems(calc.id!, { limit: 100 })) {
        const t = toMinor(fromStripeAmount(li.amount_tax, currency));
        if (li.reference) byRef.set(li.reference, t);
        total += t;
      }
      const shipTax = toMinor(fromStripeAmount(calc.shipping_cost?.amount_tax ?? 0, currency));
      let left = shipTax;
      shipLines.forEach((l, i) => {
        const t = i === shipLines.length - 1 ? left : (shipTax * l.amount) / shipTotal;
        left -= t;
        byRef.set(l.reference, (byRef.get(l.reference) ?? 0n) + t);
      });
      total += shipTax;
      const value = { id: calc.id as string | null, byRef, total };
      if (opts.cache) {
        if (this.cache.size > 500) this.cache.clear();
        this.cache.set(key, { at: Date.now(), value });
      }
      return value;
    } catch (e: any) {
      this.logger.warn(`Stripe Tax calculation failed: ${e?.message}`);
      if (e?.code === 'customer_tax_location_invalid')
        throw new AppError('TAX_ADDRESS_INVALID', 'No pudimos validar la dirección para calcular los impuestos. Revisa el código postal y el estado.', HttpStatus.BAD_REQUEST);
      throw new AppError('TAX_UNAVAILABLE', 'No pudimos calcular los impuestos. Inténtalo de nuevo en unos minutos.', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /** Fire-and-forget after an order is paid; the hourly job retries what fails. */
  fire(orderId: string) {
    this.recordOrder(orderId).catch((e) => this.logger.warn(`Stripe Tax transaction for ${orderId}: ${e?.message}`));
  }

  /** Fire-and-forget right after a refund completes: reverses its tax in Stripe; the hourly job retries what fails. */
  fireRefunds(orderId: string) {
    if (!this.stripe.enabled) return;
    this.reverseRefunds(orderId).catch((e) => this.logger.warn(`Stripe Tax reversal for ${orderId}: ${e?.message}`));
  }

  /** Records the Stripe tax transaction of a paid order taxed by Stripe Tax (idempotent). */
  async recordOrder(orderId: string) {
    const o = await this.db.one(
      `select o.id, o.public_number, o.payment_status, ofs.calculation_breakdown->'tax'->>'stripeCalculationId' as calc,
              t.status, t.transaction_id,
              (select p.environment from public.payments p where p.order_id = o.id order by p.created_at desc limit 1) as environment
         from public.orders o join public.order_financial_snapshots ofs on ofs.order_id = o.id
         left join public.stripe_tax_transactions t on t.order_id = o.id
        where o.id = $1`,
      [orderId],
    );
    if (!o?.calc || !this.stripe.enabled) return null;
    // Calculations belong to the Stripe mode they were made in: a test-mode order can't be recorded with the live key.
    if ((o.environment ?? 'TEST') !== this.stripe.environment) return null;
    if (o.status === 'RECORDED') return o.transaction_id;
    if (!['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED'].includes(o.payment_status)) return null;
    await this.db.exec(
      `insert into public.stripe_tax_transactions (order_id, calculation_id) values ($1,$2) on conflict (order_id) do nothing`,
      [orderId, o.calc],
    );
    try {
      const tx = await this.stripe.api.tax.transactions.createFromCalculation(
        { calculation: o.calc, reference: `order-${o.public_number}`, metadata: { order_id: orderId } },
        { idempotencyKey: `nx-taxtx-${orderId}` },
      );
      await this.db.exec(
        `update public.stripe_tax_transactions set status = 'RECORDED', transaction_id = $2, attempts = attempts + 1, last_error = null, updated_at = now() where order_id = $1`,
        [orderId, tx.id],
      );
      return tx.id;
    } catch (e: any) {
      await this.db.exec(
        `update public.stripe_tax_transactions set attempts = attempts + 1, last_error = $2, status = case when attempts + 1 >= 20 then 'FAILED' else status end, updated_at = now()
          where order_id = $1`,
        [orderId, String(e?.message ?? e).slice(0, 500)],
      );
      throw e;
    }
  }

  /** Reverses completed refunds of recorded orders (full when the whole order was refunded). */
  async reverseRefunds(orderId: string) {
    const t = await this.db.one(`select transaction_id, reversed_refund_ids from public.stripe_tax_transactions where order_id = $1 and status = 'RECORDED'`, [orderId]);
    if (!t?.transaction_id) return 0;
    const refunds = await this.db.many(
      `select r.id, r.public_number, r.refund_amount::text as amount, r.currency_code,
              (select ofs.grand_total from public.order_financial_snapshots ofs where ofs.order_id = r.order_id)::text as order_total,
              (select coalesce(sum(x.refund_amount),0) from public.refunds x where x.order_id = r.order_id and x.status = 'COMPLETED')::text as refunded_total
         from public.refunds r where r.order_id = $1 and r.status = 'COMPLETED' and not (r.id = any($2::uuid[])) order by r.completed_at nulls last, r.created_at`,
      [orderId, t.reversed_refund_ids ?? []],
    );
    let n = 0;
    for (const r of refunds) {
      const full = toMinor(r.refunded_total) >= toMinor(r.order_total) && (t.reversed_refund_ids ?? []).length === 0 && refunds.length === 1;
      await this.stripe.api.tax.transactions.createReversal(
        full
          ? { mode: 'full', original_transaction: t.transaction_id, reference: `refund-${r.public_number}` }
          : { mode: 'partial', original_transaction: t.transaction_id, reference: `refund-${r.public_number}`, flat_amount: -toStripeAmount(r.amount, r.currency_code) },
        { idempotencyKey: `nx-taxrev-${r.id}` },
      );
      await this.db.exec(`update public.stripe_tax_transactions set reversed_refund_ids = array_append(reversed_refund_ids, $2::uuid), updated_at = now() where order_id = $1`, [orderId, r.id]);
      n++;
    }
    return n;
  }

  /** Periodic retry: pending transactions and refunds not yet reversed. */
  async sync(limit = 50) {
    if (!this.stripe.enabled) return 0;
    const rows = await this.db.many(
      `select o.id from public.orders o join public.order_financial_snapshots ofs on ofs.order_id = o.id
         left join public.stripe_tax_transactions t on t.order_id = o.id
        where ofs.calculation_breakdown->'tax'->>'stripeCalculationId' is not null
          and o.payment_status in ('PAID','PARTIALLY_REFUNDED','REFUNDED','DISPUTED')
          and coalesce((select p.environment from public.payments p where p.order_id = o.id order by p.created_at desc limit 1), 'TEST') = $2
          and (t.order_id is null or t.status = 'PENDING'
               or (t.status = 'RECORDED' and exists (select 1 from public.refunds r where r.order_id = o.id and r.status = 'COMPLETED' and not (r.id = any(t.reversed_refund_ids)))))
        order by o.placed_at limit $1`,
      [limit, this.stripe.environment],
    );
    let n = 0;
    for (const r of rows) {
      try {
        await this.recordOrder(r.id);
        n += await this.reverseRefunds(r.id);
      } catch (e: any) {
        this.logger.warn(`Stripe Tax sync ${r.id}: ${e?.message}`);
      }
    }
    return n;
  }
}
