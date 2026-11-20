import { of, lastValueFrom } from 'rxjs';
import { CatalogLocaleInterceptor } from '../src/common/i18n-catalog';
import { colorSwatch, isColorOption, translateVariants, variantTitle } from '../src/common/variant-options-i18n';

const product = {
  title: 'Women handbag',
  options: [
    { id: 'o1', code: 'color', name: 'Color', displayType: 'SWATCH', values: [{ id: 'v1', label: 'Rojo', swatch: '#f00' }, { id: 'v2', label: 'marrón', swatch: null }] },
    { id: 'o2', code: 'tamano', name: 'Tamaño', displayType: 'BUTTON', values: [{ id: 'v3', label: 'Mediano' }, { id: 'v4', label: 'XL' }] },
  ],
  variants: [{ id: 'x', sku: 'A', title: 'Rojo / Mediano', isDefault: true, optionValues: { o1: 'v1' } }],
  specifications: [{ code: 'material', name: 'Material', value: 'Algodón', valueEn: 'Cotton' }],
};

const run = async (locale: string, body: any) => {
  const ctx: any = { switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-locale': locale } }) }) };
  return lastValueFrom(new CatalogLocaleInterceptor().intercept(ctx, { handle: () => of(body) }));
};

describe('variant translations', () => {
  it('translates option names, values and variant titles', () => {
    const en = translateVariants(product, 'en');
    expect(en.options.map((o: any) => o.name)).toEqual(['Color', 'Size']);
    expect(en.options[0].values.map((v: any) => v.label)).toEqual(['Red', 'Brown']);
    expect(en.options[1].values.map((v: any) => v.label)).toEqual(['Medium', 'XL']);
    expect(en.variants[0].title).toBe('Red / Medium');
    expect(en.title).toBe('Women handbag');
    expect(variantTitle('Negro / 42', 'fr')).toBe('Noir / 42');
  });

  it('applies through the locale interceptor for each language', async () => {
    const fr = await run('fr', product);
    expect(fr.options[0].name).toBe('Couleur');
    expect(fr.options[1].values[0].label).toBe('Moyen');
    const ht = await run('ht', product);
    expect(ht.options[0].values[0].label).toBe('Wouj');
    const en = await run('en', product);
    expect(en.options[1].name).toBe('Size');
    expect(en.specifications[0].value).toBe('Cotton');
    const es = await run('es', product);
    expect(es.options[1].name).toBe('Tamaño');
  });

  it('leaves the seller editor options as typed, so saving never renames them', async () => {
    const editor = { id: 'p', options: [{ id: 'o', name: 'Estilo', values: [{ label: 'Rojo' }] }] };
    const en = await run('en', editor);
    expect(en.options[0]).toEqual({ id: 'o', name: 'Estilo', values: [{ label: 'Rojo' }] });
  });

  it('translates cart and order line variant titles', async () => {
    const cart = { items: [{ title: 'Pantalón', variantTitle: 'Negro / Grande' }] };
    expect((await run('en', cart)).items[0]).toEqual({ title: 'Pantalón', variantTitle: 'Black / Large' });
  });
});

describe('variant words typed in any language', () => {
  it('shows words typed in English, French or Creole in the shopper language', async () => {
    const typed = {
      options: [{ id: 'o', code: 'colour', name: 'Couleur', displayType: 'SWATCH', values: [{ id: 'a', label: 'Red' }, { id: 'b', label: 'Wouj' }, { id: 'c', label: 'Rouge' }] }],
      variants: [{ id: 'x', title: 'Black / Medium', isDefault: true, optionValues: {} }],
    };
    const es = await run('es', typed);
    expect(es.options[0].name).toBe('Color');
    expect(es.options[0].values.map((v: any) => v.label)).toEqual(['Rojo', 'Rojo', 'Rojo']);
    expect(es.variants[0].title).toBe('Negro / Mediano');
    const ht = await run('ht', typed);
    expect(ht.options[0].values[0].label).toBe('Wouj');
    const en = await run('en', typed);
    expect(en.options[0].values[2].label).toBe('Red');
    expect(variantTitle('XL / 42', 'es')).toBe('XL / 42');
  });

  it('recognizes color options and swatches in every language', () => {
    expect(['Color', 'Colour', 'Couleur', 'Koulè'].every(isColorOption)).toBe(true);
    expect(isColorOption('Talla')).toBe(false);
    expect(colorSwatch('Red')).toBe('#dc2626');
    expect(colorSwatch('rouge')).toBe('#dc2626');
    expect(colorSwatch('Wouj')).toBe('#dc2626');
    expect(colorSwatch('Navy blue')).toBe('#1e3a8a');
    expect(colorSwatch('Acme')).toBeNull();
  });
});
