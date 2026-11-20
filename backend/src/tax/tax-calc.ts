import { applyRate, Minor } from '../common/money';
import type { TaxRate } from './tax.service';

export type TaxClass = 'STANDARD' | 'REDUCED' | 'EXEMPT';
export const TAX_CLASSES: TaxClass[] = ['STANDARD', 'REDUCED', 'EXEMPT'];

export function normalizeTaxClass(v: unknown): TaxClass {
  return v === 'REDUCED' || v === 'EXEMPT' ? v : 'STANDARD';
}

/** Rate of a tax class in a country: reduced falls back to the standard rate when not configured. */
export function rateFor(tax: TaxRate, cls: TaxClass): string {
  if (cls === 'EXEMPT') return '0';
  if (cls === 'REDUCED') return tax.reducedRate ?? tax.rate;
  return tax.rate;
}

/** ROUND_HALF_UP(amount / (1 + rate)): the tax-exclusive part of a tax-inclusive amount. */
export function excludeRate(amount: Minor, rate: string): Minor {
  const [i, f = ''] = String(rate).split('.');
  const scale = 10n ** BigInt(f.length);
  const rateScaled = BigInt(i || '0') * scale + BigInt(f || '0');
  if (rateScaled === 0n) return amount;
  const den = scale + rateScaled;
  const num = amount * scale;
  const q = num / den;
  const rem = num % den;
  return rem * 2n >= den ? q + 1n : q;
}

export interface LineTax {
  /** Tax-exclusive unit price stored on the snapshot. */
  unit: Minor;
  gross: Minor;
  discount: Minor;
  net: Minor;
  tax: Minor;
  rate: string;
  taxClass: TaxClass;
  included: boolean;
}

/**
 * Tax of one product line. `unitListed` and `discountListed` are the amounts the buyer sees.
 * Exclusive countries add the tax on top of the net. Inclusive countries (prices already contain
 * the tax) extract it: the stored amounts become tax-exclusive and the tax is whatever makes the
 * buyer pay exactly the listed price, so net + tax always equals the listed line total.
 */
export function lineTax(tax: TaxRate, cls: TaxClass, unitListed: Minor, quantity: number, discountListed: Minor): LineTax {
  const rate = rateFor(tax, cls);
  const q = BigInt(quantity);
  if (!tax.pricesIncludeTax || rate === '0') {
    const gross = unitListed * q;
    const net = gross - discountListed;
    return { unit: unitListed, gross, discount: discountListed, net, tax: applyRate(net, rate), rate, taxClass: cls, included: tax.pricesIncludeTax };
  }
  const unit = excludeRate(unitListed, rate);
  const gross = unit * q;
  let discount = excludeRate(discountListed, rate);
  if (discount > gross) discount = gross;
  const net = gross - discount;
  const paid = unitListed * q - discountListed;
  const t = paid - net;
  return { unit, gross, discount, net, tax: t > 0n ? t : 0n, rate, taxClass: cls, included: true };
}

/** Shipping charge split into its tax-exclusive amount and its tax (standard rate). */
export function shippingTax(tax: TaxRate, chargeListed: Minor): { amount: Minor; tax: Minor; rate: string } {
  if (!tax.appliesToShipping || chargeListed <= 0n || Number(tax.rate) === 0) return { amount: chargeListed, tax: 0n, rate: tax.appliesToShipping ? tax.rate : '0' };
  if (tax.pricesIncludeTax) {
    const amount = excludeRate(chargeListed, tax.rate);
    return { amount, tax: chargeListed - amount, rate: tax.rate };
  }
  return { amount: chargeListed, tax: applyRate(chargeListed, tax.rate), rate: tax.rate };
}
