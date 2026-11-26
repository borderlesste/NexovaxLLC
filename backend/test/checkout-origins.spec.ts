jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
import { CheckoutService } from '../src/checkout/checkout.service';
import { SELLER_FREE_SHIPPING } from '../src/shipping/free-shipping';

// Audit 2026-11-23: the shipping price is quoted per physical origin.
describe('checkout: physical origins', () => {
  const groupOptions = (CheckoutService.prototype as any).groupOptions;
  const originPlan = (CheckoutService.prototype as any).originPlan;
  const dims = [
    { seller_id: 's1', variant_id: 'v1', qty: 3, weight_value: 1, weight_unit: 'kg' },
    { seller_id: 's1', variant_id: 'v2', qty: 1, weight_value: 1, weight_unit: 'kg' },
  ];
  const stock = [
    { variant_id: 'v1', seller_id: 's1', available: 2, ship_from_address_id: 'A' },
    { variant_id: 'v1', seller_id: 's1', available: 5, ship_from_address_id: 'B' },
    { variant_id: 'v2', seller_id: 's1', available: 4, ship_from_address_id: 'A' },
  ];
  const opt = (code: string, amount: string, days = 3) => ({ code, provider: 'MARKETPLACE', amount, estimatedDays: days, description: '' });
  const ctx = (rates: Record<string, any[]>, policies: unknown[] = []) => {
    const db = {
      many: async (sql: string) => sql.includes('nx_seller_free_shipping') ? policies : sql.includes('inventory_items') ? stock : dims,
      one: async (_sql: string, p: any[]) => ({ id: p[0], country_code: 'US' }),
    };
    const shipping = { originFor: jest.fn(async () => ({ id: 'A', country_code: 'US' })), options: jest.fn(async (o: any) => ({ options: rates[o.id], messages: [], liveRates: false })) };
    const self: any = { db, shipping };
    self.originPlan = originPlan.bind(self);
    return self;
  };
  const groups = [{ sellerId: 's1', items: [
    { variantId: 'v1', purchasable: true, quantity: 3, unitPrice: '10.00' },
    { variantId: 'v2', purchasable: true, quantity: 1, unitPrice: '15.00' },
    { variantId: 'v3', purchasable: false, quantity: 1, unitPrice: '100.00' },
  ] }];

  it('splits lines by the warehouse that will ship them (same priority as the order)', async () => {
    const plan: Map<string, Map<string, any[]>> = await ctx({}).originPlan(dims);
    const s1 = plan.get('s1')!;
    expect([...s1.keys()].sort()).toEqual(['A', 'B']);
    expect(s1.get('A')!.map((l) => [l.variant_id, l.qty])).toEqual([['v1', 2], ['v2', 1]]);
    expect(s1.get('B')!.map((l) => [l.variant_id, l.qty])).toEqual([['v1', 1]]);
  });

  it('several origins: only methods every origin can ship, priced as the sum', async () => {
    const self = ctx({ A: [opt('FLAT:STD', '6.99'), opt('FLAT:EXP', '14.99', 1)], B: [opt('FLAT:STD', '8.00', 5)] });
    const out = await groupOptions.call(self, 'cart', groups, { country_code: 'US' }, 'USD');
    const r = out.get('s1');
    expect(r.options.map((o: any) => [o.code, o.amount, o.estimatedDays])).toEqual([['FLAT:STD', '14.99', 5]]);
    expect(r.origins.map((o: any) => o.id).sort()).toEqual(['A', 'B']);
  });

  it('no common method: nothing to choose, with a message', async () => {
    const self = ctx({ A: [opt('FLAT:EXP', '14.99')], B: [opt('FLAT:STD', '8.00')] });
    const r = (await groupOptions.call(self, 'cart', groups, { country_code: 'US' }, 'USD')).get('s1');
    expect(r.options).toEqual([]);
    expect(r.messages.join(' ')).toContain('varios almacenes');
  });

  const policy = { seller_id: 's1', country_codes: ['US'], minimum_subtotal: '45.00', currency_code: 'USD' };

  it('offers one free seller-arranged option across origins with different delivery methods', async () => {
    const self = ctx({ A: [opt('FLAT:STD', '6.99')], B: [opt('FLAT:EXP', '8.00')] }, [policy]);
    const r = (await groupOptions.call(self, 'cart', groups, { country_code: 'US' }, 'USD')).get('s1');
    expect(r.options).toEqual([expect.objectContaining({ code: SELLER_FREE_SHIPPING, amount: '0.00', provider: 'MARKETPLACE' })]);
    expect(r.origins.map((o: any) => o.options[0].serviceToken)).toEqual([SELLER_FREE_SHIPPING, SELLER_FREE_SHIPPING]);
  });

  it.each([
    ['pickup only at one origin', ['US'], 'USD', '45.00', 'PICKUP'],
    ['country outside the promotion', ['CA'], 'USD', '45.00', 'FLAT:STD'],
    ['policy in an old currency', ['US'], 'CAD', '45.00', 'FLAT:STD'],
    ['subtotal below the minimum, even with an unavailable line', ['US'], 'USD', '45.01', 'FLAT:STD'],
  ])('keeps the promotion hidden for %s', async (_case, countries, policyCurrency, minimum, method) => {
    const self = ctx({ A: [opt('FLAT:STD', '6.99')], B: [opt(method as string, '8.00')] }, [
      { ...policy, country_codes: countries, minimum_subtotal: minimum, currency_code: policyCurrency },
    ]);
    const r = (await groupOptions.call(self, 'cart', groups, { country_code: 'US' }, 'USD')).get('s1');
    expect(r.options.map((o: any) => o.code)).not.toContain(SELLER_FREE_SHIPPING);
  });
});
