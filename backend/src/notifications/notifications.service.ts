import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { badRequest } from '../common/errors';

export type NotificationCategory = 'ORDERS' | 'MESSAGES' | 'RETURNS' | 'PAYMENTS' | 'SUPPORT' | 'STORE' | 'ACCOUNT';
export type Channel = 'IN_APP' | 'EMAIL';

export interface NoticeInput {
  category: NotificationCategory;
  eventType: string;
  title: string;
  body?: string | null;
  /** Absolute or site-relative link opened from the bell. */
  url?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey?: string | null;
}

/** E-mail template → notification category (anything not listed is ACCOUNT, always delivered). */
const TEMPLATE_CATEGORY: [RegExp, NotificationCategory][] = [
  [/^(ORDER_|SELLER_NEW_ORDER|SELLER_ORDER_DELIVERED)/, 'ORDERS'],
  [/^(BANK_TRANSFER_|PAYOUT_)/, 'PAYMENTS'],
  [/^(RETURN_|REFUND_)/, 'RETURNS'],
  [/^SUPPORT_/, 'SUPPORT'],
  [/^(SELLER_APPROVE|SELLER_REJECT|SELLER_SUSPEND|SELLER_REACTIVATE|SELLER_APPLICATION_RECEIVED|PRODUCT_)/, 'STORE'],
  [/^MESSAGE_/, 'MESSAGES'],
];
/** Security mail that never becomes a bell notice (links must stay in the inbox only). */
const NO_IN_APP = new Set(['EMAIL_VERIFICATION', 'PASSWORD_RECOVERY']);

export const categoryForTemplate = (template: string): NotificationCategory =>
  TEMPLATE_CATEGORY.find(([re]) => re.test(template))?.[1] ?? 'ACCOUNT';

