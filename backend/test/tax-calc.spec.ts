import { excludeRate, lineTax, rateFor, shippingTax } from '../src/tax/tax-calc';
import type { TaxRate } from '../src/tax/tax.service';

const base: TaxRate = { countryCode: 'DO', taxName: 'ITBIS', rate: '0.18', reducedRate: '0.16', appliesToShipping: false, pricesIncludeTax: false, calculationProvider: 'RATES', isActive: true, notes: null };

describe('tax calculation', () => {
  it('adds the tax on top when prices exclude it', () => {
    const l = lineTax(base, 'STANDARD', 10000n, 2, 0n);
    expect(l).toMatchObject({ unit: 10000n, gross: 20000n, net: 20000n, tax: 3600n, rate: '0.18' });
  });

  it('applies reduced and exempt classes', () => {
    expect(lineTax(base, 'REDUCED', 10000n, 1, 0n).tax).toBe(1600n);
    expect(lineTax(base, 'EXEMPT', 10000n, 1, 0n).tax).toBe(0n);
    expect(rateFor({ ...base, reducedRate: null }, 'REDUCED')).toBe('0.18');
  });

  it('extracts the tax from inclusive prices and keeps the listed total exact', () => {
    const inc = { ...base, pricesIncludeTax: true };
    for (const [unit, qty, disc] of [[10000n, 1, 0n], [999n, 3, 0n], [11800n, 2, 1000n], [1n, 7, 0n], [12345n, 5, 333n]] as [bigint, number, bigint][]) {
      const l = lineTax(inc, 'STANDARD', unit, qty, disc);
      expect(l.net + l.tax).toBe(unit * BigInt(qty) - disc);
      expect(l.gross).toBe(l.unit * BigInt(qty));
      expect(l.net).toBe(l.gross - l.discount);
      expect(l.tax >= 0n && l.discount <= l.gross).toBe(true);
    }
    const l = lineTax(inc, 'STANDARD', 11800n, 1, 0n);
    expect(l).toMatchObject({ unit: 10000n, net: 10000n, tax: 1800n, included: true });
    expect(lineTax(inc, 'EXEMPT', 11800n, 1, 0n)).toMatchObject({ net: 11800n, tax: 0n });
  });

  it('taxes shipping only when the country says so', () => {
    expect(shippingTax(base, 699n)).toEqual({ amount: 699n, tax: 0n, rate: '0' });
    expect(shippingTax({ ...base, appliesToShipping: true }, 1000n)).toEqual({ amount: 1000n, tax: 180n, rate: '0.18' });
    expect(shippingTax({ ...base, appliesToShipping: true, pricesIncludeTax: true }, 1180n)).toEqual({ amount: 1000n, tax: 180n, rate: '0.18' });
  });

  it('rounds the exclusive part half-up', () => {
    expect(excludeRate(100n, '0.18')).toBe(85n); // 84.745...
    expect(excludeRate(100n, '0')).toBe(100n);
  });
});
