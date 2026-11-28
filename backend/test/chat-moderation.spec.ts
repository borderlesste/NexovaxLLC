jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
import { ChatModerationService } from '../src/messaging/chat-moderation.service';
import { normalizeSecurityControls } from '../src/common/security-controls';

// Chat reports, blocks and messaging restrictions (2026-11-28).
describe('chat moderation', () => {
  const buyer = { id: 'buyer', email: 'b@x', status: 'ACTIVE', roles: ['CUSTOMER'], sellers: [] } as any;
  const seller = { id: 'owner', email: 'o@x', status: 'ACTIVE', roles: ['CUSTOMER'], sellers: [{ id: 'store', slug: 's', status: 'ACTIVE', isOwner: true, areas: [] }] } as any;
  const moderator = { id: 'mod', email: 'm@x', status: 'ACTIVE', roles: ['MODERATOR'], sellers: [] } as any;
  const conv = { id: 'c1', seller_id: 'store', requester_user_id: 'buyer', conversation_type: 'PRODUCT_INQUIRY' };

  function svc(o: { ready?: boolean; restricted?: boolean; blocks?: string[]; reportsToday?: number; openReporters?: number; inserted?: boolean; message?: any; openReports?: number } = {}) {
    const exec = jest.fn(async () => 1);
    const one = jest.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) return { n: o.ready === false ? 0 : 4 };
      if (sql.includes('from public.nx_messaging_restrictions where user_id')) return o.restricted ? { id: 'r1', ends_at: '2026-12-05T00:00:00Z' } : null;
      if (sql.includes('from public.conversations where id')) return conv;
      if (sql.includes('from public.conversation_messages where id = $1 and conversation_id')) return o.message === undefined ? { id: 'm1', sender_user_id: 'owner', status: 'SENT' } : o.message;
      if (sql.includes('from public.conversation_messages where id = $1')) return { id: 'm1', sender_user_id: 'owner' };
      if (sql.includes("created_at > now() - interval '1 day'")) return { n: o.reportsToday ?? 0 };
      if (sql.includes('insert into public.nx_message_reports')) return o.inserted === false ? null : { id: 'rep' };
      if (sql.includes('count(distinct reporter_user_id)')) return { n: o.openReporters ?? 1 };
      if (sql.includes('insert into public.nx_message_moderation')) return { message_id: 'm1' };
      if (sql.includes('insert into public.nx_messaging_restrictions')) return { ends_at: '2026-12-05T00:00:00Z' };
      return null;
    });
    const many = jest.fn(async (sql: string) => {
      if (sql.includes('from public.nx_chat_blocks')) return (o.blocks ?? []).map((b) => ({ blocked_by: b }));
      if (sql.includes("status = 'OPEN' order by created_at for update")) return Array.from({ length: o.openReports ?? 1 }, (_, i) => ({ id: `rep${i}` }));
      return [];
    });
    const db = { one, many, exec, tx: jest.fn(async (fn: any) => fn({})) };
    const settings = { get: jest.fn(async () => normalizeSecurityControls({})) };
    const notifications = { notify: jest.fn(async () => undefined) };
    const s = new ChatModerationService(db as any, settings as any, notifications as any);
    // Skip the detail() read after a decision: it is plain SQL.
    jest.spyOn(s, 'detail').mockResolvedValue({} as any);
    return { s, db, notifications };
  }

  it('refuses messages from a restricted account and between blocked parties', async () => {
    await expect(svc({ restricted: true }).s.assertCanSend(buyer, 'store', 'buyer')).rejects.toMatchObject({ code: 'MESSAGING_RESTRICTED' });
    await expect(svc({ blocks: ['SELLER'] }).s.assertCanSend(buyer, 'store', 'buyer')).rejects.toMatchObject({ code: 'CHAT_BLOCKED', message: expect.stringMatching(/No puedes enviar/) });
    await expect(svc({ blocks: ['SELLER'] }).s.assertCanSend(seller, 'store', 'buyer')).rejects.toMatchObject({ code: 'CHAT_BLOCKED', message: expect.stringMatching(/Bloqueaste/) });
    await expect(svc().s.assertCanSend(buyer, 'store', 'buyer')).resolves.toBeUndefined();
  });

  it('keeps chat working when the migration has not run yet', async () => {
    await expect(svc({ ready: false, restricted: true, blocks: ['SELLER'] }).s.assertCanSend(buyer, 'store', 'buyer')).resolves.toBeUndefined();
    await expect(svc({ ready: false }).s.report(buyer, 'c1', 'm1', 'SPAM')).rejects.toMatchObject({ code: 'CHAT_MODERATION_UNAVAILABLE' });
    expect((await svc({ ready: false }).s.hiddenIds(['m1'])).size).toBe(0);
  });

  it('moderators writing in a conversation are not blocked', async () => {
    await expect(svc({ restricted: true, blocks: ['CUSTOMER'] }).s.assertCanSend(moderator, 'store', 'buyer')).resolves.toBeUndefined();
  });

  it('a participant can report the other side, not their own messages', async () => {
    await expect(svc().s.report(buyer, 'c1', 'm1', 'FRAUD', 'pide pagar fuera')).resolves.toEqual({ reported: true, hidden: false });
    await expect(svc({ message: { id: 'm1', sender_user_id: 'buyer', status: 'SENT' } }).s.report(buyer, 'c1', 'm1', 'SPAM')).rejects.toMatchObject({ code: 'REPORT_OWN_MESSAGE' });
    await expect(svc().s.report(moderator, 'c1', 'm1', 'SPAM')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('limits reports per day and hides a message after enough distinct reports (from settings)', async () => {
    await expect(svc({ reportsToday: 20 }).s.report(buyer, 'c1', 'm1', 'SPAM')).rejects.toMatchObject({ code: 'REPORT_LIMIT' });
    expect(await svc({ openReporters: 3 }).s.report(buyer, 'c1', 'm1', 'SPAM')).toEqual({ reported: true, hidden: true });
    expect(await svc({ openReporters: 2 }).s.report(buyer, 'c1', 'm1', 'SPAM')).toEqual({ reported: true, hidden: false });
    // A repeated report from the same person changes nothing.
    expect(await svc({ inserted: false, openReporters: 9 }).s.report(buyer, 'c1', 'm1', 'SPAM')).toEqual({ reported: true, hidden: false });
  });

  it('resolving: a note is required to act, restriction days come from settings and the sender is told', async () => {
    await expect(svc().s.resolve(moderator, 'm1', 'HIDE_MESSAGE')).rejects.toMatchObject({ code: 'NOTE_REQUIRED' });
    const { s, db, notifications } = svc();
    await s.resolve(moderator, 'm1', 'HIDE_AND_RESTRICT', 'acoso');
    expect(db.one).toHaveBeenCalledWith(expect.stringContaining('insert into public.nx_messaging_restrictions'), ['owner', 'acoso', 'rep0', 7, 'mod'], {});
    expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('insert into public.nx_message_moderation'), ['m1', true, 'mod', 'acoso'], {});
    expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('update public.nx_message_reports'), ['m1', 'ACTION_TAKEN', 'HIDE_AND_RESTRICT', 'acoso', 'mod'], {});
    await new Promise((r) => setImmediate(r));
    expect(notifications.notify).toHaveBeenCalledWith('owner', expect.objectContaining({ eventType: 'MESSAGING_RESTRICTED' }));
  });

  it('dismissing keeps the message visible and needs open reports', async () => {
    const { s, db } = svc();
    await s.resolve(moderator, 'm1', 'DISMISS');
    expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('insert into public.nx_message_moderation'), ['m1', false, 'mod', null], {});
    await expect(svc({ openReports: 0 }).s.resolve(moderator, 'm1', 'DISMISS')).rejects.toMatchObject({ code: 'REPORT_ALREADY_RESOLVED' });
  });

  it('chat limits are clamped to a safe range', () => {
    const d = normalizeSecurityControls({});
    expect([d.chatReportsPerDay, d.chatReportsToAutoHide, d.chatRestrictionDays]).toEqual([20, 3, 7]);
    expect(normalizeSecurityControls({ chatReportsToAutoHide: 1 }).chatReportsToAutoHide).toBe(2);
  });
});
