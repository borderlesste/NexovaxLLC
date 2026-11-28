import { googleMerchantFeed, productJsonLd, validGtin } from '../src/catalog/google-merchant';

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

  it('adds handling and transit days to the feed when configured', async () => {
    const times = { merchantHandlingMinDays: 1, merchantHandlingMaxDays: 3, merchantTransitMinDays: 3, merchantTransitMaxDays: 7 };
    const x = (await googleMerchantFeed(db([row()]), settings(times) as any))!;
    expect(x).toContain('<g:price>9.50 USD</g:price><g:min_transit_time>3</g:min_transit_time><g:max_transit_time>7</g:max_transit_time></g:shipping>');
    expect(x).toContain('<g:min_handling_time>1</g:min_handling_time><g:max_handling_time>3</g:max_handling_time>');
  });
});

describe('Product page structured data', () => {
  const policy = { windowDays: 7, labelPayer: 'CUSTOMER', restockingFeePercent: 0 } as any;
  const times = { merchantHandlingMinDays: 1, merchantHandlingMaxDays: 3, merchantTransitMinDays: 3, merchantTransitMaxDays: 7 };

  it('includes description, shipping details and the return policy from the settings', async () => {
    const d: any = await productJsonLd(db([row()]), settings(times) as any, async () => policy, 'bolso-rojo');
    expect(d.description).toBe('Bolso de cuero');
    expect(d.offers.price).toBe('35.96');
    expect(d.offers.shippingDetails).toEqual([
      {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: '9.50', currency: 'USD' },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 3, unitCode: 'DAY' },
          transitTime: { '@type': 'QuantitativeValue', minValue: 3, maxValue: 7, unitCode: 'DAY' },
        },
      },
    ]);
    expect(d.offers.hasMerchantReturnPolicy).toMatchObject({
      '@type': 'MerchantReturnPolicy', applicableCountry: 'US', returnPolicyCountry: 'US', merchantReturnDays: 7,
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow', returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility', merchantReturnLink: 'https://nexovax.com/politica-de-devoluciones',
    });
    expect(d.brand).toBeUndefined();
  });

  it('uses brand + GTIN or MPN like the feed, and the title when there is no description', async () => {
    const a: any = await productJsonLd(db([row({ brand: 'Epson', barcode: '4006381333931', description: null })]), settings({}) as any, async () => policy, 'x');
    expect(a).toMatchObject({ brand: { '@type': 'Brand', name: 'Epson' }, gtin13: '4006381333931', description: 'Bolso <rojo> & negro' });
    expect(a.mpn).toBeUndefined();
    const b: any = await productJsonLd(db([row()]), settings({ merchantStoreAsBrand: true }) as any, async () => policy, 'x');
    expect(b).toMatchObject({ brand: { name: 'Clif' }, mpn: 'BOL-1' });
    expect(await productJsonLd(db([]), settings({}) as any, async () => policy, 'x')).toBeNull();
  });

  it('describes returns paid by reason or not accepted', async () => {
    const a: any = await productJsonLd(db([row()]), settings({}) as any, async () => ({ ...policy, labelPayer: 'BY_REASON' }), 'x');
    expect(a.offers.hasMerchantReturnPolicy).toMatchObject({
      customerRemorseReturnFees: 'https://schema.org/ReturnFeesCustomerResponsibility', itemDefectReturnFees: 'https://schema.org/FreeReturn',
    });
    const b: any = await productJsonLd(db([row()]), settings({}) as any, async () => ({ ...policy, windowDays: 0 }), 'x');
    expect(b.offers.hasMerchantReturnPolicy.returnPolicyCategory).toBe('https://schema.org/MerchantReturnNotPermitted');
  });
});
