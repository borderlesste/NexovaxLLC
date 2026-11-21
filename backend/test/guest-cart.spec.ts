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

  it('merge keeps going when a line fails and reports it', async () => {
    const svc = new CartService({ one: async () => null } as any, settings, {} as any);
    const add = jest.spyOn(svc, 'addItem').mockImplementation(async (_u, variantId) => {
      if (variantId === 'bad') throw Object.assign(new Error('x'), { code: 'NOT_FOUND' });
      return {} as any;
    });
    jest.spyOn(svc, 'getCart').mockResolvedValue({ groups: [] } as any);
    const r = await svc.merge('u1', [{ variantId: 'bad', quantity: 1 }, { variantId: 'ok', quantity: 2 }]);
    expect(add).toHaveBeenCalledTimes(2);
    expect(r.skipped).toEqual(['bad']);
  });
});