/**
 * In-app notification center (bell) and per-category channel preferences.
 * Preferences default to "on"; ACCOUNT notices cannot be turned off.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(private readonly db: DbService) {}

  async enabled(userId: string, category: NotificationCategory, channel: Channel) {
    if (category === 'ACCOUNT') return true;
    const r = await this.db.one<{ enabled: boolean }>(
      `select enabled from public.notification_preferences where user_id = $1 and category_code = $2 and channel_code = $3`,
      [userId, category, channel],
    );
    return r?.enabled ?? true;
  }

  /** Creates a bell notice; never throws (notifications must not break the business operation). */
  async notify(userId: string | null | undefined, n: NoticeInput) {
    if (!userId) return;
    try {
      if (!(await this.enabled(userId, n.category, 'IN_APP'))) return;
      const url = n.url ? n.url.replace(/^https?:\/\/[^/]+/, '') || '/' : null;
      await this.db.exec(
        `insert into public.notifications (user_id, category_code, event_type, entity_type, entity_id, deduplication_key, title, body, payload, status, visible_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'VISIBLE',now())
         on conflict (user_id, deduplication_key) where deduplication_key is not null do nothing`,
        [userId, n.category, n.eventType, n.entityType ?? null, n.entityId ?? null, n.dedupeKey ?? null, n.title.slice(0, 200), n.body?.trim() ? n.body.trim().slice(0, 600) : null, JSON.stringify(url ? { url } : {})],
      );
    } catch (e: any) {
      this.logger.warn(`notify ${n.eventType}: ${e?.message}`);
    }
  }

  /** Bell notice that mirrors a transactional e-mail (same language, title and link). */
  fromEmail(userId: string | null | undefined, template: string, dedupeKey: string, m: { title?: string; preheader?: string; url?: string }, entity?: { type?: string | null; id?: string | null }) {
    if (!userId || NO_IN_APP.has(template) || !m.title) return Promise.resolve();
    return this.notify(userId, {
      category: categoryForTemplate(template),
      eventType: template,
      title: m.title,
      body: m.preheader,
      url: m.url,
      entityType: entity?.type,
      entityId: entity?.id,
      dedupeKey: `mail:${dedupeKey}`.slice(0, 300),
    });
  }

  /** One unread notice per conversation: new messages refresh it instead of stacking up. */
  async message(userId: string, conversationId: string, title: string, body: string, url: string) {
    try {
      if (!(await this.enabled(userId, 'MESSAGES', 'IN_APP'))) return;
      const upd = await this.db.one(
        `update public.notifications set title = $3, body = $4, visible_at = now(), updated_at = now()
          where user_id = $1 and entity_type = 'CONVERSATION' and entity_id = $2 and status = 'VISIBLE' returning id`,
        [userId, conversationId, title.slice(0, 200), body.slice(0, 600)],
      );
      if (!upd)
        await this.notify(userId, { category: 'MESSAGES', eventType: 'MESSAGE_RECEIVED', title, body, url, entityType: 'CONVERSATION', entityId: conversationId });
    } catch (e: any) {
      this.logger.warn(`notify message: ${e?.message}`);
    }
  }

  async list(userId: string, q: { unread?: boolean; category?: string; before?: string; limit?: number }) {
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 50);
    const params: unknown[] = [userId];
    let where = `user_id = $1 and status in ('VISIBLE','READ')`;
    if (q.unread) where += ` and status = 'VISIBLE'`;
    if (q.category) {
      params.push(q.category);
      where += ` and category_code = $${params.length}`;
    }
    if (q.before) {
      params.push(q.before);
      where += ` and visible_at < $${params.length}::timestamptz`;
    }
    const rows = await this.db.many(
      `select id, category_code as category, event_type as "eventType", title, body, payload->>'url' as url, status, visible_at as "createdAt", read_at as "readAt"
         from public.notifications where ${where} order by visible_at desc, id desc limit ${limit + 1}`,
      params,
    );
    return { items: rows.slice(0, limit).map((r: any) => ({ ...r, read: r.status === 'READ' })), hasMore: rows.length > limit, unread: await this.unreadCount(userId) };
  }

  async unreadCount(userId: string) {
    const r = await this.db.one<{ n: number }>(`select count(*)::int as n from public.notifications where user_id = $1 and status = 'VISIBLE'`, [userId]);
    return r?.n ?? 0;
  }

  async markRead(userId: string, ids: string[] | 'ALL') {
    if (ids === 'ALL')
      await this.db.exec(`update public.notifications set status = 'READ', read_at = now() where user_id = $1 and status = 'VISIBLE'`, [userId]);
    else if (ids.length)
      await this.db.exec(`update public.notifications set status = 'READ', read_at = now() where user_id = $1 and status = 'VISIBLE' and id = any($2::uuid[])`, [userId, ids]);
    return { unread: await this.unreadCount(userId) };
  }

  async dismiss(userId: string, id: string) {
    await this.db.exec(`update public.notifications set status = 'DISMISSED', dismissed_at = now() where user_id = $1 and id = $2 and status in ('VISIBLE','READ')`, [userId, id]);
    return { unread: await this.unreadCount(userId) };
  }

  async preferences(userId: string) {
    const rows = await this.db.many(
      `select c.code, c.name, c.description, c.user_configurable as configurable,
              coalesce((select p.enabled from public.notification_preferences p where p.user_id = $1 and p.category_code = c.code and p.channel_code = 'IN_APP'), true) as in_app,
              coalesce((select p.enabled from public.notification_preferences p where p.user_id = $1 and p.category_code = c.code and p.channel_code = 'EMAIL'), true) as email
         from public.notification_categories c where c.is_active
        order by array_position(array['ORDERS','MESSAGES','RETURNS','PAYMENTS','SUPPORT','STORE','ACCOUNT'], c.code::text)`,
      [userId],
    );
    return rows.map((r: any) => ({ code: r.code, name: r.name, description: r.description, configurable: r.configurable, inApp: r.configurable ? r.in_app : true, email: r.configurable ? r.email : true }));
  }

  async setPreferences(userId: string, prefs: { code: string; inApp?: boolean; email?: boolean }[]) {
    const cats = new Map((await this.db.many(`select code, user_configurable from public.notification_categories where is_active`)).map((c: any) => [c.code, c.user_configurable]));
    const cats_: string[] = [], chans: string[] = [], vals: boolean[] = [];
    for (const p of prefs) {
      if (!cats.has(p.code)) throw badRequest('CATEGORY_INVALID', 'Categoría de notificación no válida.');
      if (!cats.get(p.code)) continue;
      for (const [channel, value] of [['IN_APP', p.inApp], ['EMAIL', p.email]] as const)
        if (typeof value === 'boolean') (cats_.push(p.code), chans.push(channel), vals.push(value));
    }
    if (cats_.length)
      await this.db.exec(
        `insert into public.notification_preferences (user_id, category_code, channel_code, enabled)
         select $1, x.c, x.ch, x.v from unnest($2::text[], $3::text[], $4::boolean[]) as x(c, ch, v)
         on conflict (user_id, category_code, channel_code) do update set enabled = excluded.enabled`,
        [userId, cats_, chans, vals],
      );
    return this.preferences(userId);
  }
}
