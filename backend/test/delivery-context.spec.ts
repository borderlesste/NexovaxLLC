import { resolveDeliveryContext } from '../src/geo/delivery-context';
import { config } from '../src/config';

const COUNTRIES = ['US', 'DO', 'BR', 'MX'];
const db: any = {
  many: async () => COUNTRIES.map((alpha2) => ({ alpha2 })),
  one: async (_sql: string, [id]: string[]) => ({ delivery_country: id === 'u-do' ? 'DO' : id === 'u-bad' ? 'ZZ' : null }),
};
const settingsWith = (geo: any, def = 'US'): any => ({ all: async () => ({ 'marketplace.default_country': def, 'geo.delivery': geo }) });
const on = { ipDetection: true, showSelector: true, countries: [] };
const req = (h: Record<string, string>) => ({ headers: h });

describe('delivery context (NX-GEO-001)', () => {
  const secret = 'test-proxy-secret';
  beforeAll(() => ((config as any).proxySharedSecret = secret));
  const signed = (extra: Record<string, string> = {}) => req({ 'x-nx-proxy-secret': secret, 'x-nx-ip-country': 'br', ...extra });

  it('suggests the IP country, marked as approximate', async () => {
    const c = await resolveDeliveryContext(db, settingsWith(on), signed());
    expect(c).toMatchObject({ detectedCountry: 'BR', deliveryCountry: 'BR', source: 'ip', isApproximate: true });
  });

  it('prefers the explicit choice, then the account, over the IP', async () => {
    const manual = await resolveDeliveryContext(db, settingsWith(on), signed({ cookie: 'a=1; nx_delivery_country=DO' }), 'u-none');
    expect(manual).toMatchObject({ detectedCountry: 'BR', deliveryCountry: 'DO', source: 'manual', isApproximate: false });
    const account = await resolveDeliveryContext(db, settingsWith(on), signed(), 'u-do');
    expect(account).toMatchObject({ deliveryCountry: 'DO', source: 'account', isApproximate: false });
  });

  it('honors a valid percent-encoded country before the account preference', async () => {
    const context = await resolveDeliveryContext(db, settingsWith(on), signed({ cookie: 'nx_delivery_country=%6D%78' }), 'u-do');
    expect(context).toMatchObject({ deliveryCountry: 'MX', source: 'manual', isApproximate: false });
  });

  it('uses the account or IP preference when the country cookie cannot be decoded', async () => {
    const request = signed({ cookie: 'nx_delivery_country=%E0%A4' });
    await expect(resolveDeliveryContext(db, settingsWith(on), request, 'u-do')).resolves.toMatchObject({
      deliveryCountry: 'DO', source: 'account', isApproximate: false,
    });
    await expect(resolveDeliveryContext(db, settingsWith(on), request)).resolves.toMatchObject({
      deliveryCountry: 'BR', source: 'ip', isApproximate: true,
    });
  });

  it('ignores a country header without the proxy secret (forged by a client)', async () => {
    const c = await resolveDeliveryContext(db, settingsWith(on), req({ 'x-nx-ip-country': 'BR', 'x-nx-proxy-secret': 'nope' }));
    expect(c).toMatchObject({ detectedCountry: null, deliveryCountry: 'US', source: 'default', isApproximate: true });
  });

  it('ignores unknown codes and countries the admin does not offer', async () => {
    const bad = await resolveDeliveryContext(db, settingsWith(on), signed({ cookie: 'nx_delivery_country=ZZ' }), 'u-bad');
    expect(bad.source).toBe('ip');
    const limited = await resolveDeliveryContext(db, settingsWith({ ...on, countries: ['DO', 'US'] }, 'DO'), signed());
    expect(limited).toMatchObject({ detectedCountry: 'BR', deliveryCountry: 'DO', source: 'default', countries: ['DO', 'US'] });
  });

  it('skips IP detection when the admin turns it off', async () => {
    const c = await resolveDeliveryContext(db, settingsWith({ ...on, ipDetection: false }, 'MX'), signed());
    expect(c).toMatchObject({ detectedCountry: null, deliveryCountry: 'MX', source: 'default' });
  });
});
