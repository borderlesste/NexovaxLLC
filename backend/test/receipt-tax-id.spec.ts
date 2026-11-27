import 'reflect-metadata';
jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
jest.mock('../src/common/crypto', () => ({ ...jest.requireActual('../src/common/crypto'), decrypt: jest.fn((c: string) => `plain:${c}`) }));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrdersService } from '../src/orders/orders.service';
import { DEFAULT_RECEIPT_TAX_ID, normalizeReceiptTaxId, receiptTaxIdAllowed } from '../src/orders/receipt-tax-id';

describe('seller tax ID on receipts', () => {
  it('only allows business entity types, never personal ones', () => {
    for (const code of ['COMPANY', 'PARTNERSHIP', 'NONPROFIT', 'SRL', 'SA']) expect(receiptTaxIdAllowed(code, DEFAULT_RECEIPT_TAX_ID)).toBe(true);
    for (const code of ['INDIVIDUAL', 'SOLE_PROPRIETOR', 'OTHER', 'PERSONA_FISICA', 'EIRL', 'OTRO', '', null, undefined])
      expect(receiptTaxIdAllowed(code as any, DEFAULT_RECEIPT_TAX_ID)).toBe(false);
  });

  it('drops personal types from the setting and honours what the admin turned off', () => {
    expect(normalizeReceiptTaxId({ entityTypes: ['SOLE_PROPRIETOR', 'INDIVIDUAL', 'OTHER', 'COMPANY', 'COMPANY'] })).toEqual({ entityTypes: ['COMPANY'] });
    expect(receiptTaxIdAllowed('SOLE_PROPRIETOR', { entityTypes: ['SOLE_PROPRIETOR'] as any })).toBe(false);
    expect(receiptTaxIdAllowed('PARTNERSHIP', { entityTypes: ['COMPANY'] })).toBe(false);
    expect(normalizeReceiptTaxId({ entityTypes: [] })).toEqual({ entityTypes: [] });
  });

  function fixture(owner: string, rows: any[]) {
    const db = { one: jest.fn().mockResolvedValue({ id: 'order', customer_id: owner }), many: jest.fn().mockResolvedValue(rows) };
    const settings = { get: jest.fn().mockResolvedValue(DEFAULT_RECEIPT_TAX_ID) };
    return { db, orders: new OrdersService(db as any, null!, null!, null!, null!, settings as any) };
  }

  it('decrypts only allowed business tax IDs for the order owner', async () => {
    const { orders } = fixture('buyer', [
      { id: 'so-company', entity_type_code: 'COMPANY', tax_identifier_ciphertext: 'c1' },
      { id: 'so-sole', entity_type_code: 'SOLE_PROPRIETOR', tax_identifier_ciphertext: 'c2' },
      { id: 'so-other', entity_type_code: 'OTHER', tax_identifier_ciphertext: 'c3' },
      { id: 'so-person', entity_type_code: 'INDIVIDUAL', tax_identifier_ciphertext: 'c4' },
    ]);
    await expect(orders.receiptTaxIds('buyer', 'order')).resolves.toEqual({ sellers: [{ sellerOrderId: 'so-company', taxId: 'plain:c1' }] });
  });

  it('refuses anyone but the buyer', async () => {
    const { orders, db } = fixture('buyer', [{ id: 'so', entity_type_code: 'COMPANY', tax_identifier_ciphertext: 'c1' }]);
    await expect(orders.receiptTaxIds('someone-else', 'order')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.many).not.toHaveBeenCalled();
  });

  it('never reads the encrypted tax ID in the shared order detail', () => {
    const src = readFileSync(join(__dirname, '../src/orders/orders.service.ts'), 'utf8');
    const detail = src.slice(src.indexOf('  async detail('), src.indexOf('\n  }\n', src.indexOf('  async detail(')));
    expect(detail).not.toMatch(/tax_identifier_ciphertext|decrypt\(/);
  });
});
