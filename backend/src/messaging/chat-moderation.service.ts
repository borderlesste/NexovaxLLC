import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AppError, badRequest, forbidden, notFound } from '../common/errors';
import { RequestUser, isStaff, sellerCan } from '../auth/auth';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { config } from '../config';

export const REPORT_REASONS = ['SPAM', 'HARASSMENT', 'FRAUD', 'OFF_PLATFORM', 'INAPPROPRIATE', 'OTHER'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_ACTIONS = ['DISMISS', 'HIDE_MESSAGE', 'RESTRICT_USER', 'HIDE_AND_RESTRICT'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

/** Text shown instead of a message hidden by moderation (translated by the API's i18n layer on the web). */
export const HIDDEN_MESSAGE_TEXT = 'Mensaje oculto por moderación';

const TABLES = ['nx_message_reports', 'nx_message_moderation', 'nx_chat_blocks', 'nx_messaging_restrictions'];

/**
 * Chat reports and moderation: report a message, block the other side of a conversation, and the
 * moderators' queue (hide a message, stop an account from sending messages for some days).
 *
 * Until migration 20261128100000 runs, the tables don't exist: chat keeps working as before and the
 * new actions answer «not available yet» (ready() is re-checked every few minutes).
 */
@Injectable()
export class ChatModerationService {
  private readonly logger = new Logger(ChatModerationService.name);
  private readyAt = 0;
  private isReady = false;

  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
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
    if (!(await this.ready())) throw new AppError('CHAT_MODERATION_UNAVAILABLE', 'Esta función aún no está disponible. Inténtalo más tarde.', HttpStatus.SERVICE_UNAVAILABLE);
  }

  private async controls() {
    return this.settings.get('security.controls');
  }

  // ------------------------------------------------------------------ sending guard
  /** Active messaging restriction of an account, if any. */
  async restriction(userId: string) {
    if (!(await this.ready())) return null;
    return this.db.one<{ id: string; ends_at: string }>(
      `select id, ends_at from public.nx_messaging_restrictions where user_id = $1 and lifted_at is null and ends_at > now() order by ends_at desc limit 1`,
      [userId],
    );
  }

  /** Blocks between a store and a buyer: who blocked whom. */
  async blocks(sellerId: string | null, customerId: string) {
    if (!sellerId || !(await this.ready())) return { byCustomer: false, bySeller: false };
    const rows = await this.db.many<{ blocked_by: string }>(`select blocked_by from public.nx_chat_blocks where seller_id = $1 and customer_user_id = $2`, [sellerId, customerId]);
    return { byCustomer: rows.some((r) => r.blocked_by === 'CUSTOMER'), bySeller: rows.some((r) => r.blocked_by === 'SELLER') };
  }

  /** Refuses a new message when the sender is restricted or either side blocked the other. Staff are exempt. */
  async assertCanSend(user: RequestUser, sellerId: string | null, customerId: string) {
    if (isStaff(user, 'MODERATOR', 'SUPPORT') && user.id !== customerId && !(sellerId && sellerCan(user, sellerId, 'MESSAGES'))) return;
    if (!(await this.ready())) return;
    const r = await this.restriction(user.id);
    if (r)
      throw new AppError('MESSAGING_RESTRICTED', 'Tu cuenta no puede enviar mensajes por ahora por una decisión de moderación.', HttpStatus.FORBIDDEN, { until: r.ends_at });
    const b = await this.blocks(sellerId, customerId);
    if (b.byCustomer || b.bySeller) {
      const mine = user.id === customerId ? b.byCustomer : b.bySeller;
      throw new AppError(
        'CHAT_BLOCKED',
        mine ? 'Bloqueaste esta conversación. Desbloquéala para volver a escribir.' : 'No puedes enviar mensajes en esta conversación.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // ------------------------------------------------------------------ participants
  private async conversationFor(user: RequestUser, conversationId: string) {
    const c = await this.db.one(`select id, seller_id, requester_user_id, conversation_type from public.conversations where id = $1`, [conversationId]);
    if (!c) throw notFound('Conversación');
    const side: 'CUSTOMER' | 'SELLER' | null = c.requester_user_id === user.id ? 'CUSTOMER' : c.seller_id && sellerCan(user, c.seller_id, 'MESSAGES') ? 'SELLER' : null;
    if (!side || !['PRODUCT_INQUIRY', 'ORDER'].includes(c.conversation_type)) throw forbidden();
    return { c, side };
  }

  async report(user: RequestUser, conversationId: string, messageId: string, reason: ReportReason, details?: string) {
    await this.requireReady();
    const { c } = await this.conversationFor(user, conversationId);
    const m = await this.db.one(`select id, sender_user_id, status from public.conversation_messages where id = $1 and conversation_id = $2`, [messageId, c.id]);
    if (!m || m.status !== 'SENT') throw notFound('Mensaje');
    if (m.sender_user_id === user.id) throw badRequest('REPORT_OWN_MESSAGE', 'No puedes reportar tus propios mensajes.');
    const sc = await this.controls();
    const today = await this.db.one<{ n: number }>(
      `select count(*)::int as n from public.nx_message_reports where reporter_user_id = $1 and created_at > now() - interval '1 day'`,
      [user.id],
    );
    if ((today?.n ?? 0) >= sc.chatReportsPerDay) throw new AppError('REPORT_LIMIT', 'Alcanzaste el límite de reportes por hoy. Si es urgente, escríbenos desde Ayuda.', HttpStatus.TOO_MANY_REQUESTS);
    const hidden = await this.db.tx(async (tx) => {
      // One report per person and message; the lock keeps the auto-hide count exact under concurrent reports.
      await this.db.exec(`select pg_advisory_xact_lock(hashtext('nexovax:chat-report:' || $1))`, [messageId], tx);
      const ins = await this.db.one(
        `insert into public.nx_message_reports (message_id, conversation_id, reporter_user_id, reported_user_id, reason, details)
         values ($1,$2,$3,$4,$5,$6) on conflict (message_id, reporter_user_id) do nothing returning id`,
        [messageId, c.id, user.id, m.sender_user_id, reason, details?.trim() || null],
        tx,
      );
      if (!ins) return false;
      const open = await this.db.one<{ n: number }>(`select count(distinct reporter_user_id)::int as n from public.nx_message_reports where message_id = $1 and status = 'OPEN'`, [messageId], tx);
      if ((open?.n ?? 0) < sc.chatReportsToAutoHide) return false;
      // A moderator who already decided to keep the message visible has the last word.
      const r = await this.db.one(
        `insert into public.nx_message_moderation (message_id, hidden, source) values ($1, true, 'AUTO_REPORTS')
         on conflict (message_id) do nothing returning message_id`,
        [messageId],
        tx,
      );
      return !!r;
    });
    return { reported: true, hidden };
  }

  async block(user: RequestUser, conversationId: string, on: boolean) {
    await this.requireReady();
    const { c, side } = await this.conversationFor(user, conversationId);
    if (on)
      await this.db.exec(
        `insert into public.nx_chat_blocks (seller_id, customer_user_id, blocked_by, blocked_by_user_id) values ($1,$2,$3,$4) on conflict do nothing`,
        [c.seller_id, c.requester_user_id, side, user.id],
      );
    else await this.db.exec(`delete from public.nx_chat_blocks where seller_id = $1 and customer_user_id = $2 and blocked_by = $3`, [c.seller_id, c.requester_user_id, side]);
    return this.viewerState(user, c);
  }

  /** What the chat needs to know about blocks, restriction and the viewer's own reports. */
  async viewerState(user: RequestUser, c: { id: string; seller_id: string | null; requester_user_id: string }) {
    if (!(await this.ready())) return { available: false, blockedByMe: false, blockedByOther: false, restrictedUntil: null as string | null, reportedMessageIds: [] as string[] };
    const side = c.requester_user_id === user.id ? 'CUSTOMER' : 'SELLER';
    const [b, r, reps] = await Promise.all([
      this.blocks(c.seller_id, c.requester_user_id),
      this.restriction(user.id),
      this.db.many<{ message_id: string }>(`select message_id from public.nx_message_reports where conversation_id = $1 and reporter_user_id = $2`, [c.id, user.id]),
    ]);
    return {
      available: true,
      blockedByMe: side === 'CUSTOMER' ? b.byCustomer : b.bySeller,
      blockedByOther: side === 'CUSTOMER' ? b.bySeller : b.byCustomer,
      restrictedUntil: r?.ends_at ?? null,
      reportedMessageIds: reps.map((x) => x.message_id),
    };
  }

  /** Ids of hidden messages among the given ones (empty until the migration runs). */
  async hiddenIds(messageIds: string[]) {
    if (!messageIds.length || !(await this.ready())) return new Set<string>();
    const rows = await this.db.many<{ message_id: string }>(`select message_id from public.nx_message_moderation where message_id = any($1::uuid[]) and hidden`, [messageIds]);
    return new Set(rows.map((r) => r.message_id));
  }

  // ------------------------------------------------------------------ moderators
  async openCount() {
    if (!(await this.ready())) return 0;
    return (await this.db.one<{ n: number }>(`select count(distinct message_id)::int as n from public.nx_message_reports where status = 'OPEN'`))?.n ?? 0;
  }

  /** Queue grouped by message: one row per reported message with its reports. */
  async queue(q: { status?: string; search?: string; page?: number }) {
    await this.requireReady();
    const status = ['OPEN', 'DISMISSED', 'ACTION_TAKEN'].includes(q.status ?? '') ? q.status! : 'OPEN';
    const page = Math.max(1, Math.min(500, q.page || 1));
    const params: unknown[] = [status];
    let filter = '';
    if (q.search?.trim()) {
      params.push(`%${q.search.trim().slice(0, 100)}%`);
      filter = ` and (m.body_text ilike $2 or coalesce(sup.display_name, su.email::text) ilike $2 or coalesce(ssp.display_name, s.slug) ilike $2)`;
    }
    params.push(page);
    const p = `$${params.length}`;
    const rows = await this.db.many(
      `with g as (
         select r.message_id, min(r.created_at) as first_at, max(r.created_at) as last_at, count(*)::int as reports,
                array_agg(distinct r.reason) as reasons, (array_agg(r.id order by r.created_at))[1] as report_id
           from public.nx_message_reports r where r.status = $1 group by r.message_id)
       select g.*, m.body_text, m.sent_at, m.sender_user_id, m.conversation_id, c.subject, c.seller_id,
              coalesce(ssp.display_name, s.slug) as store, coalesce(nullif(sup.display_name,''), split_part(su.email::text,'@',1)) as sender,
              (m.sender_user_id = c.requester_user_id) as sender_is_customer, coalesce(mm.hidden, false) as hidden,
              count(*) over()::int as total
         from g join public.conversation_messages m on m.id = g.message_id join public.conversations c on c.id = m.conversation_id
         left join public.sellers s on s.id = c.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         left join public.users su on su.id = m.sender_user_id left join public.user_profiles sup on sup.user_id = su.id
         left join public.nx_message_moderation mm on mm.message_id = m.id
        where true${filter}
        order by g.reports desc, g.last_at desc limit 20 offset (${p}::int - 1) * 20`,
      params,
    );
    return {
      total: rows[0]?.total ?? 0,
      counts: await this.db.one(
        `select count(distinct message_id) filter (where status = 'OPEN')::int as open,
                count(distinct message_id) filter (where status = 'ACTION_TAKEN' and resolved_at > now() - interval '1 day')::int as actioned_today,
                count(distinct message_id) filter (where status = 'DISMISSED' and resolved_at > now() - interval '1 day')::int as dismissed_today,
                (select count(*) from public.nx_messaging_restrictions where lifted_at is null and ends_at > now())::int as restricted
           from public.nx_message_reports`,
      ),
      items: rows.map((r: any) => ({
        messageId: r.message_id,
        reportId: r.report_id,
        reports: r.reports,
        reasons: r.reasons,
        firstAt: r.first_at,
        lastAt: r.last_at,
        body: r.body_text,
        sentAt: r.sent_at,
        hidden: r.hidden,
        sender: { id: r.sender_user_id, name: r.sender, side: r.sender_is_customer ? 'CUSTOMER' : 'SELLER' },
        store: r.store,
        conversationId: r.conversation_id,
        subject: r.subject,
      })),
    };
  }

  /** One reported message with its reports, the surrounding conversation and the sender's history. */
  async detail(messageId: string) {
    await this.requireReady();
    const m = await this.db.one(
      `select m.id, m.conversation_id, m.body_text, m.sent_at, m.sender_user_id, c.subject, c.requester_user_id, c.seller_id, m.sequence_number,
              coalesce(ssp.display_name, s.slug) as store, s.slug as store_slug,
              coalesce(nullif(up.display_name,''), split_part(u.email::text,'@',1)) as customer,
              coalesce(nullif(sup.display_name,''), split_part(su.email::text,'@',1)) as sender, su.email::text as sender_email,
              mm.hidden, mm.source as hidden_source
         from public.conversation_messages m join public.conversations c on c.id = m.conversation_id
         left join public.sellers s on s.id = c.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         join public.users u on u.id = c.requester_user_id left join public.user_profiles up on up.user_id = u.id
         left join public.users su on su.id = m.sender_user_id left join public.user_profiles sup on sup.user_id = su.id
         left join public.nx_message_moderation mm on mm.message_id = m.id
        where m.id = $1`,
      [messageId],
    );
    if (!m) throw notFound('Mensaje');
    const [reports, context, history, restriction] = await Promise.all([
      this.db.many(
        `select r.id, r.reason, r.details, r.status, r.resolution, r.resolution_note, r.created_at, r.resolved_at,
                coalesce(nullif(up.display_name,''), split_part(u.email::text,'@',1)) as reporter,
                coalesce(nullif(mp.display_name,''), split_part(mu.email::text,'@',1)) as moderator
           from public.nx_message_reports r join public.users u on u.id = r.reporter_user_id left join public.user_profiles up on up.user_id = u.id
           left join public.users mu on mu.id = r.resolved_by left join public.user_profiles mp on mp.user_id = mu.id
          where r.message_id = $1 order by r.created_at`,
        [messageId],
      ),
      this.db.many(
        `select m.id, m.body_text as body, m.sent_at, m.status, (m.sender_user_id = $3) as from_customer, (m.id = $4) as reported
           from public.conversation_messages m
          where m.conversation_id = $1 and m.sequence_number between $2::bigint - 6 and $2::bigint + 3 order by m.sequence_number`,
        [m.conversation_id, m.sequence_number, m.requester_user_id, m.id],
      ),
      m.sender_user_id
        ? this.db.one(
            `select count(distinct message_id)::int as reported_messages,
                    count(distinct message_id) filter (where status = 'ACTION_TAKEN')::int as actioned,
                    (select count(*) from public.nx_messaging_restrictions where user_id = $1)::int as restrictions
               from public.nx_message_reports where reported_user_id = $1`,
            [m.sender_user_id],
          )
        : null,
      m.sender_user_id ? this.restriction(m.sender_user_id) : null,
    ]);
    const sc = await this.controls();
    return {
      messageId: m.id,
      conversationId: m.conversation_id,
      subject: m.subject,
      body: m.body_text,
      sentAt: m.sent_at,
      hidden: !!m.hidden,
      hiddenSource: m.hidden_source ?? null,
      store: { name: m.store, slug: m.store_slug },
      customer: { name: m.customer },
      sender: { id: m.sender_user_id, name: m.sender, email: m.sender_email, side: m.sender_user_id === m.requester_user_id ? 'CUSTOMER' : 'SELLER', history, restrictedUntil: restriction?.ends_at ?? null, restrictionId: restriction?.id ?? null },
      reports: reports.map((r: any) => ({ id: r.id, reason: r.reason, details: r.details, status: r.status, resolution: r.resolution, note: r.resolution_note, createdAt: r.created_at, resolvedAt: r.resolved_at, reporter: r.reporter, moderator: r.moderator })),
      context: context.map((x: any) => ({ id: x.id, body: x.body, sentAt: x.sent_at, fromCustomer: x.from_customer, reported: x.reported, removed: x.status !== 'SENT' })),
      defaultRestrictionDays: sc.chatRestrictionDays,
    };
  }

  /** Decision on every open report of a message. */
  async resolve(staff: RequestUser, messageId: string, action: ReportAction, note?: string, days?: number) {
    await this.requireReady();
    const sc = await this.controls();
    const d = Math.min(365, Math.max(1, Math.round(days ?? sc.chatRestrictionDays)));
    const reason = note?.trim() || null;
    if (action !== 'DISMISS' && !reason) throw badRequest('NOTE_REQUIRED', 'Escribe el motivo de la decisión.');
    const hide = action === 'HIDE_MESSAGE' || action === 'HIDE_AND_RESTRICT';
    const restrict = action === 'RESTRICT_USER' || action === 'HIDE_AND_RESTRICT';
    const out = await this.db.tx(async (tx) => {
      await this.db.exec(`select pg_advisory_xact_lock(hashtext('nexovax:chat-report:' || $1))`, [messageId], tx);
      const m = await this.db.one(`select id, sender_user_id from public.conversation_messages where id = $1`, [messageId], tx);
      if (!m) throw notFound('Mensaje');
      const open = await this.db.many<{ id: string }>(`select id from public.nx_message_reports where message_id = $1 and status = 'OPEN' order by created_at for update`, [messageId], tx);
      if (!open.length) throw badRequest('REPORT_ALREADY_RESOLVED', 'Estos reportes ya fueron resueltos.');
      if (restrict && !m.sender_user_id) throw badRequest('SENDER_UNKNOWN', 'No se puede restringir: la cuenta que envió el mensaje ya no existe.');
      if (restrict && m.sender_user_id === staff.id) throw badRequest('SELF_RESTRICTION', 'No puedes restringir tu propia cuenta.');
      // Keep visible on dismiss (also lifts an automatic hide); hide on the hiding actions.
      if (hide || action === 'DISMISS')
        await this.db.exec(
          `insert into public.nx_message_moderation (message_id, hidden, source, moderated_by, note, updated_at) values ($1,$2,'MODERATOR',$3,$4,now())
           on conflict (message_id) do update set hidden = excluded.hidden, source = 'MODERATOR', moderated_by = excluded.moderated_by, note = excluded.note, updated_at = now()`,
          [messageId, hide, staff.id, reason],
          tx,
        );
      let endsAt: string | null = null;
      if (restrict) {
        const r = await this.db.one<{ ends_at: string }>(
          `insert into public.nx_messaging_restrictions (user_id, reason, report_id, ends_at, created_by) values ($1,$2,$3, now() + make_interval(days => $4::int), $5) returning ends_at`,
          [m.sender_user_id, reason, open[0].id, d, staff.id],
          tx,
        );
        endsAt = r!.ends_at;
      }
      await this.db.exec(
        `update public.nx_message_reports set status = $2, resolution = $3, resolution_note = $4, resolved_by = $5, resolved_at = now()
          where message_id = $1 and status = 'OPEN'`,
        [messageId, action === 'DISMISS' ? 'DISMISSED' : 'ACTION_TAKEN', action === 'DISMISS' ? 'NONE' : action, reason, staff.id],
        tx,
      );
      return { senderId: m.sender_user_id as string | null, endsAt };
    });
    if (out.endsAt && out.senderId) void this.notifyRestricted(out.senderId, out.endsAt, d).catch(() => undefined);
    return this.detail(messageId);
  }

  async setHidden(staff: RequestUser, messageId: string, hidden: boolean, note?: string) {
    await this.requireReady();
    const m = await this.db.one(`select id from public.conversation_messages where id = $1`, [messageId]);
    if (!m) throw notFound('Mensaje');
    await this.db.exec(
      `insert into public.nx_message_moderation (message_id, hidden, source, moderated_by, note, updated_at) values ($1,$2,'MODERATOR',$3,$4,now())
       on conflict (message_id) do update set hidden = excluded.hidden, source = 'MODERATOR', moderated_by = excluded.moderated_by, note = coalesce(excluded.note, nx_message_moderation.note), updated_at = now()`,
      [messageId, hidden, staff.id, note?.trim() || null],
    );
    return this.detail(messageId);
  }

  async liftRestriction(staff: RequestUser, id: string) {
    await this.requireReady();
    const r = await this.db.one(`update public.nx_messaging_restrictions set lifted_at = now(), lifted_by = $2 where id = $1 and lifted_at is null returning id`, [id, staff.id]);
    if (!r) throw notFound('Restricción');
    return { lifted: true };
  }

  private notifyRestricted(userId: string, endsAt: string, days: number) {
    const url = `${config.webUrl}/cuenta/mensajes`;
    return this.notifications.notify(userId, {
      category: 'ACCOUNT',
      eventType: 'MESSAGING_RESTRICTED',
      title: 'Tu cuenta no puede enviar mensajes por ahora',
      body: `Un moderador revisó reportes sobre tus mensajes. Podrás volver a escribir en ${days} días. Si crees que es un error, escríbenos desde Ayuda.`,
      url,
      entityType: 'MESSAGING_RESTRICTION',
      dedupeKey: `chat-restriction:${userId}:${endsAt}`,
      localized: {
        en: { title: 'Your account can’t send messages for now', body: `A moderator reviewed reports about your messages. You can write again in ${days} days. If you think this is a mistake, contact us from Help.` },
        fr: { title: 'Votre compte ne peut pas envoyer de messages pour le moment', body: `Un modérateur a examiné des signalements concernant vos messages. Vous pourrez écrire à nouveau dans ${days} jours. Si vous pensez qu’il s’agit d’une erreur, contactez-nous depuis Aide.` },
        ht: { title: 'Kont ou pa ka voye mesaj pou kounye a', body: `Yon moderatè revize rapò sou mesaj ou yo. Ou ka ekri ankò nan ${days} jou. Si ou panse se yon erè, ekri nou nan Èd.` },
      },
    });
  }
}
