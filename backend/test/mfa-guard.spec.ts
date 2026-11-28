jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
import { MfaGuard } from '../src/auth/mfa.guard';
import { REQUIRE_MFA, ROLES } from '../src/auth/auth';

// Two-step verification on team routes and store money routes (2026-11-28).
describe('MfaGuard', () => {
  const ctx = (user: any) => ({
    getType: () => 'http', getHandler: () => 'h', getClass: () => 'c',
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as any;
  const guard = (meta: Record<string, unknown>, settings: Record<string, unknown> = {}) =>
    new MfaGuard({ getAllAndOverride: (k: string) => meta[k] } as any, { get: async (k: string) => settings[k] ?? true } as any);
  const admin = (aal: string) => ({ id: 'a', roles: ['ADMIN'], sellers: [], aal });
  const owner = (aal: string) => ({ id: 's', roles: ['CUSTOMER'], sellers: [{ id: 'x', isOwner: true }], aal });

  it('asks staff for the second factor on team routes', async () => {
    await expect(guard({ [ROLES]: ['ADMIN'] }).canActivate(ctx(admin('aal1')))).rejects.toMatchObject({ code: 'MFA_REQUIRED' });
    await expect(guard({ [ROLES]: ['ADMIN'] }).canActivate(ctx(admin('aal2')))).resolves.toBe(true);
  });

  it('asks store owners for it on payout routes only', async () => {
    await expect(guard({ [REQUIRE_MFA]: true }).canActivate(ctx(owner('aal1')))).rejects.toMatchObject({ code: 'MFA_REQUIRED' });
    await expect(guard({}).canActivate(ctx(owner('aal1')))).resolves.toBe(true);
  });

  it('follows the admin switches', async () => {
    await expect(guard({ [ROLES]: ['ADMIN'] }, { 'features.mfa_staff_required': false }).canActivate(ctx(admin('aal1')))).resolves.toBe(true);
    await expect(guard({ [REQUIRE_MFA]: true }, { 'features.mfa_seller_payouts_required': false }).canActivate(ctx(owner('aal1')))).resolves.toBe(true);
  });

  it('leaves anonymous and public requests to the auth guard', async () => {
    await expect(guard({ [ROLES]: ['ADMIN'] }).canActivate(ctx(undefined))).resolves.toBe(true);
  });
});
