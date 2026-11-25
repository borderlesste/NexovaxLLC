// jose ships ESM only; token verification is not under test.
jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
import { CartService } from '../src/cart/cart.service';

describe('guest cart', () => {
  const settings: any = { currency: async () => 'USD' };
  it('preview merges repeated variants, caps quantities and stores nothing', async () => {
    const calls: any[] = [];
    const db: any = { many: async (sql: string, params: any[]) => (calls.push({ sql, params }), []), exec: jest.fn(), tx: jest.fn() };
    const svc = new CartService(db, settings, {} as any);
    const v = '11111111-1111-4111-8111-111111111111';
    const r = await svc.preview([{ variantId: v, quantity: 600 }, { variantId: v, quantity: 600 }]);
    expect(calls[0].params).toEqual([[v], 'USD', [999]]);
    expect(calls[0].sql).toContain('published_at is not null');
    expect(db.exec).not.toHaveBeenCalled();
    expect(db.tx).not.toHaveBeenCalled();
    expect(r).toMatchObject({ guest: true, groups: [], itemCount: 0, currency: 'USD' });
  });

  // In-memory stand-in for the transaction: cart lines, stock and merge receipts.
  function fakeDb(stock: Record<string, number>) {
    const lines = new Map<string, number>();
    const receipts = new Set<string>();
    const client: any = { query: jest.fn(async () => ({ rows: [] })) };
    const db: any = {
      tx: async (fn: any) => fn(client),
      one: async (sql: string, p: any[]) => {
        if (sql.includes('to_regclass')) return { ok: true };
        if (sql.includes('cart_merge_receipts')) {
          const k = `${p[0]}|${p[1]}`;
          if (receipts.has(k)) return null;
          receipts.add(k);
          return { merge_key: p[1] };
        }
        if (sql.includes('from public.cart_items')) return lines.has(p[1]) ? { quantity: lines.get(p[1]) } : null;
        if (sql.includes('from public.inventory_items')) return p[0] in stock ? { s: stock[p[0]], n: 1 } : { s: 0, n: 0 };
        return null;
      },
      exec: async (sql: string, p: any[]) => {
        if (sql.includes('add_or_update_cart_item')) {
          if (p[2] === 'bad') throw Object.assign(new Error('x'), { code: 'NOT_FOUND' });
          lines.set(p[2], p[3]);
        }
      },
    };
    return { db, lines };
  }
  const payments: any = { releaseAbandoned: async () => undefined };
  const KEY = '22222222-2222-4222-8222-222222222222';

  it('merge keeps going when a line fails, caps at stock and reports the rest', async () => {
    const { db, lines } = fakeDb({ ok: 10, few: 3 });
    const svc = new CartService(db, settings, payments);
    jest.spyOn(svc, 'ensureMutableCart').mockResolvedValue({ id: 'c1' } as any);
    jest.spyOn(svc, 'getCart').mockResolvedValue({ groups: [] } as any);
    const r = await svc.merge('u1', [{ variantId: 'bad', quantity: 1 }, { variantId: 'ok', quantity: 2 }, { variantId: 'few', quantity: 5 }], KEY);
    expect(r.skipped).toEqual(['bad']);
    expect(lines.get('ok')).toBe(2);
    expect(lines.get('few')).toBe(3);
  });

  it('merge is idempotent per key: a retry or a second tab does not add the quantities again', async () => {
    const { db, lines } = fakeDb({ ok: 10 });
    const svc = new CartService(db, settings, payments);
    jest.spyOn(svc, 'ensureMutableCart').mockResolvedValue({ id: 'c1' } as any);
    jest.spyOn(svc, 'getCart').mockResolvedValue({ groups: [] } as any);
    await svc.merge('u1', [{ variantId: 'ok', quantity: 2 }], KEY);
    await svc.merge('u1', [{ variantId: 'ok', quantity: 2 }], KEY);
    expect(lines.get('ok')).toBe(2);
    await svc.merge('u1', [{ variantId: 'ok', quantity: 1 }], '33333333-3333-4333-8333-333333333333');
    expect(lines.get('ok')).toBe(3);
  });
});
