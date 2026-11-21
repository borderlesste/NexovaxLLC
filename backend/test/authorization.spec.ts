import 'reflect-metadata';

// Token verification is not under test; jose ships ESM only.
jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, IS_PUBLIC, ROLES, RequestUser, RoleCode, requireSeller, requireSellerOwner, SELLER_AREAS, sellerCan } from '../src/auth/auth';
import { TeamController } from '../src/seller/team.controller';
import { cleanAreas } from '../src/seller/team.service';
import { SellerController } from '../src/seller/seller.controller';
import { PayoutSchedulesController } from '../src/seller/payout-schedules.controller';

const OWNED = { id: '11111111-1111-1111-1111-111111111111', slug: 'mine', status: 'ACTIVE', isOwner: true, areas: [...SELLER_AREAS] };
const MEMBER_OF = { id: '22222222-2222-2222-2222-222222222222', slug: 'team', status: 'ACTIVE', isOwner: false, areas: ['ORDERS', 'FINANCE'] as RequestUser['sellers'][number]['areas'] };
const OTHER = '33333333-3333-3333-3333-333333333333';

function user(over: Partial<RequestUser> = {}): RequestUser {
  return { id: 'u1', email: 'u1@example.com', status: 'ACTIVE', roles: ['CUSTOMER'], sellers: [], ...over };
}

describe('requireSeller / x-seller-id', () => {
  const u = user({ sellers: [OWNED, MEMBER_OF] });
  it('defaults to the first store', () => expect(requireSeller(u).id).toBe(OWNED.id));
  it('accepts a store the user belongs to', () => expect(requireSeller(u, MEMBER_OF.id).id).toBe(MEMBER_OF.id));
  it('rejects a store the user does not belong to', () => expect(() => requireSeller(u, OTHER)).toThrow());
  it('rejects users without a store', () => expect(() => requireSeller(user())).toThrow());
});

describe('requireSellerOwner', () => {
  const u = user({ sellers: [OWNED, MEMBER_OF] });
  it('lets the owner through', () => expect(requireSellerOwner(u, OWNED.id).id).toBe(OWNED.id));
  it('blocks a team member', () => expect(() => requireSellerOwner(u, MEMBER_OF.id)).toThrow(/propietario/));
  it('blocks a foreign store', () => expect(() => requireSellerOwner(u, OTHER)).toThrow());
});

describe('AuthGuard role checks', () => {
  function ctx(meta: { isPublic?: boolean; roles?: RoleCode[] }, reqUser?: RequestUser) {
    const reflector = { getAllAndOverride: (key: string) => (key === IS_PUBLIC ? meta.isPublic : key === ROLES ? meta.roles : undefined) } as unknown as Reflector;
    const guard = new AuthGuard(reflector, {} as any);
    const req: any = { headers: {}, user: reqUser };
    const ec = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null } as unknown as ExecutionContext;
    return guard.canActivate(ec);
  }
  it('requires a session on non-public routes', async () => expect(ctx({})).rejects.toThrow(/iniciar sesión/));
  it('allows public routes without a session', async () => expect(ctx({ isPublic: true })).resolves.toBe(true));
  it('blocks a customer on a staff route', async () => expect(ctx({ roles: ['MODERATOR'] }, user())).rejects.toThrow());
  it('blocks support on an admin route', async () => expect(ctx({ roles: ['ADMIN'] }, user({ roles: ['SUPPORT'] }))).rejects.toThrow());
  it('lets the named role through', async () => expect(ctx({ roles: ['SUPPORT'] }, user({ roles: ['SUPPORT'] }))).resolves.toBe(true));
  it('lets ADMIN through staff routes', async () => expect(ctx({ roles: ['MODERATOR'] }, user({ roles: ['ADMIN'] }))).resolves.toBe(true));
  it('keeps SUPER_ADMIN routes from ADMIN', async () => expect(ctx({ roles: ['SUPER_ADMIN'] }, user({ roles: ['ADMIN'] }))).rejects.toThrow());
  it('blocks suspended accounts', async () => expect(ctx({}, user({ status: 'SUSPENDED' }))).rejects.toThrow(/restringida/));
});

