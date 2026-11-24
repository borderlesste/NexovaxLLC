import { googleMerchantFeed, validGtin } from '../src/catalog/google-merchant';

const row = (over: Record<string, any> = {}) => ({
  id: 'p1', slug: 'bolso-rojo', title: 'Bolso <rojo> & negro', short_description: null, description: '<p>Bolso de **cuero**</p>', requires_shipping: true,
  brand: null, store: 'Clif', origin: 'US', category_path: 'Moda > Bolsos', price: '35.96000000', compare_at: '45.00000000', sku: 'BOL-1', barcode: null,
  stock: 2, weight_value: '1.5', weight_unit: 'kg', images: ['a1', 'a2'], store_mode: null, store_countries: null, product_mode: null, product_countries: null, ...over,
});

const settings = (google: Record<string, any>, extra: Record<string, any> = {}) => ({
  all: async () => ({
    'marketplace.currency': 'USD', 'marketplace.base_url': 'https://nexovax.com', 'marketplace.name': 'NEXOVAX', 'marketplace.default_country': 'US',
    'seo.defaults': { canonicalUrl: '', siteName: '' }, 'geo.delivery': { countries: [] },
    'shipping.rates': [{ code: 'STD', name: 'Estándar', amount: 9.5, zone: 'DOMESTIC' }, { code: 'INT', name: 'Internacional', amount: 25, zone: 'INTERNATIONAL' }],
    'google.integrations': { merchantFeedEnabled: true, merchantShippingCountries: [], merchantCondition: 'new', merchantIncludeOutOfStock: false, merchantStoreAsBrand: false, ...google },
    ...extra,
  }),
});
const db = (rows: any[]) => ({ many: async () => rows }) as any;

describe('Google Merchant feed', () => {
  it('is off unless enabled', async () => {
    expect(await googleMerchantFeed(db([row()]), settings({ merchantFeedEnabled: false }) as any)).toBeNull();
  });

  it('builds escaped items with sale price, images, product type and shipping', async () => {
    const x = (await googleMerchantFeed(db([row()]), settings({ merchantShippingCountries: ['US', 'DO'] }) as any))!;
    expect(x).toContain('<g:title>Bolso &lt;rojo&gt; &amp; negro</g:title>');
    expect(x).toContain('<g:description>Bolso de cuero</g:description>');
    expect(x).toContain('<g:link>https://nexovax.com/producto/bolso-rojo</g:link>');
    expect(x).toContain('<g:image_link>https://nexovax.com/api/media/a1</g:image_link>');
    expect(x).toContain('<g:additional_image_link>https://nexovax.com/api/media/a2</g:additional_image_link>');
    expect(x).toContain('<g:price>45.00 USD</g:price><g:sale_price>35.96 USD</g:sale_price>');
    expect(x).toContain('<g:identifier_exists>no</g:identifier_exists>');
    expect(x).toContain('<g:product_type>Moda &gt; Bolsos</g:product_type>');
    expect(x).toContain('<g:shipping><g:country>US</g:country><g:service>Estándar</g:service><g:price>9.50 USD</g:price></g:shipping>');
    expect(x).toContain('<g:shipping><g:country>DO</g:country><g:service>Internacional</g:service><g:price>25.00 USD</g:price></g:shipping>');
  });

  it('respects destination restrictions, stock and the store-as-brand option', async () => {
    const rows = [row({ store_mode: 'DOMESTIC' }), row({ id: 'p2', stock: 0 }), row({ id: 'p3', images: [] })];
    const x = (await googleMerchantFeed(db(rows), settings({ merchantShippingCountries: ['DO'], merchantStoreAsBrand: true }) as any))!;
    expect(x.match(/<item>/g)).toHaveLength(1);
    expect(x).not.toContain('<g:country>DO</g:country>');
    expect(x).toContain('<g:brand>Clif</g:brand><g:mpn>BOL-1</g:mpn>');
    const y = (await googleMerchantFeed(db(rows), settings({ merchantIncludeOutOfStock: true }) as any))!;
    expect(y).toContain('<g:availability>out_of_stock</g:availability>');
  });

  it('uses each listing condition and preserves the configured fallback for older products', async () => {
    const products = [row({ item_condition: 'USED' }), row({ item_condition: 'NEW' }), row()];
    const xml = await googleMerchantFeed(db(products), settings({ merchantCondition: 'refurbished' }) as any);
    expect(xml?.match(/<g:condition>[^<]+/g)).toEqual(['<g:condition>used', '<g:condition>new', '<g:condition>refurbished']);
  });

  it('accepts only GTINs with a valid check digit', () => {
    expect(validGtin('4006381333931')).toBe('4006381333931');
    expect(validGtin('4006381333932')).toBeNull();
    expect(validGtin('036000291452')).toBe('036000291452');
    expect(validGtin('ABC')).toBeNull();
  });
});
