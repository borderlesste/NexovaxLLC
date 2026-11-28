jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
import { CouponsService } from '../src/promotions/coupons.service';
import { normalizeSecurityControls } from '../src/common/security-controls';

// Business-logic abuse and TOCTOU guards (audit 2026-11-28).
describe('coupon abuse guards', () => {
  const couponRow = (over: Record<string, unknown> = {}) => ({
    id: 'code-1', code: 'OFERTAABCDE', status: 'ACTIVE', starts_at: null, ends_at: null, max_redemptions: null, max_redemptions_per_customer: 1,
    group_id: 'g', seller_id: 'seller', group_status: 'ACTIVE', version_id: 'v', conditions: { recipientsOnly: true },
    benefit_type: 'PERCENTAGE_DISCOUNT', rate: '0.200000', fixed_amount: null, max_discount: null, funding_source_code: 'SELLER', used: 0, used_by_me: 0,
    ...over,
  });
  const line = { key: 'l1', sellerId: 'seller', productId: 'p1', gross: 1000n };

  function svc(opts: { invited?: boolean; row?: any; failures?: number } = {}) {
    const db = {
      one: jest.fn(async (sql: string) => {
        if (sql.includes('nx_offer_recipients')) return opts.invited ? { '?column?': 1 } : null;
        if (sql.includes('nx_coupon_failed_attempts')) return { n: opts.failures ?? 0 };
        if (sql.includes('from public.promotion_codes pc')) return opts.row === undefined ? couponRow() : opts.row;
        return null;
      }),
      exec: jest.fn(async () => 1),
      many: jest.fn(async () => []),
    };
    const settings = { get: jest.fn(async () => normalizeSecurityControls({})), currency: jest.fn(async () => 'USD') };
    return { s: new CouponsService(db as any, settings as any), db };
  }

  it('a personal offer coupon only applies to the buyers the store sent it to', async () => {
    const outsider = await svc({ invited: false }).s.evaluate(['ofertaabcde'], [line], 'stranger');
    expect(outsider.results).toHaveLength(0);
    expect(outsider.errors[0].message).toMatch(/oferta personal/);
    const invited = await svc({ invited: true }).s.evaluate(['OFERTAABCDE'], [line], 'buyer');
    expect(invited.results[0].discount).toBe(200n);
  });

  it('unknown codes are marked so guessing can be limited', async () => {
    const r = await svc({ row: null }).s.evaluate(['NOPE123'], [line], 'buyer');
    expect(r.errors).toEqual([{ code: 'NOPE123', message: 'El cupón no existe.', unknown: true }]);
  });

  it('refuses coupons after too many unknown codes in an hour (limit from settings)', async () => {
    await expect(svc({ failures: 10 }).s.guardAttempts('buyer', ['ANY'])).rejects.toMatchObject({ code: 'COUPON_ATTEMPTS_EXCEEDED' });
    await expect(svc({ failures: 9 }).s.guardAttempts('buyer', ['ANY'])).resolves.toBeUndefined();
    // No coupon typed: nothing to limit.
    const { s, db } = svc({ failures: 99 });
    await expect(s.guardAttempts('buyer', [])).resolves.toBeUndefined();
    expect(db.one).not.toHaveBeenCalled();
  });

  it('records only unknown codes, once each', async () => {
    const { s, db } = svc();
    await s.recordFailures('buyer', [
      { code: 'A1B', unknown: true }, { code: 'A1B', unknown: true }, { code: 'LIMIT', message: 'x' } as any,
    ]);
    expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('insert into public.nx_coupon_failed_attempts'), ['buyer', ['A1B']]);
  });

  it('locks the typed codes in a fixed order inside the checkout transaction', async () => {
    const { s, db } = svc();
    const c = {} as any;
    await s.lockCodes([' zeta1 ', 'ALPHA1', 'alpha1', ''], c);
    expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('for update'), [['ALPHA1', 'ZETA1']], c);
    db.exec.mockClear();
    await s.lockCodes([], c);
    expect(db.exec).not.toHaveBeenCalled();
  });

  it('the coupon-guessing limit is clamped to a safe range', () => {
    expect(normalizeSecurityControls({}).couponFailedAttemptsPerHour).toBe(10);
    expect(normalizeSecurityControls({ couponFailedAttemptsPerHour: 0 }).couponFailedAttemptsPerHour).toBe(3);
    expect(normalizeSecurityControls({ couponFailedAttemptsPerHour: 1000 }).couponFailedAttemptsPerHour).toBe(50);
  });
});
