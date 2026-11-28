import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { MailService } from '../mail/mail.service';
import { orderRef, parseOrderRef, parseTicketRef, ticketRef } from '../common/refs';
import { AppError, badRequest, notFound } from '../common/errors';
import { HttpStatus } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { ticketTimes } from './support-times';
import { clampPage } from '../common/paging';
import { isStaff, RequestUser } from '../auth/auth';
import { MessagingService, UploadedFile } from '../messaging/messaging.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface ReportInput {
  categoryCode: string;
  priority: 'NORMAL' | 'HIGH' | 'CRITICAL' | 'LOW';
  subject: string;
  description: string;
  url?: string;
  orderNumber?: string;
  storeName?: string;
  platform?: 'WEB' | 'MOBILE' | 'OTHER';
  /** Browser / device that sent the report (User-Agent), for support. */
  client?: string;
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Pendiente',
  IN_PROGRESS: 'En proceso',
  PENDING_CUSTOMER: 'Esperando al usuario',
  PENDING_INTERNAL: 'En revisión interna',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
  CANCELLED: 'Cancelado',
};

@Injectable()
export class SupportService {
  constructor(
    private readonly db: DbService,
    private readonly mail: MailService,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  /** Rating of a ticket (null when none, or before migration 20261128140000 runs). */
  private rating(ticketId: string) {
    return this.db
      .one(`select score, comment, created_at, updated_at from public.nx_support_ticket_ratings where ticket_id = $1`, [ticketId])
      .then((r) => (r ? { score: Number(r.score), comment: r.comment as string | null, at: r.updated_at ?? r.created_at } : null))
      .catch(() => null);
  }

  /** Team members who can take reports (support, moderators and admins). */
  async agents() {
    const rows = await this.db.many(
      `select u.id, coalesce(nullif(up.display_name,''), u.email::text) as name, array_agg(distinct r.code order by r.code) as roles
         from public.users u join public.user_roles ur on ur.user_id = u.id and ur.revoked_at is null
         join public.roles r on r.id = ur.role_id and r.code in ('SUPPORT','MODERATOR','ADMIN','SUPER_ADMIN')
         left join public.user_profiles up on up.user_id = u.id
        where u.status = 'ACTIVE' group by u.id, up.display_name, u.email order by 2 limit 200`,
    );
    return rows.map((r: any) => ({ id: r.id, name: r.name, roles: r.roles }));
  }

  catalogs() {
    return Promise.all([
      this.db.many(`select code, name, description from public.support_ticket_categories where is_active order by sort_order`),
      // Response time each priority promises (published SLA; no specific policy -> default one).
      this.db.many(
        `select p.code, p.name, p.rank,
                coalesce((select s.first_response_target_seconds from public.support_sla_policies s where s.status = 'ACTIVE' and s.priority_code = p.code and s.category_id is null order by s.version desc limit 1),
                         (select s.first_response_target_seconds from public.support_sla_policies s where s.status = 'ACTIVE' and s.priority_code is null and s.category_id is null order by s.version desc limit 1))::int as first_response_seconds
           from public.support_priorities p where p.is_active order by p.rank`),
      this.db.many(`select id, code, name from public.support_teams where is_active order by name`),
    ]).then(([categories, priorities, teams]) => ({ categories, priorities, teams }));
  }

  /**
   * Support request without signing in (no account yet, or locked out): e-mailed to the support
   * inbox with the visitor as Reply-To. Kept outside the ticket queue, whose tickets belong to an account.
   */
  async createGuest(input: ReportInput & { name: string; email: string; locale: string }) {
    const cat = await this.db.one(`select name from public.support_ticket_categories where code = $1 and is_active`, [input.categoryCode]);
    if (!cat) throw badRequest('CATEGORY_INVALID', 'Selecciona un tipo de problema.');
    const id = randomUUID();
    const status = await this.mail.guestSupportRequest({
      id, name: input.name.trim(), email: input.email.trim().toLowerCase(), category: cat.name, priority: input.priority,
      subject: input.subject.trim(), description: input.description.trim(), url: input.url?.trim() || undefined,
      orderNumber: input.orderNumber?.trim() || undefined, storeName: input.storeName?.trim() || undefined, platform: input.platform, locale: input.locale,
    });
    if (status === 'FAILED' || status === 'SKIPPED' || status === 'SUPPRESSED')
      throw badRequest('SUPPORT_MAIL_UNAVAILABLE', 'No pudimos enviar tu mensaje en este momento. Escríbenos directamente al correo de soporte.');
    return { ok: true };
  }

  async create(user: RequestUser, input: ReportInput, files: UploadedFile[] = []) {
    const cat = await this.db.one(`select id from public.support_ticket_categories where code = $1 and is_active`, [input.categoryCode]);
    if (!cat) throw badRequest('CATEGORY_INVALID', 'Selecciona un tipo de problema.');
    let orderId: string | null = null;
    if (input.orderNumber?.trim()) {
      const o = await this.db.one(
        `select id from public.orders where public_number::text = $1 and customer_id = $2`,
        [parseOrderRef(input.orderNumber), user.id],
      );
      orderId = o?.id ?? null;
    }
    const context = [
      input.url ? `URL afectada: ${input.url}` : null,
      input.orderNumber ? `Pedido: ${input.orderNumber}` : null,
      input.storeName ? `Tienda/vendedor: ${input.storeName}` : null,
    ].filter(Boolean);
    const message = `${input.description.trim()}${context.length ? '\n\n— ' + context.join('\n— ') : ''}`;
    // Urgency is the reporter's claim: an account may keep only a couple of urgent reports open, and the
    // staff bell rings at most once per account per day (staff still see the priority in the queue).
    let priority = input.priority;
    let alert = priority === 'HIGH' || priority === 'CRITICAL';
    if (alert) {
      const recent = await this.db.one<{ open: number; today: number }>(
        `select count(*) filter (where status not in ('RESOLVED','CLOSED','CANCELLED'))::int as open,
                count(*) filter (where created_at > now() - interval '24 hours')::int as today
           from public.support_tickets where requester_user_id = $1 and priority_code in ('HIGH','CRITICAL')`,
        [user.id],
      ).catch(() => ({ open: 0, today: 0 }));
      if ((recent?.open ?? 0) >= 2) priority = 'NORMAL';
      alert = priority !== 'NORMAL' && (recent?.today ?? 0) === 0;
    }
    const evidence = await this.messaging.uploadFiles(user.id, files);
    const id = await this.db.tx(async (c) => {
      const r = await this.db.one(
        `select public.create_support_ticket($1, null, $2, $3, $4, $5, $6, null, null, $7) as id`,
        [user.id, cat.id, priority, input.subject.trim(), message, orderId, randomUUID()],
        c,
      );
      const team = await this.db.one(`select id from public.support_teams where code = 'SUPPORT'`, [], c);
      if (team) await this.db.exec(`update public.support_tickets set current_team_id = $2 where id = $1 and current_team_id is null`, [r!.id, team.id], c);
      await this.db.exec(
        `update public.support_tickets set reported_platform = $2, reported_url = $3, reported_client = $4 where id = $1`,
        [r!.id, input.platform ?? 'WEB', input.url?.trim() || null, input.client?.replace(/[\u0000-\u001f]/g, '').slice(0, 300) || null],
        c,
      );
      if (evidence.length) {
        const first = await this.db.one(
          `select m.id, m.conversation_id from public.support_tickets t join public.conversation_messages m on m.conversation_id = t.conversation_id
            where t.id = $1 and m.sender_user_id = $2 order by m.sequence_number limit 1`,
          [r!.id, user.id],
          c,
        );
        if (first) await this.messaging.attach(c, first.conversation_id, first.id, evidence);
      }
      return r!.id;
    });
    this.mail.fire(() => this.mail.supportTicketCreated(id));
    const t = await this.db.one(`select public_number from public.support_tickets where id = $1`, [id]);
    if (alert) await this.alertStaff(id, ticketRef(t!.public_number), priority as 'HIGH' | 'CRITICAL', input.subject.trim());
    return { id, code: ticketRef(t!.public_number) };
  }

  /** High / critical reports reach the support team's bell at once (normal ones wait in the queue). */
  private async alertStaff(id: string, code: string, priority: 'HIGH' | 'CRITICAL', subject: string) {
    const staff = await this.db.many<{ id: string }>(
      `select distinct u.id from public.users u join public.user_roles ur on ur.user_id = u.id and ur.revoked_at is null and (ur.expires_at is null or ur.expires_at > now())
         join public.roles r on r.id = ur.role_id where r.code in ('SUPPORT','ADMIN','SUPER_ADMIN') and u.status = 'ACTIVE'`,
    );
    for (const s of staff)
      await this.notifications.notify(s.id, {
        category: 'SUPPORT', eventType: `SUPPORT_TICKET_${priority}`,
        title: `${priority === 'CRITICAL' ? 'Reporte crítico' : 'Reporte de prioridad alta'}: ${code}`,
        localized: {
          en: { title: `${priority === 'CRITICAL' ? 'Critical report' : 'High-priority report'}: ${code}`, body: subject },
          fr: { title: `${priority === 'CRITICAL' ? 'Signalement critique' : 'Signalement de priorité haute'} : ${code}`, body: subject },
          ht: { title: `${priority === 'CRITICAL' ? 'Rapò kritik' : 'Rapò priyorite wo'}: ${code}`, body: subject },
        },
        body: subject, url: `/admin/reportes?ticket=${id}`, entityType: 'SUPPORT_TICKET', entityId: id, dedupeKey: `ticket-priority:${id}`,
      });
  }

  async track(code: string, user: RequestUser) {
    const num = parseTicketRef(code);
    if (!/^\d+$/.test(num)) throw badRequest('CODE_INVALID', 'Código de seguimiento inválido.');
    const t = await this.db.one(
      `select t.id, t.public_number, t.status, t.subject, t.created_at, t.updated_at, t.requester_user_id, c.name as category
         from public.support_tickets t join public.support_ticket_categories c on c.id = t.category_id where t.public_number = $1`,
      [num],
    );
    const mine = !!t && user.id === t.requester_user_id;
    // Same answer for "doesn't exist" and "not yours" so codes can't be enumerated.
    if (!t || !(mine || isStaff(user, 'SUPPORT'))) throw notFound('Reporte');
    return {
      code: ticketRef(t.public_number),
      status: t.status,
      statusLabel: STATUS_LABEL[t.status],
      category: t.category,
      subject: t.subject,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      id: mine ? t.id : undefined,
      mine,
    };
  }

  async mine(user: RequestUser) {
    const rows = await this.db.many(
      `select t.id, t.public_number, t.status, t.subject, t.priority_code, t.created_at, t.updated_at, c.name as category
         from public.support_tickets t join public.support_ticket_categories c on c.id = t.category_id
        where t.requester_user_id = $1 order by t.created_at desc limit 50`,
      [user.id],
    );
    return rows.map((r: any) => ({ id: r.id, code: ticketRef(r.public_number), status: r.status, statusLabel: STATUS_LABEL[r.status], subject: r.subject, priority: r.priority_code, category: r.category, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  // ------------------------------------------------------------------ admin
  async adminList(q: { status?: string; priority?: string; category?: string; platform?: string; search?: string; page?: number; assignee?: string; viewerId?: string }) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.assignee === 'none') where.push(`t.current_assignee_user_id is null`);
    else if (q.assignee === 'me' && q.viewerId) {
      params.push(q.viewerId);
      where.push(`t.current_assignee_user_id = $${params.length}`);
    } else if (q.assignee && /^[0-9a-f-]{36}$/i.test(q.assignee)) {
      params.push(q.assignee);
      where.push(`t.current_assignee_user_id = $${params.length}`);
    }
    if (q.status === 'OPEN_ALL') where.push(`t.status in ('OPEN','IN_PROGRESS','PENDING_CUSTOMER','PENDING_INTERNAL')`);
    else if (q.status === 'IN_PROGRESS_ALL') where.push(`t.status in ('IN_PROGRESS','PENDING_CUSTOMER','PENDING_INTERNAL')`);
    else if (q.status === 'DONE') where.push(`t.status in ('RESOLVED','CLOSED')`);
    else if (q.status) {
      params.push(q.status);
      where.push(`t.status = $${params.length}`);
    }
    if (q.priority) {
      params.push(q.priority);
      where.push(`t.priority_code = $${params.length}`);
    }
    if (q.category) {
      params.push(q.category);
      where.push(`c.code = $${params.length}`);
    }
    if (q.platform && ['WEB', 'MOBILE', 'OTHER'].includes(q.platform)) {
      params.push(q.platform);
      where.push(`t.reported_platform = $${params.length}`);
    }
    if (q.search?.trim()) {
      params.push(`%${parseTicketRef(q.search)}%`);
      where.push(`(t.public_number::text ilike $${params.length} or t.subject ilike $${params.length} or coalesce(up.display_name, u.email::text) ilike $${params.length})`);
    }
    const page = clampPage(q.page);
    const rows = await this.db.many(
      `select t.id, t.public_number, t.status, t.subject, t.priority_code, t.created_at, t.updated_at, c.name as category, c.code as category_code,
              t.reported_platform, coalesce(up.display_name, u.email::text) as requester,
              case when exists (select 1 from public.sellers s where s.owner_user_id = u.id) then 'Vendedor' else 'Comprador' end as requester_type,
              coalesce(aup.display_name, au.email::text) as assignee,
              count(*) over() as total
         from public.support_tickets t
         join public.support_ticket_categories c on c.id = t.category_id
         join public.users u on u.id = t.requester_user_id left join public.user_profiles up on up.user_id = u.id
         left join public.users au on au.id = t.current_assignee_user_id left join public.user_profiles aup on aup.user_id = au.id
        ${where.length ? 'where ' + where.join(' and ') : ''}
        order by (t.status in ('OPEN','IN_PROGRESS','PENDING_INTERNAL')) desc,
                 case when t.status in ('OPEN','IN_PROGRESS','PENDING_INTERNAL') then (select rank from public.support_priorities sp where sp.code = t.priority_code) end desc nulls last,
                 t.updated_at desc limit 20 offset ${(page - 1) * 20}`,
      params,
    );
    const counts = await this.db.one(
      `select count(*)::int as total, count(*) filter (where status = 'OPEN')::int as pending,
              count(*) filter (where status = 'OPEN' and priority_code = 'CRITICAL')::int as critical,
              count(*) filter (where status in ('IN_PROGRESS','PENDING_CUSTOMER','PENDING_INTERNAL'))::int as in_progress,
              count(*) filter (where status in ('RESOLVED','CLOSED'))::int as resolved,
              count(*) filter (where status in ('OPEN','IN_PROGRESS','PENDING_CUSTOMER','PENDING_INTERNAL') and current_assignee_user_id = $1)::int as mine,
              count(*) filter (where status in ('OPEN','IN_PROGRESS','PENDING_CUSTOMER','PENDING_INTERNAL') and current_assignee_user_id is null)::int as unassigned
         from public.support_tickets`,
      [q.viewerId ?? null],
    );
    return {
      items: rows.map((r: any) => ({
        id: r.id, code: `REP-${r.public_number}`, status: r.status, statusLabel: STATUS_LABEL[r.status], subject: r.subject, priority: r.priority_code, platform: r.reported_platform,
        category: r.category, categoryCode: r.category_code, requester: r.requester, requesterType: r.requester_type, assignee: r.assignee,
        createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      total: rows[0] ? Number(rows[0].total) : 0,
      counts,
      page,
    };
  }

  async adminDetail(id: string) {
    const t = await this.db.one(
      `select t.*, c.name as category, c.code as category_code, coalesce(up.display_name, u.email::text) as requester, u.email::text as requester_email,
              (u.email_verified_at is not null) as verified, tm.name as team_name, tm.code as team_code,
              coalesce(aup.display_name, au.email::text) as assignee,
              case when exists (select 1 from public.sellers s where s.owner_user_id = u.id) then 'Vendedor' else 'Comprador' end as requester_type,
              o.public_number as order_number, sla.first_response_due_at, sla.resolution_due_at
         from public.support_tickets t join public.support_ticket_categories c on c.id = t.category_id
         join public.users u on u.id = t.requester_user_id left join public.user_profiles up on up.user_id = u.id
         left join public.support_teams tm on tm.id = t.current_team_id
         left join public.users au on au.id = t.current_assignee_user_id left join public.user_profiles aup on aup.user_id = au.id
         left join public.orders o on o.id = t.order_id
         left join public.support_ticket_sla_snapshots sla on sla.ticket_id = t.id
        where t.id = $1`,
      [id],
    );
    if (!t) throw notFound('Reporte');
    const [messages, history, notes] = await Promise.all([
      this.db.many(
        `select m.id, m.body_text as body, m.sent_at, m.sender_user_id, cp.participant_role as role, coalesce(up.display_name, u.email::text) as author
           from public.conversation_messages m left join public.conversation_participants cp on cp.conversation_id = m.conversation_id and cp.user_id = m.sender_user_id
           left join public.users u on u.id = m.sender_user_id left join public.user_profiles up on up.user_id = u.id
          where m.conversation_id = $1 and m.status = 'SENT' order by m.sequence_number`,
        [t.conversation_id],
      ),
      this.db.many(
        `select h.from_status, h.to_status, h.changed_at as created_at, h.reason, coalesce(up.display_name, u.email::text) as actor
           from public.support_ticket_status_history h left join public.users u on u.id = h.changed_by_user_id
           left join public.user_profiles up on up.user_id = u.id where h.ticket_id = $1 order by h.changed_at`,
        [id],
      ).catch(() => []),
      this.db.many(
        `select n.id, n.body_text as body, n.created_at, coalesce(up.display_name, u.email::text) as author,
                coalesce((select json_agg(json_build_object('id', a.id, 'name', coalesce(a.original_filename, 'archivo'), 'mime', a.mime_type, 'size', a.size_bytes,
                                                            'kind', case when a.mime_type like 'image/%' then 'IMAGE' else 'DOCUMENT' end) order by na.created_at)
                            from public.support_internal_note_attachments na join public.assets a on a.id = na.asset_id where na.note_id = n.id and a.status = 'READY'), '[]') as attachments
           from public.support_internal_notes n join public.users u on u.id = n.author_user_id left join public.user_profiles up on up.user_id = u.id
          where n.ticket_id = $1 order by n.created_at`,
        [id],
      ),
    ]);
    const files = await this.messaging.attachmentsByMessage(messages.map((m: any) => m.id));
    const rating = await this.rating(id);
    const times = ticketTimes({ createdAt: t.created_at, firstResponseAt: t.first_response_at, status: t.status }, history.map((h: any) => ({ to: h.to_status, at: h.created_at })));
    return {
      id: t.id,
      conversationId: t.conversation_id,
      assigneeId: t.current_assignee_user_id ?? null,
      times,
      rating,
      code: `REP-${t.public_number}`,
      trackingCode: ticketRef(t.public_number),
      status: t.status,
      statusLabel: STATUS_LABEL[t.status],
      subject: t.subject,
      priority: t.priority_code,
      platform: t.reported_platform,
      reportedUrl: t.reported_url,
      client: t.reported_client,
      category: t.category,
      categoryCode: t.category_code,
      createdAt: t.created_at,
      requester: { name: t.requester, email: t.requester_email, verified: t.verified, type: t.requester_type },
      team: t.team_name ? { name: t.team_name, code: t.team_code, id: t.current_team_id } : null,
      assignee: t.assignee,
      orderNumber: t.order_number ? orderRef(t.order_number) : null,
      sla: { firstResponseDueAt: t.first_response_due_at, resolutionDueAt: t.resolution_due_at, firstResponseAt: t.first_response_at },
      messages: messages.map((m: any) => ({ id: m.id, body: m.body, at: m.sent_at, author: m.author, staff: ['SUPPORT_AGENT', 'MODERATOR'].includes(m.role), attachments: files.get(m.id) ?? [] })),
      history: history.map((h: any) => ({ from: h.from_status, to: h.to_status, toLabel: STATUS_LABEL[h.to_status], at: h.created_at, actor: h.actor, reason: h.reason })),
      notes,
    };
  }

  private async ensureAgent(c: PoolClient, ticketId: string, staff: { id: string }, teamCode = 'SUPPORT') {
    const team = await this.db.one(`select id from public.support_teams where code = $1`, [teamCode], c);
    await this.db.exec(
      `insert into public.support_team_members (team_id, user_id, status) select $1, $2, 'ACTIVE'
        where not exists (select 1 from public.support_team_members where team_id = $1 and user_id = $2 and status = 'ACTIVE')`,
      [team!.id, staff.id],
      c,
    );
    return team!.id;
  }

  async assign(staff: RequestUser, ticketId: string, input: { teamCode?: string; assignToMe?: boolean; assigneeUserId?: string; unassign?: boolean }) {
    let assignee: string | null = input.assignToMe === false || input.unassign ? null : staff.id;
    if (input.assigneeUserId && !input.unassign) {
      if (!(await this.agents()).some((a) => a.id === input.assigneeUserId)) throw badRequest('AGENT_INVALID', 'Esa persona no forma parte del equipo de soporte.');
      assignee = input.assigneeUserId;
    }
    await this.db.tx(async (c) => {
      const cur = await this.db.one<{ code: string }>(`select tm.code from public.support_tickets t left join public.support_teams tm on tm.id = t.current_team_id where t.id = $1`, [ticketId], c);
      const teamCode = input.teamCode ?? cur?.code ?? 'SUPPORT';
      const teamId = await this.ensureAgent(c, ticketId, { id: assignee ?? staff.id }, teamCode);
      const reason = input.unassign ? 'Sin responsable' : assignee && assignee !== staff.id ? 'Asignado por un compañero' : 'Asignación desde el panel';
      await this.db.exec(`select public.assign_support_ticket($1,$2,$3,$4,$5)`, [ticketId, teamId, assignee, staff.id, reason], c);
    });
    return this.adminDetail(ticketId);
  }

  async transition(staff: RequestUser, ticketId: string, status: string, reason?: string) {
    await this.db.tx((c) => this.db.exec(`select public.transition_support_ticket($1,$2,$3,$4)`, [ticketId, status, staff.id, reason ?? null], c));
    this.mail.fire(() => this.mail.supportStatusChanged(ticketId, status));
    return this.adminDetail(ticketId);
  }

  async reply(staff: RequestUser, ticketId: string, body: string, internal: boolean, files: UploadedFile[] = []) {
    if (!body?.trim() && !files.length) throw badRequest('MESSAGE_REQUIRED', 'Escribe una respuesta.');
    body = body?.trim() || `📎 ${files.map((f) => f.originalname ?? 'archivo').join(', ')}`;
    const assets = await this.messaging.uploadFiles(staff.id, files);
    await this.db.tx(async (c) => {
      const t = await this.db.one(`select id, conversation_id, status from public.support_tickets where id = $1`, [ticketId], c);
      if (!t) throw notFound('Reporte');
      if (internal) {
        const note = await this.db.one(`insert into public.support_internal_notes (ticket_id, author_user_id, body_text) values ($1,$2,$3) returning id`, [ticketId, staff.id, body.trim()], c);
        for (const a of assets) await this.db.exec(`insert into public.support_internal_note_attachments (note_id, asset_id) values ($1,$2)`, [note!.id, a.id], c);
        return;
      }
      const part = await this.db.one(`select 1 from public.conversation_participants where conversation_id = $1 and user_id = $2 and status = 'ACTIVE'`, [t.conversation_id, staff.id], c);
      if (!part) {
        const teamId = await this.ensureAgent(c, ticketId, staff);
        await this.db.exec(`select public.assign_support_ticket($1,$2,$3,$4,$5)`, [ticketId, teamId, staff.id, staff.id, 'Respuesta al usuario'], c);
      }
      const msg = await this.db.one(`select public.send_conversation_message($1,$2,$3,null,$4,'{}'::jsonb) as id`, [t.conversation_id, staff.id, body.trim(), randomUUID()], c);
      await this.messaging.attach(c, t.conversation_id, msg!.id, assets);
      if (t.status === 'OPEN') await this.db.exec(`select public.transition_support_ticket($1,'IN_PROGRESS',$2,'Primera respuesta')`, [ticketId, staff.id], c);
    });
    if (!internal) this.mail.fire(() => this.mail.supportReply(ticketId, body));
    return this.adminDetail(ticketId);
  }

  async customerReply(user: RequestUser, ticketId: string, body: string, files: UploadedFile[] = []) {
    const t = await this.db.one(`select conversation_id, status from public.support_tickets where id = $1 and requester_user_id = $2`, [ticketId, user.id]);
    if (!t) throw notFound('Reporte');
    const text = body?.trim() || (files.length ? `📎 ${files.map((f) => f.originalname ?? 'archivo').join(', ')}` : '');
    if (!text) throw badRequest('MESSAGE_REQUIRED', 'Escribe un mensaje o adjunta un archivo.');
    const assets = await this.messaging.uploadFiles(user.id, files);
    await this.db.tx(async (c) => {
      const msg = await this.db.one(`select public.send_conversation_message($1,$2,$3,null,$4,'{}'::jsonb) as id`, [t.conversation_id, user.id, text, randomUUID()], c);
      await this.messaging.attach(c, t.conversation_id, msg!.id, assets);
      if (t.status === 'PENDING_CUSTOMER') await this.db.exec(`select public.transition_support_ticket($1,'IN_PROGRESS',$2,'Respuesta del usuario')`, [ticketId, user.id], c);
    });
    return this.customerDetail(user, ticketId);
  }

  async customerDetail(user: RequestUser, ticketId: string) {
    const t = await this.db.one(`select requester_user_id from public.support_tickets where id = $1`, [ticketId]);
    if (!t || t.requester_user_id !== user.id) throw notFound('Reporte');
    const d = await this.adminDetail(ticketId);
    const canRate = await this.canRate(ticketId, d.status);
    return { ...d, notes: undefined, history: d.history, assigneeId: undefined, times: undefined, canRate };
  }

  /** The customer can rate a resolved/closed report for a few days (Admin → Configuración → Seguridad). */
  private async canRate(ticketId: string, status: string) {
    if (!['RESOLVED', 'CLOSED'].includes(status)) return false;
    const days = (await this.settings.get('security.controls')).supportRatingDays;
    const r = await this.db.one(
      `select 1 from public.support_ticket_status_history where ticket_id = $1 and to_status in ('RESOLVED','CLOSED') and changed_at > now() - make_interval(days => $2::int) limit 1`,
      [ticketId, days],
    ).catch(() => null);
    return !!r;
  }

  async rate(user: RequestUser, ticketId: string, score: number, comment?: string) {
    const t = await this.db.one(`select id, status, requester_user_id, current_assignee_user_id from public.support_tickets where id = $1`, [ticketId]);
    if (!t || t.requester_user_id !== user.id) throw notFound('Reporte');
    if (!(await this.canRate(ticketId, t.status))) throw badRequest('RATING_CLOSED', 'Solo puedes calificar un reporte resuelto, durante los días siguientes a su cierre.');
    try {
      await this.db.exec(
        `insert into public.nx_support_ticket_ratings (ticket_id, user_id, score, comment, agent_user_id) values ($1,$2,$3,$4,$5)
         on conflict (ticket_id) do update set score = excluded.score, comment = excluded.comment, updated_at = now()`,
        [ticketId, user.id, score, comment?.trim() || null, t.current_assignee_user_id ?? null],
      );
    } catch (e: any) {
      if (e?.code === '42P01') throw new AppError('RATING_UNAVAILABLE', 'Esta función aún no está disponible. Inténtalo más tarde.', HttpStatus.SERVICE_UNAVAILABLE);
      throw e;
    }
    return this.customerDetail(user, ticketId);
  }

  /** Team performance over the last days: per agent and overall (Admin → Reportes). */
  async stats(days: number) {
    const tickets = await this.db.many(
      `select t.id, t.status, t.created_at, t.first_response_at, t.current_assignee_user_id as agent_id,
              coalesce(nullif(up.display_name,''), u.email::text) as agent
         from public.support_tickets t left join public.users u on u.id = t.current_assignee_user_id left join public.user_profiles up on up.user_id = u.id
        where t.created_at > now() - make_interval(days => $1::int) order by t.created_at desc limit 1000`,
      [days],
    );
    const ids = tickets.map((x: any) => x.id);
    const [hist, ratings] = await Promise.all([
      ids.length ? this.db.many(`select ticket_id, to_status, changed_at from public.support_ticket_status_history where ticket_id = any($1::uuid[])`, [ids]).catch(() => []) : [],
      ids.length ? this.db.many(`select ticket_id, score from public.nx_support_ticket_ratings where ticket_id = any($1::uuid[])`, [ids]).catch(() => []) : [],
    ]);
    const byTicket = new Map<string, { to: string; at: string }[]>();
    for (const h of hist as any[]) (byTicket.get(h.ticket_id) ?? byTicket.set(h.ticket_id, []).get(h.ticket_id)!).push({ to: h.to_status, at: h.changed_at });
    const score = new Map((ratings as any[]).map((r) => [r.ticket_id, Number(r.score)]));
    type Acc = { id: string | null; name: string | null; tickets: number; resolved: number; first: number[]; resolution: number[]; scores: number[] };
    const acc = new Map<string, Acc>();
    const all: Acc = { id: null, name: null, tickets: 0, resolved: 0, first: [], resolution: [], scores: [] };
    for (const x of tickets as any[]) {
      const k = x.agent_id ?? 'none';
      const a = acc.get(k) ?? acc.set(k, { id: x.agent_id, name: x.agent, tickets: 0, resolved: 0, first: [], resolution: [], scores: [] }).get(k)!;
      const tm = ticketTimes({ createdAt: x.created_at, firstResponseAt: x.first_response_at, status: x.status }, byTicket.get(x.id) ?? []);
      for (const b of [a, all]) {
        b.tickets++;
        if (tm.firstResponseMinutes != null) b.first.push(tm.firstResponseMinutes);
        if (tm.resolutionMinutes != null) { b.resolved++; b.resolution.push(tm.resolutionMinutes); }
        if (score.has(x.id)) b.scores.push(score.get(x.id)!);
      }
    }
    const avg = (v: number[]) => (v.length ? Math.round((v.reduce((s, n) => s + n, 0) / v.length) * 10) / 10 : null);
    const view = (a: Acc) => ({ agentId: a.id, agent: a.name, tickets: a.tickets, resolved: a.resolved, avgFirstResponseMinutes: avg(a.first), avgResolutionMinutes: avg(a.resolution), avgRating: avg(a.scores), ratings: a.scores.length });
    return { days, overall: view(all), agents: [...acc.values()].map(view).sort((x, y) => y.tickets - x.tickets) };
  }

  /** File attached to an internal note (staff only). */
  async noteAttachment(noteId: string, assetId: string) {
    const a = await this.db.one(
      `select a.storage_bucket, a.storage_key, a.mime_type, coalesce(a.original_filename, 'archivo') as name
         from public.support_internal_note_attachments na join public.assets a on a.id = na.asset_id
        where na.note_id = $1 and na.asset_id = $2 and a.status = 'READY'`,
      [noteId, assetId],
    );
    if (!a) throw notFound('Archivo');
    return { buffer: await this.messaging.downloadAsset(a.storage_bucket, a.storage_key), mime: a.mime_type as string, name: a.name as string };
  }
}
