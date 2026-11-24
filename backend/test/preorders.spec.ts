import { validate } from 'class-validator';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC, RequestUser } from '../src/auth/auth';
import { ConfigurePreorderDto, PreordersController, ReservePreorderDto } from '../src/preorders/preorders.controller';

jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));

describe('preorder endpoints', () => {
  const ctrl = new PreordersController({} as any);

  it('exposes only the published offers without authentication', () => {
    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC, ctrl.published)).toBe(true);
    for (const fn of [ctrl.mine, ctrl.reserve, ctrl.cancel, ctrl.configure, ctrl.close, ctrl.sellerOffers])
      expect(reflector.get(IS_PUBLIC, fn)).toBeUndefined();
  });

  it('requires the products permission on the selected store for every seller endpoint', () => {
    const user = { sellers: [{ id: 'store', isOwner: false, areas: ['ORDERS'] }] } as RequestUser;
    expect(() => ctrl.sellerOffers(user, 'product', 'store')).toThrow(/permiso/);
    expect(() => ctrl.configure(user, 'product', 'variant', {} as any, 'store')).toThrow(/permiso/);
    expect(() => ctrl.close(user, 'product', 'variant', 'store')).toThrow(/permiso/);
    expect(() => ctrl.sellerOffers(user, 'product', 'another-store')).toThrow();
  });

  it('requires a real arrival date with timezone, a finite capacity and a positive integer quantity', async () => {
    const dto = (arrivalAt: string, capacity: number) => Object.assign(new ConfigurePreorderDto(), { arrivalAt, capacity });
    expect(await validate(dto('2026-11-25T20:00:00-04:00', 1))).toHaveLength(0);
    for (const [date, capacity] of [['2026-11-25T20:00:00', 1], ['2026-11-31T20:00:00Z', 1], ['2026-11-25T20:00:00Z', 0]] as const)
      expect((await validate(dto(date, capacity))).length).toBeGreaterThan(0);
    const reserve = Object.assign(new ReservePreorderDto(), { offerId: '9bed7f24-6844-495a-be58-9e244a311028', quantity: 1.5 });
    expect((await validate(reserve)).map((e) => e.property)).toEqual(['quantity']);
  });
});
