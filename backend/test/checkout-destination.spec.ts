jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
import { CheckoutService } from '../src/checkout/checkout.service';
import { SELLER_FREE_SHIPPING } from '../src/shipping/free-shipping';
import { ShippingService } from '../src/shipping/shipping.service';

// Checkout validates restrictions with the confirmed address country (NX-GEO-001 §5).
describe('checkout destination check', () => {
  const blocks = (CheckoutService.prototype as any).destinationBlocks;
  const groups = [
    { sellerId: 's1', items: [{ productId: 'p1', variantId: 'v1', purchasable: true }, { productId: 'p2', variantId: 'v2', purchasable: true }] },
    { sellerId: 's2', items: [{ productId: 'p3', variantId: 'v3', purchasable: true }, { productId: 'p4', variantId: 'v4', purchasable: false }] },
  ];
  const availability = {
    forItems: jest.fn(async (_c: string, _p: string[], ids: string[]) => ({
      items: {},
      variants: Object.fromEntries(ids.map((id) => [id, id === 'v2' ? { status: 'UNAVAILABLE', reason: 'STORE_EXCLUDED' } : { status: id === 'v3' ? 'UNCONFIRMED' : 'AVAILABLE', reason: 'X' }])),
    })),
  };

  it('blocks only confirmed restrictions, per cart variant, for the address country', async () => {
    const r: Map<string, string> = await blocks.call({ availability }, groups, 'DO');
    expect([...r.entries()]).toEqual([['v2', 'STORE_EXCLUDED']]);
    expect(availability.forItems).toHaveBeenCalledWith('DO', [], ['v1', 'v2', 'v3'], undefined);
  });

  it('without an address nothing is blocked yet', async () => {
    expect((await blocks.call({ availability }, groups, null)).size).toBe(0);
  });
});

