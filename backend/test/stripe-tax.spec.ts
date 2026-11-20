import { StripeTaxService, stateCode } from '../src/tax/stripe-tax.service';

describe('Stripe Tax', () => {
  it('normalizes US states', () => {
    expect(stateCode('US', 'California')).toBe('CA');
    expect(stateCode('US', 'ny')).toBe('NY');
    expect(stateCode('US', 'New York')).toBe('NY');
    expect(stateCode('US', '')).toBeUndefined();
  });

  it('maps lines to Stripe and reads the tax per reference', async () => {
    const created: any[] = [];
    const stripe: any = {
      enabled: true,
      api: {
        tax: {
          calculations: {
            create: async (p: any) => { created.push(p); return { id: 'taxcalc_1' }; },
            listLineItems: async function* () {
              yield { reference: 'item-1', amount_tax: 725 };
              yield { reference: 'ship:g1', amount_tax: 0 };
            },
          },
        },
      },
    };
    const svc = new StripeTaxService({} as any, stripe);
    const r = await svc.calculate('USD', { country_code: 'US', region: 'California', postal_code: '94105', city: 'San Francisco', line1: '1 Market St' }, [
      { reference: 'item-1', amount: 10000n, quantity: 2, taxClass: 'STANDARD' },
      { reference: 'ship:g1', amount: 699n, shipping: true },
      { reference: 'zero', amount: 0n },
    ]);
    expect(r.id).toBe('taxcalc_1');
    expect(r.byRef.get('item-1')).toBe(725n);
    expect(r.total).toBe(725n);
    const p = created[0];
    expect(p.customer_details.address).toMatchObject({ country: 'US', state: 'CA', postal_code: '94105' });
    expect(p.line_items).toEqual([
      { reference: 'item-1', amount: 10000, quantity: 2, tax_code: 'txcd_99999999', tax_behavior: 'exclusive' },
      { reference: 'ship:g1', amount: 699, quantity: 1, tax_code: 'txcd_92010001', tax_behavior: 'exclusive' },
    ]);
  });
});