describe('seller money endpoints are owner-only', () => {
  const service = new Proxy({}, { get: () => jest.fn().mockResolvedValue({ ok: true }) }) as any;
  const ctrl = new SellerController(service, service, service, service, service);
  const schedules = new PayoutSchedulesController(service);
  const member = user({ sellers: [MEMBER_OF] });
  const owner = user({ sellers: [OWNED] });
  const dto: any = {};

  it.each([
    ['addPayoutAccount', (u: RequestUser, h: string) => ctrl.addPayoutAccount(u, dto, h)],
    ['updatePayoutAccount', (u: RequestUser, h: string) => ctrl.updatePayoutAccount(u, OTHER, dto, h)],
    ['requestPayout', (u: RequestUser, h: string) => ctrl.requestPayout(u, dto, h)],
    ['cancelPayout', (u: RequestUser, h: string) => ctrl.cancelPayout(u, OTHER, h)],
    ['schedule.set', (u: RequestUser, h: string) => schedules.set(u, dto, h)],
  ])('%s', async (_name, call) => {
    expect(() => call(member, MEMBER_OF.id)).toThrow(/propietario/);
    await expect(call(owner, OWNED.id)).resolves.toBeDefined();
  });

  it('members can still see payout accounts and orders', async () => {
    await expect(ctrl.payoutAccounts(member, MEMBER_OF.id)).resolves.toBeDefined();
  });
});

describe('seller team areas', () => {
  const service = new Proxy({}, { get: () => jest.fn().mockResolvedValue({ ok: true }) }) as any;
  const ctrl = new SellerController(service, service, service, service, service);
  const team = new TeamController(service);
  const member = user({ sellers: [MEMBER_OF] });
  const owner = user({ sellers: [OWNED] });

  it('lets a member use the areas they were given', async () => {
    await expect(ctrl.ordersList(member, {}, MEMBER_OF.id)).resolves.toBeDefined();
    expect(sellerCan(member, MEMBER_OF.id, 'ORDERS')).toBe(true);
  });
  it('blocks a member from areas they were not given', () => {
    expect(() => ctrl.products(member, {}, MEMBER_OF.id)).toThrow(/permiso/);
    expect(() => ctrl.updateStoreDestinations(member, { mode: 'ALL' }, MEMBER_OF.id)).toThrow(/permiso/);
    expect(() => ctrl.updateProductDestinations(member, OTHER, { mode: 'ALL' }, MEMBER_OF.id)).toThrow(/permiso/);
    expect(() => ctrl.updateStoreDestinations(owner, { mode: 'ALL' }, OTHER)).toThrow();
    expect(() => requireSeller(member, MEMBER_OF.id, 'SETTINGS')).toThrow(/permiso/);
    expect(sellerCan(member, MEMBER_OF.id, 'MESSAGES')).toBe(false);
    expect(sellerCan(member, OTHER, 'ORDERS')).toBe(false);
  });
  it('owners have every area', () => {
    for (const a of SELLER_AREAS) expect(requireSeller(owner, OWNED.id, a).id).toBe(OWNED.id);
  });
  it('only the owner manages the team', async () => {
    expect(() => team.list(member, MEMBER_OF.id)).toThrow(/propietario/);
    expect(() => team.invite(member, { email: 'x@example.com', areas: ['ORDERS'] }, MEMBER_OF.id)).toThrow(/propietario/);
    await expect(team.list(owner, OWNED.id)).resolves.toBeDefined();
  });
  it('keeps only known areas', () => expect(cleanAreas(['ORDERS', 'ADMIN', 'PRODUCTS', 1])).toEqual(['PRODUCTS', 'ORDERS']));
});