describe('checkout address version', () => {
  const buyer = 'buyer';
  const address = {
    id: 'address', row_version: '100', country_code: 'US', region: 'FL', postal_code: '33101', city: 'Miami',
    line1: '10 Test Street', recipient_name: 'Test Buyer',
  };

  function checkout() {
    let storedAddress: typeof address | null = { ...address };
    let freeShipping: { product_id: string; country_codes: string[]; minimum_subtotal: string | null; currency_code: string } | null = null;
    let checkoutUnitPrice = '10.00';
    let beforeTx: (() => void) | undefined;
    const client = {};
    const db = {
      one: jest.fn(async (sql: string, _params?: unknown[], _client?: object) => {
        if (sql.includes('from public.addresses')) return storedAddress && { ...storedAddress };
        if (sql.includes('cs.idempotency_key')) return null;
        if (sql.includes('seller_ship_from_addresses')) return { id: 'origin', country_code: 'US' };
        return { id: 'checkout', currency_code: 'USD', amount: '15.00', cfg_id: 'config', acc_id: 'account' };
      }),
      many: jest.fn(async (sql: string) => {
        if (sql.includes('nx_product_free_shipping')) return freeShipping ? [freeShipping] : [];
        if (sql.includes('from public.checkout_items')) {
          return [{ id: 'item', seller_id: 'seller', variant_id: 'variant', product_id: 'product', quantity: 1, seller_group_id: 'seller-group', unit_price: checkoutUnitPrice }];
        }
        if (sql.includes('from public.cart_items')) return [{ seller_id: 'seller', variant_id: 'variant', qty: 1 }];
        if (sql.includes('from public.inventory_items')) return [{ id: 'stock', variant_id: 'variant', seller_id: 'seller', location_id: 'location', ship_from_address_id: 'origin', available: 2 }];
        return [];
      }),
      exec: jest.fn(async (_sql: string, _params: unknown[], _client: object) => 1),
      tx: jest.fn(async (run: (c: object) => Promise<string>) => { beforeTx?.(); return run(client); }),
    };
    const carts = {
      getCart: jest.fn(async () => ({
        id: 'cart', currency: 'USD',
        groups: [{ sellerId: 'seller', items: [{ productId: 'product', variantId: 'variant', quantity: 1, unitPrice: '10.00', purchasable: true }] }],
      })),
      ensureMutableCart: jest.fn(async () => ({ id: 'cart' })),
    };
    const tax = {
      forDestination: jest.fn(async (country?: string) => ({ countryCode: country, rate: '0', calculationProvider: 'RATES' })),
      classesFor: jest.fn(async () => new Map()),
    };
    const rateFor = (to: typeof address) => ({
      options: [{ code: 'FLAT:STANDARD', provider: 'FLAT', amount: to.postal_code === '33101' ? '5.00' : '9.00' }], liveRates: false, messages: [],
    });
    const shipping = { originFor: jest.fn(async () => ({})), options: jest.fn(async (_origin: unknown, to: typeof address) => rateFor(to)) };
    const availability = {
      forItems: jest.fn(async (country: string) => ({ items: {}, variants: { variant: { status: country === 'CA' ? 'UNAVAILABLE' : 'AVAILABLE', reason: 'STORE_EXCLUDED' } } })),
    };
    const payments = {
      providerFor: jest.fn(() => ({ code: 'STRIPE', environment: 'TEST' })), releaseAbandoned: jest.fn(), startProviderPayment: jest.fn(),
    };
    const svc = new CheckoutService(db as any, { get: jest.fn() } as any, carts as any, {} as any,
      tax as any, shipping as any, payments as any, { evaluate: async () => ({ errors: [], results: [] }), lockCodes: async () => undefined, guardAttempts: async () => undefined, recordFailures: async () => undefined } as any,
      {} as any, {} as any, availability as any);
    jest.spyOn(svc as any, 'calculate').mockResolvedValue(undefined);
    jest.spyOn(svc, 'resultFor').mockResolvedValue({ checkoutId: 'checkout' } as any);
    return {
      svc, db, shipping, availability, payments, rateFor, client,
      updateAddress: (next: typeof address | null) => { storedAddress = next; },
      enableFreeShipping: (minimum = '10.00') => { freeShipping = { product_id: 'product', country_codes: ['US'], minimum_subtotal: minimum, currency_code: 'USD' }; },
      changeInTransaction: (change: 'disable' | 'reprice' | 'destination') => { beforeTx = () => {
        if (change === 'disable') freeShipping = null;
        if (change === 'reprice') checkoutUnitPrice = '9.99';
        if (change === 'destination') availability.forItems.mockResolvedValueOnce({
          items: {}, variants: { variant: { status: 'UNAVAILABLE', reason: 'PRODUCT_EXCLUDED' } },
        });
      }; },
      quote: () => svc.quote(buyer, { addressId: address.id }),
      place: (addressVersion?: string | null, rate = 'FLAT:STANDARD') => svc.placeOrder(buyer, { addressId: address.id, addressVersion: addressVersion ?? undefined,
        shipping: { seller: rate }, paymentMethod: 'CARD', idempotencyKey: 'checkout-attempt' }),
    };
  }

  it('rejects an old or missing quote version before starting a new checkout', async () => {
    const f = checkout();
    const q = await f.quote();
    expect(q.addressVersion).toMatch(/^[0-9a-f]{64}$/);
    f.updateAddress({ ...address, row_version: '101', postal_code: '33010' });

    await expect(f.place(q.addressVersion)).rejects.toMatchObject({ code: 'CHECKOUT_ADDRESS_CHANGED' });
    await expect(f.place()).rejects.toMatchObject({ code: 'CHECKOUT_ADDRESS_CHANGED' });
    expect(f.db.tx).not.toHaveBeenCalled();
    expect(f.payments.releaseAbandoned).not.toHaveBeenCalled();

    const fresh = await f.quote();
    expect(fresh.addressVersion).not.toBe(q.addressVersion);
    expect(fresh.shipping).toBe('9.00');
    await expect(f.place(fresh.addressVersion)).resolves.toMatchObject({ checkoutId: 'checkout' });
    expect(f.shipping.options).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ postal_code: '33010' }), expect.anything(), 'USD', fresh.addressVersion);
    expect(f.db.one).toHaveBeenCalledWith(expect.stringContaining('for share of a'), [buyer, address.id], f.client);
    expect(f.db.exec).toHaveBeenCalledWith(expect.stringContaining('insert into public.checkout_address_snapshots'),
      expect.arrayContaining(['33010', 'US']), f.client);
    expect(f.db.exec).toHaveBeenCalledWith(expect.stringContaining('select_checkout_shipping_rate'),
      expect.arrayContaining(['9.00']), f.client);
    expect(f.payments.startProviderPayment).toHaveBeenCalledTimes(1);
  });

  it('refuses the order when the amount to charge is not the total the buyer accepted', async () => {
    const f = checkout();
    const q = await f.quote();
    await expect(f.svc.placeOrder(buyer, { addressId: address.id, addressVersion: q.addressVersion!, shipping: { seller: 'FLAT:STANDARD' },
      paymentMethod: 'CARD', idempotencyKey: 'checkout-total', quotedTotal: '12.00' })).rejects.toMatchObject({ code: 'CHECKOUT_TOTAL_CHANGED' });
    expect(f.payments.startProviderPayment).not.toHaveBeenCalled();
    await expect(f.svc.placeOrder(buyer, { addressId: address.id, addressVersion: q.addressVersion!, shipping: { seller: 'FLAT:STANDARD' },
      paymentMethod: 'CARD', idempotencyKey: 'checkout-total-2', quotedTotal: '15.00' })).resolves.toMatchObject({ checkoutId: 'checkout' });
  });

  it('free shipping is earned on the subtotal after the store coupon (quote and order)', async () => {
    const f = checkout();
    f.enableFreeShipping('10.00');
    const coupon = { code: 'TENOFF', codeId: 'c', sellerId: 'seller', ruleVersionId: 'v', ruleGroupId: 'g', discount: 100n, allocations: [{ key: 'variant', discount: 100n }] };
    (f.svc as any).coupons.evaluate = async (_codes: string[], lines: { key: string }[]) =>
      ({ errors: [], results: [{ ...coupon, allocations: [{ key: lines[0].key, discount: 100n }] }] });
    const q = await f.svc.quote(buyer, { addressId: address.id, coupons: ['TENOFF'] });
    expect(q.groups[0].shippingOptions.map((o: any) => o.code)).toEqual(['FLAT:STANDARD']);
    await expect(f.svc.placeOrder(buyer, { addressId: address.id, addressVersion: q.addressVersion!, shipping: { seller: SELLER_FREE_SHIPPING },
      paymentMethod: 'CARD', idempotencyKey: 'checkout-free-coupon', coupons: ['TENOFF'] })).rejects.toMatchObject({ code: 'SHIPPING_OPTION_UNAVAILABLE' });
  });

  it('serializes checkouts of one buyer and replays a key committed by a concurrent request', async () => {
    const f = checkout();
    const q = await f.quote();
    (f.db.one as jest.Mock).mockImplementation(async (sql: string): Promise<any> => {
      if (sql.includes('from public.addresses')) return { ...address };
      if (sql.includes('select cs.id from public.checkout_sessions cs where')) return { id: 'first-checkout' };
      if (sql.includes('cs.idempotency_key')) return null;
      return { id: 'x' };
    });
    await expect(f.place(q.addressVersion)).resolves.toMatchObject({ checkoutId: 'checkout' });
    expect(f.db.one).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), [buyer], f.client);
    expect(f.db.exec).not.toHaveBeenCalledWith(expect.stringContaining('create_checkout_from_cart'), expect.anything(), expect.anything());
    expect(f.payments.startProviderPayment).not.toHaveBeenCalled();
  });

  it('returns a previously created checkout on an idempotent retry without a version', async () => {
    const f = checkout();
    f.db.one.mockResolvedValueOnce({ id: 'previous', currency_code: 'USD', amount: '15.00', cfg_id: 'config', acc_id: 'account' });

    await expect(f.place()).resolves.toMatchObject({ checkoutId: 'checkout' });
    expect(f.svc.resultFor).toHaveBeenCalledWith('previous', buyer);
    expect(f.db.tx).not.toHaveBeenCalled();
    expect(f.payments.startProviderPayment).not.toHaveBeenCalled();
  });

  it('quotes and persists a free seller-paid rate without replacing paid alternatives', async () => {
    const f = checkout();
    f.enableFreeShipping();
    const q = await f.quote();
    expect(q.shipping).toBe('0.00');
    expect(q.groups[0]).toMatchObject({ selectedShipping: SELLER_FREE_SHIPPING });
    expect(q.groups[0].shippingOptions).toEqual([
      expect.objectContaining({ code: SELLER_FREE_SHIPPING, amount: '0.00', freeShipping: true }),
      expect.objectContaining({ code: 'FLAT:STANDARD', amount: '5.00' }),
    ]);
    await expect(f.place(q.addressVersion, SELLER_FREE_SHIPPING)).resolves.toMatchObject({ checkoutId: 'checkout' });
    expect(f.db.one).toHaveBeenCalledWith(expect.stringContaining('insert into public.shipping_rate_options'),
      expect.arrayContaining([SELLER_FREE_SHIPPING, 'MARKETPLACE', '0.00']), f.client);
    expect(f.db.exec).toHaveBeenCalledWith(expect.stringContaining('select_checkout_shipping_rate'),
      expect.arrayContaining(['0.00']), f.client);
  });

  it('allows the store to ship for free without a paid rate for the confirmed address', async () => {
    const f = checkout();
    f.enableFreeShipping();
    f.shipping.options.mockResolvedValue({ options: [], liveRates: false, messages: [] });

    const q = await f.quote();
    expect(q.groups[0]).toMatchObject({ selectedShipping: SELLER_FREE_SHIPPING, destinationBlocked: [] });
    expect(q.shipping).toBe('0.00');
    await expect(f.place(q.addressVersion, SELLER_FREE_SHIPPING)).resolves.toMatchObject({ checkoutId: 'checkout' });
    expect(f.db.exec).toHaveBeenCalledWith(expect.stringContaining('select_checkout_shipping_rate'),
      expect.arrayContaining(['0.00']), f.client);
  });

  it('still refuses free delivery below the minimum when there is no paid rate', async () => {
    const f = checkout();
    f.enableFreeShipping('10.01');
    f.shipping.options.mockResolvedValue({ options: [], liveRates: false, messages: [] });

    const q = await f.quote();
    expect(q.groups[0]).toMatchObject({ selectedShipping: null, shippingOptions: [] });
    await expect(f.place(q.addressVersion, SELLER_FREE_SHIPPING)).rejects.toMatchObject({ code: 'SHIPPING_OPTION_UNAVAILABLE' });
    expect(f.payments.startProviderPayment).not.toHaveBeenCalled();
  });

  it.each(['disable', 'reprice'] as const)('checks confirmed promotion eligibility after a concurrent %s', async (change) => {
    const f = checkout();
    f.enableFreeShipping();
    const q = await f.quote();
    f.changeInTransaction(change);
    await expect(f.place(q.addressVersion, SELLER_FREE_SHIPPING)).rejects.toMatchObject({ code: 'SHIPPING_OPTION_UNAVAILABLE' });
    expect(f.db.tx).toHaveBeenCalledTimes(1);
    expect(f.payments.startProviderPayment).not.toHaveBeenCalled();
  });

  it('suppresses the promotion for a confirmed destination restriction', async () => {
    const f = checkout();
    f.enableFreeShipping();
    f.availability.forItems.mockResolvedValueOnce({ items: {}, variants: { variant: { status: 'UNAVAILABLE', reason: 'STORE_EXCLUDED' } } });
    const q = await f.quote();
    expect(q.groups[0].shippingOptions.map((option: any) => option.code)).not.toContain(SELLER_FREE_SHIPPING);
  });

  it('rechecks destination restrictions in the transaction before accepting a free shipment', async () => {
    const f = checkout();
    f.enableFreeShipping();
    const q = await f.quote();
    f.changeInTransaction('destination');
    await expect(f.place(q.addressVersion, SELLER_FREE_SHIPPING)).rejects.toMatchObject({ code: 'DESTINATION_UNAVAILABLE' });
    expect(f.availability.forItems).toHaveBeenLastCalledWith('US', [], ['variant'], f.client);
    expect(f.payments.startProviderPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['postal code', { ...address, row_version: '101', postal_code: '33010' }],
    ['restricted country', { ...address, row_version: '101', country_code: 'CA' }],
    ['deletion', null],
  ])('requires a new quote when the address changes during the shipping call (%s)', async (_change, editedAddress) => {
    const f = checkout();
    const q = await f.quote();
    f.shipping.options.mockImplementationOnce(async (_origin, to) => {
      f.updateAddress(editedAddress);
      return f.rateFor(to);
    });

    await expect(f.place(q.addressVersion)).rejects.toMatchObject({ code: 'CHECKOUT_ADDRESS_CHANGED' });
    expect(f.db.tx).toHaveBeenCalledTimes(1);
    expect(f.db.exec).not.toHaveBeenCalled();
    expect(f.payments.startProviderPayment).not.toHaveBeenCalled();

    if (editedAddress?.country_code === 'CA') {
      const fresh = await f.quote();
      expect(fresh.groups[0].destinationBlocked).toEqual([{ productId: 'product', variantId: 'variant', reason: 'STORE_EXCLUDED' }]);
      await expect(f.place(fresh.addressVersion)).rejects.toMatchObject({ code: 'DESTINATION_UNAVAILABLE' });
      expect(f.db.tx).toHaveBeenCalledTimes(1);
    }
  });
});

