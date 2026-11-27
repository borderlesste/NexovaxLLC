import { AvailabilityService, evaluateRoute, RouteFacts } from '../src/geo/availability';

const flatIntl = { code: 'INTL', name: 'Internacional', description: '', amount: 20, estimated_days: 10, requires_address: true, zone: 'INTERNATIONAL' as const };
const pickup = { code: 'PICKUP', name: 'Retiro', description: '', amount: 0, estimated_days: 1, requires_address: false };
const base: RouteFacts = { destination: 'DO', offered: [], requiresShipping: true, origin: 'US', store: null, product: null, flatRates: [], liveRates: true, knownLane: false };
const ev = (p: Partial<RouteFacts>) => evaluateRoute({ ...base, ...p });

describe('availability by destination (NX-GEO-001)', () => {
  it('confirmed restrictions are "No disponible" with a reason', () => {
    expect(ev({ offered: ['US'] })).toMatchObject({ status: 'UNAVAILABLE', reason: 'MARKETPLACE_NOT_SERVED' });
    expect(ev({ store: { mode: 'DOMESTIC', countries: [] } })).toMatchObject({ status: 'UNAVAILABLE', reason: 'STORE_DOMESTIC_ONLY' });
    expect(ev({ store: { mode: 'EXCEPT', countries: ['DO'] } })).toMatchObject({ status: 'UNAVAILABLE', reason: 'STORE_EXCLUDED' });
    expect(ev({ store: { mode: 'ONLY', countries: ['MX'] } })).toMatchObject({ status: 'UNAVAILABLE', reason: 'STORE_EXCLUDED' });
    expect(ev({ product: { mode: 'EXCEPT', countries: ['DO'] } })).toMatchObject({ status: 'UNAVAILABLE', reason: 'PRODUCT_EXCLUDED' });
  });

  it('a known route or a covering flat rate is "Disponible"', () => {
    expect(ev({ knownLane: true })).toMatchObject({ status: 'AVAILABLE', reason: 'ROUTE_OK', shipsFrom: 'US' });
    expect(ev({ liveRates: false, flatRates: [flatIntl] })).toMatchObject({ status: 'AVAILABLE', reason: 'ROUTE_OK' });
    expect(ev({ store: { mode: 'ONLY', countries: ['DO'] }, knownLane: true }).status).toBe('AVAILABLE');
    expect(ev({ requiresShipping: false, store: { mode: 'DOMESTIC', countries: [] } })).toMatchObject({ status: 'AVAILABLE', reason: 'NO_SHIPPING_NEEDED' });
  });

  it('uncertainty is "Por confirmar", never a prohibition', () => {
    expect(ev({})).toMatchObject({ status: 'UNCONFIRMED', reason: 'NEEDS_ADDRESS' });
    expect(ev({ origin: null })).toMatchObject({ status: 'UNCONFIRMED', reason: 'NO_ORIGIN' });
  });

  it('without carriers or flat rates there is no option, except pickup in the same country', () => {
    expect(ev({ liveRates: false })).toMatchObject({ status: 'UNAVAILABLE', reason: 'NO_SHIPPING_OPTION' });
    expect(ev({ liveRates: false, destination: 'US', flatRates: [pickup] })).toMatchObject({ status: 'AVAILABLE', reason: 'PICKUP_ONLY' });
    expect(ev({ liveRates: false, destination: 'US', flatRates: [flatIntl] }).status).toBe('UNAVAILABLE');
  });

  it('still confirms pickup when home delivery depends on the cart subtotal', () => {
    expect(ev({ liveRates: false, destination: 'US', flatRates: [pickup], sellerFreeShippingMinimum: '50.00' }))
      .toMatchObject({ status: 'AVAILABLE', reason: 'PICKUP_ONLY' });
  });

  it.each([
    [null, null, 'AVAILABLE', 'ROUTE_OK'],
    ['0.00', null, 'AVAILABLE', 'ROUTE_OK'],
    ['50.00', null, 'UNCONFIRMED', 'FREE_SHIPPING_MINIMUM'],
    [null, 'EXCEPT', 'UNAVAILABLE', 'STORE_EXCLUDED'],
  ])('evaluates a seller-arranged route (minimum %s, restriction %s)', async (minimum, storeMode, status, reason) => {
    const productId = 'c7d38bbe-7306-4de7-9db2-df0b27d72779';
    const variantId = '239063b3-9562-4482-b796-546bc8e1604b';
    const db = {
      one: async () => ({ alpha2: 'DO' }),
      many: async (sql: string) => sql.includes('from public.product_variants')
        ? [{ id: variantId, product_id: productId, origin: 'US' }]
        : [{ id: productId, requires_shipping: true, origin: 'US', lane: false, store_mode: storeMode,
          store_countries: ['DO'], free_shipping_minimum: minimum ?? '0.00' }],
    };
    const settings = { all: async () => ({ 'marketplace.currency': 'USD', 'shipping.rates': [] }) };
    const service = new AvailabilityService(db as any, settings as any, { enabled: false } as any);

    const result = await service.forItems('DO', [productId], [variantId]);
    expect(result.items[productId]).toMatchObject({ status, reason, shipsFrom: 'US' });
    expect(result.variants[variantId]).toMatchObject({ status, reason, shipsFrom: 'US' });
  });
});
