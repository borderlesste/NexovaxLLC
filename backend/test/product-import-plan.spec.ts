import 'reflect-metadata';
jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
import { ProductImportService } from '../src/seller/product-import.service';
import type { ImportRow } from '../src/seller/product-import.parse';

const CATS = [
  { id: '11111111-1111-4111-8111-111111111111', parent_id: null, name: 'Ropa', slug: 'ropa' },
  { id: '22222222-2222-4222-8222-222222222222', parent_id: '11111111-1111-4111-8111-111111111111', name: 'Camisas', slug: 'camisas' },
  { id: '33333333-3333-4333-8333-333333333333', parent_id: null, name: 'Hogar', slug: 'hogar' },
  { id: '44444444-4444-4444-8444-444444444444', parent_id: '33333333-3333-4333-8333-333333333333', name: 'Accesorios', slug: 'accesorios-hogar' },
  { id: '55555555-5555-4555-8555-555555555555', parent_id: '11111111-1111-4111-8111-111111111111', name: 'Accesorios', slug: 'accesorios-ropa' },
];

function service(existing: any[] = []) {
  const db: any = {
    one: jest.fn(async () => ({ '?column?': 1 })),
    many: jest.fn(async (sql: string) => (sql.includes('from public.categories') ? CATS : sql.includes('product_variants') ? existing : [])),
  };
  const seller: any = {
    validateProduct: jest.fn(),
  };
  return new ProductImportService(db, {} as any, seller);
}

const base: Omit<ImportRow, 'row'> = {
  sku: 'cam-1', title: 'Camisa de lino', description: 'Camisa fresca de lino para el verano.', category: 'Camisas',
  price: '25', stock: '10', weightKg: '0.3', lengthCm: '30', widthCm: '20', heightCm: '3', images: 'https://example.com/a.jpg',
};

describe('product import plan', () => {
  it('accepts a complete product row', async () => {
    const r = await service().preview('seller', [{ row: 2, ...base }]);
    expect(r.items[0]).toMatchObject({ action: 'CREATE', sku: 'CAM-1', errors: [], images: 1 });
    expect(r.summary).toMatchObject({ newProducts: 1, updates: 0, errors: 0 });
  });

  it('builds one product with variants from rows sharing a Grupo', async () => {
    const rows: ImportRow[] = [
      { row: 2, ...base, group: 'Camisa lino', option1Name: 'Talla', option1Value: 'S', sku: 'CAM-S' },
      { row: 3, sku: 'CAM-M', group: 'Camisa lino', option1Value: 'M', price: '25', stock: '4' },
    ];
    const r = await service().preview('seller', rows);
    expect(r.items.map((i) => i.errors)).toEqual([[], []]);
    expect(r.items[1]).toMatchObject({ variants: 2, title: 'Camisa de lino' });
    expect(r.summary.newProducts).toBe(1);
  });

  it('asks for an option name when a Grupo has several rows', async () => {
    const r = await service().preview('seller', [
      { row: 2, ...base, group: 'X', sku: 'A' },
      { row: 3, ...base, group: 'X', sku: 'B' },
    ]);
    expect(r.items[0].errors.join(' ')).toMatch(/Opción 1 nombre/);
  });

  it('explains category problems', async () => {
    const r = await service().preview('seller', [
      { row: 2, ...base, sku: 'A', category: 'Ropa' },
      { row: 3, ...base, sku: 'B', category: 'Accesorios' },
      { row: 4, ...base, sku: 'C', category: 'Zapatos' },
      { row: 5, ...base, sku: 'D', category: 'Hogar > Accesorios' },
      { row: 6, ...base, sku: 'E', category: 'ropa / camisas' },
    ]);
    expect(r.items[0].errors.join()).toMatch(/subcategorías/);
    expect(r.items[1].errors.join()).toMatch(/varias secciones/);
    expect(r.items[2].errors.join()).toMatch(/no existe/);
    expect(r.items[3].errors).toEqual([]);
    expect(r.items[4].errors).toEqual([]);
  });

  it('flags missing and invalid values and repeated SKUs', async () => {
    const r = await service().preview('seller', [
      { row: 2, ...base, price: '', weightKg: 'mucho' },
      { row: 3, ...base },
    ]);
    expect(r.items[0].errors.join(' ')).toMatch(/Precio: es obligatorio/);
    expect(r.items[0].errors.join(' ')).toMatch(/Peso \(kg\)/);
    expect(r.items[1].errors.join(' ')).toMatch(/repetido/);
  });

  it('updates price and stock of SKUs that already exist', async () => {
    const existing = [{ sku: 'CAM-1', variant_id: 'v1', product_id: 'p1', product_status: 'ACTIVE', variant_status: 'ACTIVE' }];
    const r = await service(existing).preview('seller', [{ row: 2, sku: 'cam-1', price: '30', stock: '2' }, { row: 3, sku: 'cam-1x', group: 'g' }]);
    expect(r.items[0]).toMatchObject({ action: 'UPDATE', errors: [] });
    expect(r.summary.updates).toBe(1);
  });

  it('refuses new variants for a product that already exists', async () => {
    const existing = [{ sku: 'CAM-S', variant_id: 'v1', product_id: 'p1', product_status: 'ACTIVE', variant_status: 'ACTIVE' }];
    const r = await service(existing).preview('seller', [
      { row: 2, sku: 'CAM-S', group: 'Camisa', price: '30' },
      { row: 3, ...base, sku: 'CAM-L', group: 'Camisa', option1Name: 'Talla', option1Value: 'L' },
    ]);
    expect(r.items[1].errors.join()).toMatch(/editor del producto/);
  });
});