it('reuses a live shipping rate only for the same version of the destination', async () => {
  const shipment = jest.fn()
    .mockResolvedValueOnce({ shipmentId: 'first', messages: [], rates: [{ object_id: 'rate-1', amount: '5.00', currency: 'USD', provider: 'USPS', servicelevel: { token: 'ground', name: 'Ground' } }] })
    .mockResolvedValueOnce({ shipmentId: 'second', messages: [], rates: [{ object_id: 'rate-2', amount: '5.00', currency: 'USD', provider: 'USPS', servicelevel: { token: 'ground', name: 'Ground' } }] });
  const settings = { get: async (key: string) => key === 'shipping.shippo_enabled' ? true : [] };
  const shipping = new ShippingService({ many: async () => [] } as any, settings as any, { enabled: true, testMode: false, shipment } as any);
  const origin = { id: 'origin', contact_name: 'Store', company_name: null, line1: '1 Test Street', line2: null, city: 'Miami', region: 'FL', postal_code: '33101', country_code: 'US', phone: null };
  const destination = { recipient_name: 'Test Buyer', line1: '10 Test Street', city: 'Miami', region: 'FL', postal_code: '33101', country_code: 'US', phone: '+13055550100' };
  const parcel = ShippingService.parcelFor([{ qty: 1 }]);

  const first = await shipping.options(origin, destination, parcel, 'USD', 'first-version');
  const repeated = await shipping.options(origin, destination, parcel, 'USD', 'first-version');
  const edited = await shipping.options(origin, { ...destination, phone: '+13055550101' }, parcel, 'USD', 'second-version');

  expect(first.options[0].providerRateId).toBe('rate-1');
  expect(repeated.options[0].providerRateId).toBe('rate-1');
  expect(edited.options[0].providerRateId).toBe('rate-2');
  expect(shipment).toHaveBeenCalledTimes(2);
  expect(shipment).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ phone: '+13055550101' }), expect.anything());
});
