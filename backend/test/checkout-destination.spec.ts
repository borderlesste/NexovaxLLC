jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
import { CheckoutService } from '../src/checkout/checkout.service';
import { ShippingService } from '../src/shipping/shipping.service';

// Checkout validates restrictions with the confirmed address country (NX-GEO-001 §5).
describe('checkout destination check', () => {
  const blocks = (CheckoutService.prototype as any).destinationBlocks;
  const groups = [
    { sellerId: 's1', items: [{ productId: 'p1', purchasable: true }, { productId: 'p2', purchasable: true }] },
    { sellerId: 's2', items: [{ productId: 'p3', purchasable: true }, { productId: 'p4', purchasable: false }] },
  ];
  const availability = {
    forProducts: jest.fn(async (_c: string, ids: string[]) => ({
      items: Object.fromEntries(ids.map((id) => [id, id === 'p2' ? { status: 'UNAVAILABLE', reason: 'STORE_EXCLUDED' } : { status: id === 'p3' ? 'UNCONFIRMED' : 'AVAILABLE', reason: 'X' }])),
    })),
  };

  it('blocks only confirmed restrictions, per shipping group, for the address country', async () => {
    const r: Map<string, string> = await blocks.call({ availability }, groups, 'DO');
    expect([...r.entries()]).toEqual([['p2', 'STORE_EXCLUDED']]);
    expect(availability.forProducts).toHaveBeenCalledWith('DO', ['p1', 'p2', 'p3']);
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
    const client = {};
    const db = {
      one: jest.fn(async (sql: string, _params?: unknown[], _client?: object) => {
        if (sql.includes('from public.addresses')) return storedAddress && { ...storedAddress };
        if (sql.includes('cs.idempotency_key')) return null;
        return { id: 'checkout', currency_code: 'USD', amount: '15.00', cfg_id: 'config', acc_id: 'account' };
      }),
      many: jest.fn(async (sql: string) => {
        if (sql.includes('from public.checkout_items')) {
          return [{ id: 'item', seller_id: 'seller', variant_id: 'variant', product_id: 'product', quantity: 1, seller_group_id: 'seller-group', unit_price: '10.00' }];
        }
        if (sql.includes('from public.inventory_items')) return [{ id: 'stock', location_id: 'location', ship_from_address_id: 'origin', available: 2 }];
        return [];
      }),
      exec: jest.fn(async (_sql: string, _params: unknown[], _client: object) => 1),
      tx: jest.fn(async (run: (c: object) => Promise<string>) => run(client)),
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
      forProducts: jest.fn(async (country: string) => ({ items: { product: { status: country === 'CA' ? 'UNAVAILABLE' : 'AVAILABLE', reason: 'STORE_EXCLUDED' } } })),
    };
    const payments = {
      providerFor: jest.fn(() => ({ code: 'STRIPE', environment: 'TEST' })), releaseAbandoned: jest.fn(), startProviderPayment: jest.fn(),
    };
    const svc = new CheckoutService(db as any, { get: jest.fn() } as any, carts as any, {} as any,
      tax as any, shipping as any, payments as any, { evaluate: async () => ({ errors: [], results: [] }) } as any,
      {} as any, {} as any, availability as any);
    jest.spyOn(svc as any, 'calculate').mockResolvedValue(undefined);
    jest.spyOn(svc, 'resultFor').mockResolvedValue({ checkoutId: 'checkout' } as any);
    return {
      svc, db, shipping, availability, payments, rateFor, client,
      updateAddress: (next: typeof address | null) => { storedAddress = next; },
      quote: () => svc.quote(buyer, { addressId: address.id }),
      place: (addressVersion?: string | null) => svc.placeOrder(buyer, { addressId: address.id, addressVersion: addressVersion ?? undefined,
        shipping: { seller: 'FLAT:STANDARD' }, paymentMethod: 'CARD', idempotencyKey: 'checkout-attempt' }),
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

  it('returns a previously created checkout on an idempotent retry without a version', async () => {
    const f = checkout();
    f.db.one.mockResolvedValueOnce({ id: 'previous', currency_code: 'USD', amount: '15.00', cfg_id: 'config', acc_id: 'account' });

    await expect(f.place()).resolves.toMatchObject({ checkoutId: 'checkout' });
    expect(f.svc.resultFor).toHaveBeenCalledWith('previous', buyer);
    expect(f.db.tx).not.toHaveBeenCalled();
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
      expect(fresh.groups[0].destinationBlocked).toEqual([{ productId: 'product', reason: 'STORE_EXCLUDED' }]);
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
