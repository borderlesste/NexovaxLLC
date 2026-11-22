import { regionKey, TaxService } from '../src/tax/tax.service';
import { lineTax } from '../src/tax/tax-calc';

const country = { country_code: 'US', tax_name: 'Sales tax', rate: '0', applies_to_shipping: false, reduced_rate: null, prices_include_tax: false, calculation_provider: 'RATES', is_active: true, notes: null };
const regions = [
  { country_code: 'US', region_code: 'PA', region_name: 'Pennsylvania', tax_name: 'Sales tax', rate: '0.060000', reduced_rate: null, applies_to_shipping: false, is_active: true },
  { country_code: 'US', region_code: 'MN', region_name: 'Minnesota', tax_name: 'Sales tax', rate: '0.068750', reduced_rate: null, applies_to_shipping: true, is_active: true },
];

function service(countryRow: any = country) {
  const db: any = {
    many: async (sql: string) => (sql.includes('marketplace_tax_region_rates') ? regions : countryRow ? [countryRow] : []),
    one: async () => null,
  };
  return new TaxService(db);
}

describe('tax by state', () => {
  it('normalizes US states to their code', () => {
    expect(regionKey('US', 'Pennsylvania')).toBe('PA');
    expect(regionKey('US', 'pa')).toBe('PA');
    expect(regionKey('US', '')).toBeNull();
  });

  it('uses the state rate over the country rate', async () => {
    const t = await service().forDestination('US', 'PA');
    expect(t).toMatchObject({ rate: '0.06', regionCode: 'PA' });
    expect(lineTax(t, 'STANDARD', 10000n, 1, 0n).tax).toBe(600n);
    const mn = await service().forDestination('us', 'Minnesota');
    expect(mn).toMatchObject({ rate: '0.06875', appliesToShipping: true });
  });

  it('falls back to the country rate for states without an active row', async () => {
    const t = await service().forDestination('US', 'TX');
    expect(t.rate).toBe('0');
    expect(t.regionCode).toBeUndefined();
  });

  it('ignores states when the country is inactive or uses Stripe Tax', async () => {
    expect((await service(null).forDestination('US', 'PA')).rate).toBe('0');
    expect((await service({ ...country, calculation_provider: 'STRIPE_TAX' }).forDestination('US', 'PA')).regionCode).toBeUndefined();
  });
});
