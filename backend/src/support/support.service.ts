import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { MailService } from '../mail/mail.service';
import { orderRef, parseOrderRef, parseTicketRef, ticketRef } from '../common/refs';
import { badRequest, notFound } from '../common/errors';
import { isStaff, RequestUser } from '../auth/auth';
import { MessagingService, UploadedFile } from '../messaging/messaging.service';

export interface ReportInput {
  categoryCode: string;
  priority: 'NORMAL' | 'HIGH' | 'CRITICAL' | 'LOW';
  subject: string;
  description: string;
  url?: string;
  orderNumber?: string;
  storeName?: string;
  platform?: 'WEB' | 'MOBILE' | 'OTHER';
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
  ) {}

  catalogs() {
    return Promise.all([
      this.db.many(`select code, name, description from public.support_ticket_categories where is_active order by sort_order`),
      this.db.many(`select code, name, rank from public.support_priorities where is_active order by rank`),
      this.db.many(`select id, code, name from public.support_teams where is_active order by name`),
    ]).then(([categories, priorities, teams]) => ({ categories, priorities, teams }));
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
      input.platform ? `Plataforma: ${{ WEB: 'Plataforma web', MOBILE: 'App móvil', OTHER: 'Otro' }[input.platform]}` : null,
    ].filter(Boolean);
    const message = `${input.description.trim()}${context.length ? '\n\n— ' + context.join('\n— ') : ''}`;
    const evidence = await this.messaging.uploadFiles(user.id, files);
    const id = await this.db.tx(async (c) => {
      const r = await this.db.one(
        `select public.create_support_ticket($1, null, $2, $3, $4, $5, $6, null, null, $7) as id`,
        [user.id, cat.id, input.priority, input.subject.trim(), message, orderId, randomUUID()],
        c,
      );
      const team = await this.db.one(`select id from public.support_teams where code = 'SUPPORT'`, [], c);
      if (team) await this.db.exec(`update public.support_tickets set current_team_id = $2 where id = $1 and current_team_id is null`, [r!.id, team.id], c);
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
    return { id, code: ticketRef(t!.public_number) };
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
  async adminList(q: { status?: string; priority?: string; category?: string; search?: string; page?: number }) {
    const params: unknown[] = [];
    const where: string[] = [];
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
    if (q.search?.trim()) {
      params.push(`%${parseTicketRef(q.search)}%`);
      where.push(`(t.public_number::text ilike $${params.length} or t.subject ilike $${params.length} or coalesce(up.display_name, u.email::text) ilike $${params.length})`);
    }
    const page = Math.max(q.page ?? 1, 1);
    const rows = await this.db.many(
      `select t.id, t.public_number, t.status, t.subject, t.priority_code, t.created_at, t.updated_at, c.name as category, c.code as category_code,
              coalesce(up.display_name, u.email::text) as requester,
              case when exists (select 1 from public.sellers s where s.owner_user_id = u.id) then 'Vendedor' else 'Comprador' end as requester_type,
              coalesce(aup.display_name, au.email::text) as assignee,
              count(*) over() as total
         from public.support_tickets t
         join public.support_ticket_categories c on c.id = t.category_id
         join public.users u on u.id = t.requester_user_id left join public.user_profiles up on up.user_id = u.id
         left join public.users au on au.id = t.current_assignee_user_id left join public.user_profiles aup on aup.user_id = au.id
        ${where.length ? 'where ' + where.join(' and ') : ''}
        order by t.updated_at desc limit 20 offset ${(page - 1) * 20}`,
      params,
    );
    const counts = await this.db.one(
      `select count(*)::int as total, count(*) filter (where status = 'OPEN')::int as pending,
              count(*) filter (where status = 'OPEN' and priority_code = 'CRITICAL')::int as critical,
              count(*) filter (where status in ('IN_PROGRESS','PENDING_CUSTOMER','PENDING_INTERNAL'))::int as in_progress,
              count(*) filter (where status in ('RESOLVED','CLOSED'))::int as resolved
         from public.support_tickets`,
    );
    return {
      items: rows.map((r: any) => ({
        id: r.id, code: `REP-${r.public_number}`, status: r.status, statusLabel: STATUS_LABEL[r.status], subject: r.subject, priority: r.priority_code,
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
        `select n.id, n.body_text as body, n.created_at, coalesce(up.display_name, u.email::text) as author
           from public.support_internal_notes n join public.users u on u.id = n.author_user_id left join public.user_profiles up on up.user_id = u.id
          where n.ticket_id = $1 order by n.created_at`,
        [id],
      ),
    ]);
    const files = await this.messaging.attachmentsByMessage(messages.map((m: any) => m.id));
    return {
      id: t.id,
      conversationId: t.conversation_id,
      code: `REP-${t.public_number}`,
      trackingCode: ticketRef(t.public_number),
      status: t.status,
      statusLabel: STATUS_LABEL[t.status],
      subject: t.subject,
      priority: t.priority_code,
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

  private async ensureAgent(c: PoolClient, ticketId: string, staff: RequestUser, teamCode = 'SUPPORT') {
    const team = await this.db.one(`select id from public.support_teams where code = $1`, [teamCode], c);
    await this.db.exec(
      `insert into public.support_team_members (team_id, user_id, status) select $1, $2, 'ACTIVE'
        where not exists (select 1 from public.support_team_members where team_id = $1 and user_id = $2 and status = 'ACTIVE')`,
      [team!.id, staff.id],
      c,
    );
    return team!.id;
  }

  async assign(staff: RequestUser, ticketId: string, input: { teamCode?: string; assignToMe?: boolean }) {
    await this.db.tx(async (c) => {
      const teamId = await this.ensureAgent(c, ticketId, staff, input.teamCode ?? 'SUPPORT');
      await this.db.exec(`select public.assign_support_ticket($1,$2,$3,$4,$5)`, [ticketId, teamId, input.assignToMe === false ? null : staff.id, staff.id, 'Asignación desde el panel'], c);
    });
    return this.adminDetail(ticketId);
  }

  async transition(staff: RequestUser, ticketId: string, status: string, reason?: string) {
    await this.db.tx((c) => this.db.exec(`select public.transition_support_ticket($1,$2,$3,$4)`, [ticketId, status, staff.id, reason ?? null], c));
    this.mail.fire(() => this.mail.supportStatusChanged(ticketId, status));
    return this.adminDetail(ticketId);
  }

  async reply(staff: RequestUser, ticketId: string, body: string, internal: boolean, files: UploadedFile[] = []) {
    if (!body?.trim() && !(files.length && !internal)) throw badRequest('MESSAGE_REQUIRED', 'Escribe una respuesta.');
    if (internal && files.length) throw badRequest('INTERNAL_NOTE_FILES', 'Las notas internas no admiten adjuntos.');
    body = body?.trim() || `📎 ${files.map((f) => f.originalname ?? 'archivo').join(', ')}`;
    const assets = await this.messaging.uploadFiles(staff.id, files);
    await this.db.tx(async (c) => {
      const t = await this.db.one(`select id, conversation_id, status from public.support_tickets where id = $1`, [ticketId], c);
      if (!t) throw notFound('Reporte');
      if (internal) {
        await this.db.exec(`insert into public.support_internal_notes (ticket_id, author_user_id, body_text) values ($1,$2,$3)`, [ticketId, staff.id, body.trim()], c);
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
    return { ...d, notes: undefined, history: d.history };
  }
}
