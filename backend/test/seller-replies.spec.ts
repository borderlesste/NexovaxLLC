jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
import { SellerRepliesService, isOpenAt, normalizeHours, shouldAutoReply } from '../src/messaging/seller-replies.service';
import { normalizeSecurityControls } from '../src/common/security-controls';

// Saved replies and automatic reply outside store hours (2026-11-28).
describe('store hours', () => {
  const weekdays = [1, 2, 3, 4, 5].map((day) => ({ day, open: '09:00', close: '18:00' }));
  // 2026-11-30 is a Monday.
  const at = (iso: string) => new Date(iso);

  it('reads the hours in the store time zone', () => {
    // 13:00 UTC = 08:00 in New York (closed) / 14:00 in Madrid (open).
    expect(isOpenAt(weekdays, 'America/New_York', at('2026-11-30T13:00:00Z'))).toBe(false);
    expect(isOpenAt(weekdays, 'Europe/Madrid', at('2026-11-30T13:00:00Z'))).toBe(true);
    // Saturday is closed; the closing minute is outside.
    expect(isOpenAt(weekdays, 'UTC', at('2026-11-28T12:00:00Z'))).toBe(false);
    expect(isOpenAt(weekdays, 'UTC', at('2026-11-30T18:00:00Z'))).toBe(false);
    expect(isOpenAt(weekdays, 'Not/AZone', at('2026-11-30T10:00:00Z'))).toBe(true);
  });

  it('validates the ranges', () => {
    expect(normalizeHours([{ day: 2, open: '14:00', close: '18:00' }, { day: 2, open: '08:00', close: '12:00' }]).map((h) => h.open)).toEqual(['08:00', '14:00']);
    expect(() => normalizeHours([{ day: 1, open: '18:00', close: '09:00' }])).toThrow(/posterior/);
    expect(() => normalizeHours([{ day: 1, open: '09:00', close: '13:00' }, { day: 1, open: '12:00', close: '15:00' }])).toThrow(/superponerse/);
    expect(() => normalizeHours([{ day: 7, open: '09:00', close: '13:00' }])).toThrow(/no es válido/);
  });

  it('answers only when enabled, with a message, and closed (or always)', () => {
    const base = { enabled: true, mode: 'OUTSIDE_HOURS' as const, message: 'Volvemos el lunes', hours: weekdays, timezone: 'UTC' };
    expect(shouldAutoReply(base, at('2026-11-28T12:00:00Z'))).toBe(true);
    expect(shouldAutoReply(base, at('2026-11-30T12:00:00Z'))).toBe(false);
    expect(shouldAutoReply({ ...base, mode: 'ALWAYS' }, at('2026-11-30T12:00:00Z'))).toBe(true);
    expect(shouldAutoReply({ ...base, enabled: false }, at('2026-11-28T12:00:00Z'))).toBe(false);
    expect(shouldAutoReply({ ...base, message: '  ' }, at('2026-11-28T12:00:00Z'))).toBe(false);
  });
});

describe('SellerRepliesService', () => {
  function svc(o: { count?: number; recent?: boolean; last?: string; conv?: any; ready?: boolean } = {}) {
    const exec = jest.fn(async () => 1);
    const one = jest.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) return { n: o.ready === false ? 0 : 3 };
      if (sql.includes('count(*)::int as n, coalesce(max(sort_order)')) return { n: o.count ?? 0, next: o.count ?? 0 };
      if (sql.includes('insert into public.nx_seller_saved_replies')) return { id: 'r1' };
      if (sql.includes('join public.nx_seller_auto_reply ar')) return o.conv === undefined
        ? { id: 'c1', seller_id: 's', requester_user_id: 'buyer', conversation_type: 'PRODUCT_INQUIRY', status: 'OPEN', owner_user_id: 'owner', enabled: true, mode: 'ALWAYS', message: 'Gracias, respondemos pronto', hours: [], timezone: 'UTC' }
        : o.conv;
      if (sql.includes('from public.nx_auto_reply_messages where conversation_id')) return o.recent ? { '?column?': 1 } : null;
      if (sql.includes('order by sequence_number desc limit 1')) return { sender_user_id: o.last ?? 'buyer' };
      if (sql.includes('from public.conversation_participants')) return { '?column?': 1 };
      if (sql.includes('send_conversation_message')) return { id: 'm9' };
      return null;
    });
    const db = { one, exec, many: jest.fn(async () => []), tx: jest.fn(async (fn: any) => fn({})) };
    const settings = { get: jest.fn(async () => normalizeSecurityControls({})) };
    return { s: new SellerRepliesService(db as any, settings as any), db };
  }

  it('limits saved replies per store (from settings)', async () => {
    await expect(svc({ count: 50 }).s.create('s', 'u', { title: 'Envío', body: 'Enviamos en 24 h' })).rejects.toMatchObject({ code: 'SAVED_REPLIES_LIMIT' });
    await expect(svc({ count: 3 }).s.create('s', 'u', { title: ' Envío ', body: 'Enviamos en 24 h' })).resolves.toEqual({ id: 'r1' });
  });

  it('sends the automatic reply once per interval, and not after the store answered', async () => {
    const { s, db } = svc();
    await expect(s.maybeAutoReply('c1')).resolves.toEqual({ senderId: 'owner', body: 'Gracias, respondemos pronto' });
    expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('insert into public.nx_auto_reply_messages'), ['m9', 'c1'], {});
    expect(db.one).toHaveBeenCalledWith(expect.stringContaining('make_interval(hours'), ['c1', 12], {});
    await expect(svc({ recent: true }).s.maybeAutoReply('c1')).resolves.toBeNull();
    await expect(svc({ last: 'owner' }).s.maybeAutoReply('c1')).resolves.toBeNull();
  });

  it('never answers when off, closed conversations or before the migration', async () => {
    await expect(svc({ conv: null }).s.maybeAutoReply('c1')).resolves.toBeNull();
    await expect(svc({ conv: { status: 'CLOSED', conversation_type: 'PRODUCT_INQUIRY', owner_user_id: 'o', requester_user_id: 'b', enabled: true, mode: 'ALWAYS', message: 'x' } }).s.maybeAutoReply('c1')).resolves.toBeNull();
    await expect(svc({ ready: false }).s.maybeAutoReply('c1')).resolves.toBeNull();
    await expect(svc({ ready: false }).s.list('s')).rejects.toMatchObject({ code: 'SELLER_REPLIES_UNAVAILABLE' });
  });

  it('limits are clamped to a safe range', () => {
    const d = normalizeSecurityControls({ autoReplyIntervalHours: 0, sellerSavedRepliesMax: 9999 });
    expect([d.autoReplyIntervalHours, d.sellerSavedRepliesMax]).toEqual([1, 200]);
  });
});
