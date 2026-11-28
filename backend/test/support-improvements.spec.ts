jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
import { ticketTimes } from '../src/support/support-times';
import { SupportService } from '../src/support/support.service';
import { normalizeSecurityControls } from '../src/common/security-controls';

// Support: assignment, ratings and response times that pause while waiting for the customer (2026-11-28).
describe('ticketTimes', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 28, h)).toISOString();

  it('does not count the time waiting for the customer', () => {
    const r = ticketTimes({ createdAt: at(0), firstResponseAt: at(1), status: 'RESOLVED' }, [
      { to: 'IN_PROGRESS', at: at(1) }, { to: 'PENDING_CUSTOMER', at: at(2) }, { to: 'IN_PROGRESS', at: at(7) }, { to: 'RESOLVED', at: at(8) },
    ]);
    expect(r).toEqual({ firstResponseMinutes: 60, resolutionMinutes: 180, workingMinutes: 180, waitingCustomerMinutes: 300 });
  });

  it('a reopened ticket is not resolved; open tickets count up to now', () => {
    const r = ticketTimes({ createdAt: at(0), status: 'IN_PROGRESS' }, [{ to: 'RESOLVED', at: at(2) }, { to: 'IN_PROGRESS', at: at(3) }], new Date(at(5)));
    expect(r.resolutionMinutes).toBeNull();
    expect(r.workingMinutes).toBe(300);
    expect(r.firstResponseMinutes).toBeNull();
  });

  it('resolved while waiting for the customer stops the clock at resolution', () => {
    const r = ticketTimes({ createdAt: at(0), status: 'CLOSED' }, [{ to: 'PENDING_CUSTOMER', at: at(1) }, { to: 'RESOLVED', at: at(4) }, { to: 'CLOSED', at: at(6) }]);
    expect(r.resolutionMinutes).toBe(60);
    expect(r.waitingCustomerMinutes).toBe(180);
  });
});

describe('support ratings', () => {
  function svc(o: { status?: string; owner?: string; recentResolution?: boolean } = {}) {
    const exec = jest.fn(async () => 1);
    const one = jest.fn(async (sql: string) => {
      if (sql.includes('select id, status, requester_user_id, current_assignee_user_id')) return { id: 't1', status: o.status ?? 'RESOLVED', requester_user_id: o.owner ?? 'buyer', current_assignee_user_id: 'agent' };
      if (sql.includes('support_ticket_status_history where ticket_id = $1 and to_status')) return o.recentResolution === false ? null : { '?column?': 1 };
      return null;
    });
    const db = { one, exec, many: jest.fn(async () => []), tx: jest.fn(async (fn: any) => fn({})) };
    const settings = { get: jest.fn(async () => normalizeSecurityControls({})) };
    const s = new SupportService(db as any, {} as any, {} as any, {} as any, settings as any);
    jest.spyOn(s, 'customerDetail').mockResolvedValue({} as any);
    return { s, db, settings };
  }
  const buyer = { id: 'buyer', roles: ['CUSTOMER'], sellers: [] } as any;

  it('the requester rates a resolved report; the agent is remembered', async () => {
    const { s, db } = svc();
    await s.rate(buyer, 't1', 5, ' ¡Rápido! ');
    expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('insert into public.nx_support_ticket_ratings'), ['t1', 'buyer', 5, '¡Rápido!', 'agent']);
  });

  it('refuses other people, open reports and old resolutions (days from settings)', async () => {
    await expect(svc({ owner: 'someone' }).s.rate(buyer, 't1', 4)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc({ status: 'IN_PROGRESS' }).s.rate(buyer, 't1', 4)).rejects.toMatchObject({ code: 'RATING_CLOSED' });
    const { s, db } = svc({ recentResolution: false });
    await expect(s.rate(buyer, 't1', 4)).rejects.toMatchObject({ code: 'RATING_CLOSED' });
    expect(db.one).toHaveBeenCalledWith(expect.stringContaining('make_interval(days'), ['t1', 14]);
  });
});
