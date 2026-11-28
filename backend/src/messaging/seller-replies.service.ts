import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { AppError, badRequest, notFound } from '../common/errors';
import { SettingsService } from '../settings/settings.service';

export type HoursRange = { day: number; open: string; close: string };
export type AutoReplyMode = 'OUTSIDE_HOURS' | 'ALWAYS';
export interface AutoReplySettings { enabled: boolean; mode: AutoReplyMode; message: string; hours: HoursRange[]; timezone: string }

const TABLES = ['nx_seller_saved_replies', 'nx_seller_auto_reply', 'nx_auto_reply_messages'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Validates and sorts a store's opening hours (0 = Sunday). A day without ranges is closed. */
export function normalizeHours(v: unknown): HoursRange[] {
  if (!Array.isArray(v)) throw badRequest('HOURS_INVALID', 'El horario no es válido.');
  if (v.length > 21) throw badRequest('HOURS_INVALID', 'Puedes indicar hasta 3 tramos por día.');
  const out = v.map((r: any) => {
    const day = Number(r?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6 || !HHMM.test(r?.open ?? '') || !HHMM.test(r?.close ?? '')) throw badRequest('HOURS_INVALID', 'El horario no es válido.');
    if (minutes(r.open) >= minutes(r.close)) throw badRequest('HOURS_INVALID', 'La hora de cierre debe ser posterior a la de apertura.');
    return { day, open: r.open as string, close: r.close as string };
  });
  out.sort((a, b) => a.day - b.day || minutes(a.open) - minutes(b.open));
  for (let i = 1; i < out.length; i++)
    if (out[i].day === out[i - 1].day && minutes(out[i].open) < minutes(out[i - 1].close)) throw badRequest('HOURS_OVERLAP', 'Los tramos de un mismo día no pueden superponerse.');
  return out;
}

/** True when `at` falls inside the store's hours, read in the store's time zone. */
export function isOpenAt(hours: HoursRange[], timezone: string, at = new Date()) {
  let tz = timezone || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'UTC'; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map((p) => [p.type, p.value]));
  const day = WEEKDAY[parts.weekday as string];
  const now = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  return hours.some((h) => h.day === day && now >= minutes(h.open) && now < minutes(h.close));
}

/** Whether the automatic reply should answer right now. */
export function shouldAutoReply(s: Pick<AutoReplySettings, 'enabled' | 'mode' | 'message' | 'hours' | 'timezone'>, at = new Date()) {
  if (!s.enabled || !s.message.trim()) return false;
  return s.mode === 'ALWAYS' || !isOpenAt(s.hours, s.timezone, at);
}

/**
 * Seller reply tools: saved replies for the chat and an automatic reply when the store is closed
 * (or always, e.g. on vacation). Until migration 20261128120000 runs, saved replies answer «not
 * available yet» and no automatic reply is sent; the chat keeps working.
 */
