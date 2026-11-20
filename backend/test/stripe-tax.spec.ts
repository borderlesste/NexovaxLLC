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
            create: async (p: any) => { created.push(p); return { id: 'taxcalc_1', shipping_cost: { amount_tax: 0 } }; },
            listLineItems: async function* () {
              yield { reference: 'item-1', amount_tax: 725 };
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
    ]);
    // Stripe rejects the shipping tax code on a line item: shipping goes in shipping_cost.
    expect(p.shipping_cost).toEqual({ amount: 699, tax_behavior: 'exclusive', tax_code: 'txcd_92010001' });
  });

  it('adds up the shipping of several sellers and splits its tax back', async () => {
    const created: any[] = [];
    const stripe: any = {
      enabled: true,
      api: {
        tax: {
          calculations: {
            create: async (p: any) => { created.push(p); return { id: 'taxcalc_2', shipping_cost: { amount_tax: 100 } }; },
            listLineItems: async function* () { yield { reference: 'item-1', amount_tax: 500 }; },
          },
        },
      },
    };
    const svc = new StripeTaxService({} as any, stripe);
    const r = await svc.calculate('USD', { country_code: 'US', region: 'TX', postal_code: '73301' }, [
      { reference: 'item-1', amount: 6000n },
      { reference: 'ship:a', amount: 300n, shipping: true },
      { reference: 'ship:b', amount: 700n, shipping: true },
    ]);
    expect(created[0].shipping_cost.amount).toBe(1000);
    expect(r.byRef.get('ship:a')).toBe(30n);
    expect(r.byRef.get('ship:b')).toBe(70n);
    expect(r.total).toBe(600n);
  });
});
