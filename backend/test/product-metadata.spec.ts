jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}) }));
import { of, lastValueFrom } from 'rxjs';
import { SellerService, ProductInput } from '../src/seller/seller.service';
import { CatalogService } from '../src/catalog/catalog.service';
import { CatalogLocaleInterceptor } from '../src/common/i18n-catalog';

const rules = { input: 'combobox', options: [{ value: 'classic', label: 'Clásico', labelEn: 'Classic' }] };
const baseline: ProductInput = {
  title: 'Camisa', categoryId: 'category', description: 'Camisa de algodón',
  variants: [{ id: 'variant', sku: 'CAMISA', price: 10, stock: 0, weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1 }],
};
const guide = 'M — 92 cm\nL — 98 cm';

function fixture(status = 'DRAFT') {
  const product = { id: 'product', title: baseline.title, description: baseline.description, status,
    category_id: 'category', tax_class: 'EXEMPT', item_condition: null as string | null, size_guide: null as string | null };
  const styles = ['classic'];
  const photo = { id: 'photo', variant_id: null as string | null };
  const db = {
    tx: (run: (c: unknown) => unknown) => run({}),
    one: jest.fn(async (sql: string, args: unknown[]) => {
      if (sql.includes('select md5')) return { h: JSON.stringify([product.item_condition, product.size_guide, styles]) };
      if (sql.includes('from public.sellers where')) return { status: 'ACTIVE' };
      if (sql.includes('select 1 from public.products where slug') || sql.includes('lower(sku)')) return null;
      if (sql.includes('from public.products where') || sql.includes('from public.products p')) return product;
      if (sql.includes('select variant_id from public.product_media')) return photo;
      if (sql.includes('from public.product_variants where id') && args[0] !== 'variant') return null;
      return { id: 'variant' };
    }),
    many: jest.fn(async (sql: string) => {
      if (sql.includes('category_attribute_definitions')) return [{ id: 'style', code: 'style', name: 'Estilo', data_type: 'TEXT', validation_rules: rules }];
      if (sql.includes('join public.attribute_definitions ad')) return styles.map((value_text) => ({ code: 'style', name: 'Estilo', value_text, validation_rules: rules }));
      if (sql.includes('from public.product_attribute_values pav')) return styles.map((value) => ({ definition_id: 'style', value }));
      if (sql.includes('from public.product_media where')) return [photo];
      return [];
    }),
    exec: jest.fn(async (sql: string, args: any[]) => {
      if (sql.includes('update public.products set title')) [product.tax_class, product.item_condition, product.size_guide] = args.slice(7);
      if (sql.includes('update public.products set status')) product.status = args[1];
      if (sql.includes('delete from public.product_attribute_values')) styles.length = 0;
      if (sql.includes('insert into public.product_attribute_values')) styles[args[2]] = args[3];
      if (sql.includes('update public.product_media set variant_id')) photo.variant_id = args[1];
      return 1;
    }),
  };
  const settings = { currency: () => 'USD', get: () => true };
  const seller = new SellerService(db as any, settings as any, {} as any, {} as any, {} as any);
  jest.spyOn(seller, 'setPrice').mockResolvedValue(undefined);
  jest.spyOn(seller, 'setStock').mockResolvedValue(undefined);
  const catalog = new CatalogService(db as any, settings as any);
  const save = (update: Partial<ProductInput>) => seller.saveProduct({ id: 'owner' } as any, 'seller', { ...baseline, ...update }, 'product');
  return { db, product, styles, seller, catalog, save };
}

describe('seller listing metadata', () => {
  it('reopens a legacy style, saves multiple canonical or custom values, retains the tax override and clears an optional guide', async () => {
    const { save, seller, styles } = fixture();
    expect((await seller.getProduct('seller', 'product')).attributes).toEqual([{ definition_id: 'style', value: 'classic' }]);
    const updated = await save({ condition: 'USED', sizeGuide: guide, attributes: ['Classic', 'classic', 'Hecho a mano'].map((value) => ({ definitionId: 'style', value })) });
    expect(updated).toMatchObject({ condition: 'USED', sizeGuide: guide, taxClass: 'EXEMPT', attributes: [
      { definition_id: 'style', value: 'classic' }, { definition_id: 'style', value: 'Hecho a mano' },
    ] });
    expect(styles).toEqual(['classic', 'Hecho a mano']);
    expect(await save({})).toMatchObject({ condition: 'USED', sizeGuide: guide, taxClass: 'EXEMPT' });
    expect(await save({ sizeGuide: null })).toMatchObject({ condition: 'USED', sizeGuide: null });
  });

  it('renders grouped styles in four locales and preserves measurement lines in the public detail', async () => {
    const { save, catalog } = fixture();
    await save({ condition: 'NEW', sizeGuide: guide, attributes: ['classic', 'Boho, retro'].map((value) => ({ definitionId: 'style', value })) });
    const detail = await catalog.productDetail('camisa');
    for (const [locale, expected] of Object.entries({ es: 'Clásico', en: 'Classic', fr: 'Classique', ht: 'Klasik' })) {
      const ctx: any = { switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-locale': locale } }) }) };
      const translated = await lastValueFrom(new CatalogLocaleInterceptor().intercept(ctx, { handle: () => of(detail) }));
      expect(translated).toMatchObject({ condition: 'NEW', sizeGuide: guide, specifications: [{ code: 'style', value: `${expected}, Boho, retro` }] });
    }
  });

  it.each(['SUBMIT', 'SAVE_DRAFT'] as const)('moderates a changed guide for public out-of-stock listings on %s', async (action) => {
    const { save, db } = fixture('OUT_OF_STOCK');
    expect(await save({ action })).toMatchObject({ status: 'OUT_OF_STOCK' });
    expect(await save({ action, sizeGuide: guide })).toMatchObject({ status: 'PENDING_REVIEW' });
    expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('product_status_history'), expect.arrayContaining(['OUT_OF_STOCK', 'PENDING_REVIEW']), expect.anything());
  });

  it('validates the saved variant, moderates a changed association, and clears the photo association', async () => {
    const { seller, db } = fixture('OUT_OF_STOCK');
    const set = (id: string | null) => seller.setMediaVariant('seller', 'product', 'photo', id, 'owner');
    await expect(set('foreign')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.one).toHaveBeenCalledWith(expect.stringContaining("product_id = $2 and status = 'ACTIVE'"), ['foreign', 'product'], expect.anything());
    expect(await set(null)).toMatchObject({ status: 'OUT_OF_STOCK' });
    expect(await set('variant')).toMatchObject({ status: 'PENDING_REVIEW', media: [{ variantId: 'variant' }] });
    expect(await set(null)).toMatchObject({ media: [{ variantId: null }] });
  });
});