@Injectable()
export class SellerRepliesService {
  private readonly logger = new Logger(SellerRepliesService.name);
  private readyAt = 0;
  private isReady = false;

  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
  ) {}

  async ready() {
    if (this.isReady || Date.now() - this.readyAt < 5 * 60_000) return this.isReady;
    this.readyAt = Date.now();
    try {
      const r = await this.db.one<{ n: number }>(`select count(*)::int as n from unnest($1::text[]) t where to_regclass('public.' || t) is not null`, [TABLES]);
      this.isReady = r?.n === TABLES.length;
    } catch (e: any) {
      this.logger.warn(`ready: ${e?.message}`);
    }
    return this.isReady;
  }

  private async requireReady() {
    if (!(await this.ready())) throw new AppError('SELLER_REPLIES_UNAVAILABLE', 'Esta función aún no está disponible. Inténtalo más tarde.', HttpStatus.SERVICE_UNAVAILABLE);
  }

  // ------------------------------------------------------------------ saved replies
  async list(sellerId: string) {
    await this.requireReady();
    const [rows, sc] = await Promise.all([
      this.db.many(`select id, title, body, sort_order, updated_at from public.nx_seller_saved_replies where seller_id = $1 order by sort_order, created_at`, [sellerId]),
      this.settings.get('security.controls'),
    ]);
    return { max: sc.sellerSavedRepliesMax, items: rows.map((r: any) => ({ id: r.id, title: r.title, body: r.body, sortOrder: r.sort_order, updatedAt: r.updated_at })) };
  }

  async create(sellerId: string, userId: string, input: { title: string; body: string }) {
    await this.requireReady();
    const sc = await this.settings.get('security.controls');
    const id = await this.db.tx(async (tx) => {
      await this.db.exec(`select pg_advisory_xact_lock(hashtext('nexovax:saved-replies:' || $1))`, [sellerId], tx);
      const n = await this.db.one<{ n: number; next: number }>(
        `select count(*)::int as n, coalesce(max(sort_order) + 1, 0)::int as next from public.nx_seller_saved_replies where seller_id = $1`,
        [sellerId],
        tx,
      );
      if ((n?.n ?? 0) >= sc.sellerSavedRepliesMax) throw badRequest('SAVED_REPLIES_LIMIT', 'Llegaste al máximo de respuestas guardadas. Borra alguna para crear otra.');
      const r = await this.db.one<{ id: string }>(
        `insert into public.nx_seller_saved_replies (seller_id, title, body, sort_order, created_by) values ($1,$2,$3,$4,$5) returning id`,
        [sellerId, input.title.trim(), input.body.trim(), n?.next ?? 0, userId],
        tx,
      );
      return r!.id;
    });
    return { id };
  }

  async update(sellerId: string, id: string, input: { title: string; body: string }) {
    await this.requireReady();
    const r = await this.db.one(
      `update public.nx_seller_saved_replies set title = $3, body = $4, updated_at = now() where id = $1 and seller_id = $2 returning id`,
      [id, sellerId, input.title.trim(), input.body.trim()],
    );
    if (!r) throw notFound('Respuesta');
    return { id };
  }

  async remove(sellerId: string, id: string) {
    await this.requireReady();
    const n = await this.db.exec(`delete from public.nx_seller_saved_replies where id = $1 and seller_id = $2`, [id, sellerId]);
    if (!n) throw notFound('Respuesta');
    return { deleted: true };
  }

  async reorder(sellerId: string, ids: string[]) {
    await this.requireReady();
    await this.db.exec(
      `update public.nx_seller_saved_replies r set sort_order = x.ord - 1, updated_at = now()
         from unnest($2::uuid[]) with ordinality as x(id, ord) where r.id = x.id and r.seller_id = $1`,
      [sellerId, ids],
    );
    return this.list(sellerId);
  }

  // ------------------------------------------------------------------ automatic reply
  private async storeTimezone(sellerId: string) {
    return (await this.db.one<{ timezone: string | null }>(`select timezone from public.seller_store_profiles where seller_id = $1`, [sellerId]))?.timezone || 'UTC';
  }

  async getAutoReply(sellerId: string): Promise<AutoReplySettings & { openNow: boolean; intervalHours: number }> {
    await this.requireReady();
    const [r, timezone, sc] = await Promise.all([
      this.db.one(`select enabled, mode, message, hours from public.nx_seller_auto_reply where seller_id = $1`, [sellerId]),
      this.storeTimezone(sellerId),
      this.settings.get('security.controls'),
    ]);
    const hours = (r?.hours ?? []) as HoursRange[];
    return { enabled: !!r?.enabled, mode: (r?.mode ?? 'OUTSIDE_HOURS') as AutoReplyMode, message: r?.message ?? '', hours, timezone, openNow: isOpenAt(hours, timezone), intervalHours: sc.autoReplyIntervalHours };
  }

  async setAutoReply(sellerId: string, userId: string, input: { enabled: boolean; mode: AutoReplyMode; message: string; hours: unknown }) {
    await this.requireReady();
    const hours = normalizeHours(input.hours ?? []);
    const message = (input.message ?? '').trim();
    if (input.enabled && !message) throw badRequest('AUTO_REPLY_MESSAGE_REQUIRED', 'Escribe el mensaje de la respuesta automática.');
    if (input.enabled && input.mode === 'OUTSIDE_HOURS' && !hours.length) throw badRequest('HOURS_REQUIRED', 'Indica al menos un horario de atención o elige «Responder siempre».');
    await this.db.exec(
      `insert into public.nx_seller_auto_reply (seller_id, enabled, mode, message, hours, updated_by, updated_at) values ($1,$2,$3,$4,$5::jsonb,$6,now())
       on conflict (seller_id) do update set enabled = excluded.enabled, mode = excluded.mode, message = excluded.message, hours = excluded.hours, updated_by = excluded.updated_by, updated_at = now()`,
      [sellerId, !!input.enabled, input.mode, message, JSON.stringify(hours), userId],
    );
    return this.getAutoReply(sellerId);
  }

  /** Ids of automatic replies among the given messages (to label them in the chat). */
  async autoReplyIds(messageIds: string[]) {
    if (!messageIds.length || !(await this.ready())) return new Set<string>();
    const rows = await this.db.many<{ message_id: string }>(`select message_id from public.nx_auto_reply_messages where message_id = any($1::uuid[])`, [messageIds]);
    return new Set(rows.map((r) => r.message_id));
  }

  /**
   * After a buyer writes to a store: sends the store's automatic reply when it is closed (or set to
   * always answer), at most once per conversation per interval. Returns the text sent, or null.
   * Never throws: an automatic reply must not break the buyer's message.
   */
  async maybeAutoReply(conversationId: string): Promise<{ senderId: string; body: string } | null> {
    try {
      if (!(await this.ready())) return null;
      const c = await this.db.one(
        `select c.id, c.seller_id, c.requester_user_id, c.conversation_type, c.status, s.owner_user_id, ar.enabled, ar.mode, ar.message, ar.hours, ssp.timezone
           from public.conversations c join public.sellers s on s.id = c.seller_id
           join public.nx_seller_auto_reply ar on ar.seller_id = c.seller_id
           left join public.seller_store_profiles ssp on ssp.seller_id = c.seller_id
          where c.id = $1`,
        [conversationId],
      );
      if (!c || c.status !== 'OPEN' || !['PRODUCT_INQUIRY', 'ORDER'].includes(c.conversation_type) || !c.owner_user_id || c.owner_user_id === c.requester_user_id) return null;
      if (!shouldAutoReply({ enabled: c.enabled, mode: c.mode, message: c.message ?? '', hours: c.hours ?? [], timezone: c.timezone || 'UTC' })) return null;
      const sc = await this.settings.get('security.controls');
      const sent = await this.db.tx(async (tx) => {
        // One automatic reply even when the buyer sends several messages at once.
        await this.db.exec(`select pg_advisory_xact_lock(hashtext('nexovax:auto-reply:' || $1))`, [conversationId], tx);
        const recent = await this.db.one(
          `select 1 from public.nx_auto_reply_messages where conversation_id = $1 and sent_at > now() - make_interval(hours => $2::int) limit 1`,
          [conversationId, sc.autoReplyIntervalHours],
          tx,
        );
        if (recent) return false;
        // The store already answered in the meantime: no automatic reply needed.
        const last = await this.db.one<{ sender_user_id: string }>(
          `select sender_user_id from public.conversation_messages where conversation_id = $1 and status = 'SENT' order by sequence_number desc limit 1`,
          [conversationId],
          tx,
        );
        if (last && last.sender_user_id !== c.requester_user_id) return false;
        const part = await this.db.one(`select 1 from public.conversation_participants where conversation_id = $1 and user_id = $2 and status = 'ACTIVE'`, [conversationId, c.owner_user_id], tx);
        if (!part) await this.db.exec(`select public.join_seller_conversation($1, $2)`, [conversationId, c.owner_user_id], tx);
        const msg = await this.db.one<{ id: string }>(`select public.send_conversation_message($1,$2,$3,null,$4,'{}'::jsonb) as id`, [conversationId, c.owner_user_id, c.message.trim(), randomUUID()], tx);
        await this.db.exec(`insert into public.nx_auto_reply_messages (message_id, conversation_id) values ($1,$2) on conflict do nothing`, [msg!.id, conversationId], tx);
        return true;
      });
      return sent ? { senderId: c.owner_user_id, body: c.message.trim() } : null;
    } catch (e: any) {
      this.logger.warn(`auto-reply ${conversationId}: ${e?.message}`);
      return null;
    }
  }
}
