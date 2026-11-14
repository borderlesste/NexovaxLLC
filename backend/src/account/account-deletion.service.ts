import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { invalidateUserCache, RequestUser } from '../auth/auth';
import { SupabaseAdminService } from '../storage/supabase-admin.service';
import { StripeService } from '../payments/stripe.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { config } from '../config';

export const BLOCKER_LABEL: Record<string, string> = {
  BUYER_ORDERS_IN_PROGRESS: 'Tiene pedidos en curso (pagados y sin entregar, o con pago pendiente).',
  OPEN_RETURNS: 'Tiene devoluciones abiertas.',
  SELLER_ORDERS_IN_PROGRESS: 'Su tienda tiene ventas por preparar o enviar.',
  SELLER_BALANCE: 'Su tienda tiene saldo pendiente o disponible por retirar.',
  PAYOUTS_IN_PROGRESS: 'Su tienda tiene retiros en proceso.',
  STAFF_ROLES: 'Es parte del equipo del marketplace (quítale los roles de staff primero).',
};

/**
 * Account deletion: the owner asks for it, staff approve it. Accounts without purchase/sale
 * history are deleted completely; accounts with history are anonymized (orders, refunds and
 * books stay, nothing personal does) and can never sign in again.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);
  constructor(
    private readonly db: DbService,
    private readonly storage: SupabaseAdminService,
    private readonly stripe: StripeService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  private async blockers(userId: string) {
    const r = await this.db.one<{ b: { code: string; count: number }[] }>(`select public.nx_account_deletion_blockers($1) as b`, [userId]);
    return (r?.b ?? []).map((x) => ({ ...x, label: BLOCKER_LABEL[x.code] ?? x.code }));
  }

  private async hasHistory(userId: string) {
    return !!(await this.db.one<{ h: boolean }>(`select public.nx_account_has_history($1) as h`, [userId]))?.h;
  }

  private view(r: any) {
    return r
      ? { id: r.id, status: r.status, reason: r.reason, requestedAt: r.requested_at, decidedAt: r.decided_at, decisionNote: r.decision_note, mode: r.mode, completedAt: r.completed_at }
      : null;
  }

  // ------------------------------------------------------------------ owner
  async status(user: RequestUser) {
    const r = await this.db.one(`select * from public.nx_account_deletion_requests where user_id = $1 order by requested_at desc limit 1`, [user.id]);
    return { request: this.view(r), blockers: await this.blockers(user.id), keepsHistory: await this.hasHistory(user.id) };
  }

  async request(user: RequestUser, input: { reason?: string }) {
    const open = await this.db.one(`select id from public.nx_account_deletion_requests where user_id = $1 and status in ('REQUESTED','APPROVED')`, [user.id]);
    if (open) throw conflict('DELETION_ALREADY_REQUESTED', 'Ya tienes una solicitud de eliminación en revisión.');
    const u = await this.db.one(
      `select u.email::text as email, coalesce(nullif(up.display_name,''), trim(concat_ws(' ', up.first_name, up.last_name))) as name
         from public.users u left join public.user_profiles up on up.user_id = u.id where u.id = $1`,
      [user.id],
    );
    const r = await this.db.one(
      `insert into public.nx_account_deletion_requests (user_id, email_snapshot, name_snapshot, reason) values ($1,$2,$3,$4) returning *`,
      [user.id, u!.email, u!.name || null, input.reason?.trim() || null],
    );
    this.mail.fire(() => this.mail.accountDeletionEvent(r!.id, 'REQUESTED'));
    const staff = await this.db.many(
      `select distinct ur.user_id from public.user_roles ur join public.roles ro on ro.id = ur.role_id
        where ur.revoked_at is null and ro.code in ('ADMIN','SUPER_ADMIN') and ur.user_id <> $1`,
      [user.id],
    );
    for (const s of staff)
      await this.notifications.notify(s.user_id, {
        category: 'ACCOUNT', eventType: 'ACCOUNT_DELETION_REQUESTED', title: 'Solicitud de eliminación de cuenta',
        body: `${u!.name || u!.email} pidió eliminar su cuenta.`, url: `${config.webUrl}/admin/usuarios?eliminaciones=1`,
        entityType: 'ACCOUNT_DELETION', entityId: r!.id, dedupeKey: `account-deletion:${r!.id}`,
      });
    return this.status(user);
  }

  async cancel(user: RequestUser) {
    const r = await this.db.one(
      `update public.nx_account_deletion_requests set status = 'CANCELLED', updated_at = now() where user_id = $1 and status = 'REQUESTED' returning id`,
      [user.id],
    );
    if (!r) throw notFound('Solicitud');
    return this.status(user);
  }

  // ------------------------------------------------------------------ staff
  async list(q: { status?: string }) {
    const status = ['REQUESTED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED'].includes(q.status ?? '') ? q.status : null;
    const rows = await this.db.many(
      `select r.*, coalesce(nullif(up.display_name,''), r.name_snapshot) as name, u.created_at as user_since, u.status as user_status,
              coalesce(dup.display_name, du.email::text) as decided_by_name,
              (select count(*) from public.orders o where o.customer_id = r.user_id)::int as orders,
              (select string_agg(coalesce(ssp.display_name, s.slug), ', ') from public.sellers s left join public.seller_store_profiles ssp on ssp.seller_id = s.id where s.owner_user_id = r.user_id) as stores
         from public.nx_account_deletion_requests r
         left join public.users u on u.id = r.user_id left join public.user_profiles up on up.user_id = r.user_id
         left join public.users du on du.id = r.decided_by left join public.user_profiles dup on dup.user_id = r.decided_by
        where ($1::text is null or r.status = $1) order by r.requested_at desc limit 100`,
      [status],
    );
    const out = [];
    for (const r of rows) {
      const live = r.status === 'REQUESTED' && r.user_id;
      out.push({
        ...this.view(r),
        email: r.email_snapshot,
        name: r.name,
        userId: r.user_id,
        userSince: r.user_since,
        orders: r.orders,
        stores: r.stores,
        decidedBy: r.decided_by_name,
        result: r.result,
        blockers: live ? await this.blockers(r.user_id) : [],
        keepsHistory: live ? await this.hasHistory(r.user_id) : r.mode === 'ANONYMIZED',
      });
    }
    return out;
  }

  async reject(staff: RequestUser, id: string, note: string) {
    const r = await this.db.one(
      `update public.nx_account_deletion_requests set status = 'REJECTED', decided_by = $2, decided_at = now(), decision_note = $3, updated_at = now()
        where id = $1 and status = 'REQUESTED' returning id`,
      [id, staff.id, note.trim()],
    );
    if (!r) throw notFound('Solicitud');
    this.mail.fire(() => this.mail.accountDeletionEvent(id, 'REJECTED'));
    return this.list({});
  }

  async approve(staff: RequestUser, id: string) {
    const req = await this.db.one(`select * from public.nx_account_deletion_requests where id = $1`, [id]);
    if (!req || req.status !== 'REQUESTED' || !req.user_id) throw notFound('Solicitud');
    if (req.user_id === staff.id) throw forbidden('No puedes aprobar la eliminación de tu propia cuenta.');
    const blockers = await this.blockers(req.user_id);
    if (blockers.length)
      throw new AppError('ACCOUNT_DELETION_BLOCKED', `No se puede eliminar todavía: ${blockers.map((b) => b.label).join(' ')}`, HttpStatus.CONFLICT, { blockers });
    const locked = await this.db.one(
      `update public.nx_account_deletion_requests set status = 'APPROVED', decided_by = $2, decided_at = now(), updated_at = now() where id = $1 and status = 'REQUESTED' returning id`,
      [id, staff.id],
    );
    if (!locked) throw conflict('DELETION_ALREADY_PROCESSED', 'Esta solicitud ya fue procesada.');
    const userId: string = req.user_id;
    const hard = !(await this.hasHistory(userId));
    const locale = (await this.db.one(`select locale from public.users where id = $1`, [userId]))?.locale ?? 'es';
    try {
      // Files and external customer records first (the DB rows that point to them go next).
      const files = await this.db.many(
        `select storage_bucket as b, storage_key as k from public.assets a
          where a.storage_bucket is not null and a.status <> 'DELETED'
            and (a.storage_bucket = $3 and a.uploaded_by_user_id = $1
                 or $2 and (a.uploaded_by_user_id = $1 or a.owner_seller_id in (select id from public.sellers where owner_user_id = $1)))`,
        [userId, hard, config.avatarBucket],
      );
      const byBucket = new Map<string, string[]>();
      for (const f of files) byBucket.set(f.b, [...(byBucket.get(f.b) ?? []), f.k]);
      for (const [b, keys] of byBucket) await this.storage.removeObjects(b, keys);
      if (this.stripe.enabled)
        for (const c of await this.db.many(`select external_customer_id as c from public.customer_payment_provider_profiles where customer_id = $1 and provider_code = 'STRIPE'`, [userId]))
          await this.stripe.deleteCustomer(c.c).catch((e) => this.logger.warn(`stripe customer: ${e?.message}`));
      const res = await this.db.tx((c) => this.db.one<{ r: any }>(`select public.nx_delete_account($1) as r`, [userId], c));
      await this.db.exec(
        `update public.nx_account_deletion_requests set status = 'COMPLETED', mode = $2, completed_at = now(), result = $3::jsonb, updated_at = now() where id = $1`,
        [id, res!.r.mode, JSON.stringify(res!.r)],
      );
      invalidateUserCache(userId);
      this.mail.fire(() => this.mail.accountDeleted(req.email_snapshot, req.name_snapshot, locale === 'en' ? 'en' : 'es', id));
    } catch (e: any) {
      await this.db.exec(
        `update public.nx_account_deletion_requests set status = 'REQUESTED', decided_by = null, decided_at = null, result = jsonb_build_object('lastError', $2::text), updated_at = now() where id = $1`,
        [id, String(e?.message ?? e).slice(0, 300)],
      );
      this.logger.error(`account deletion ${id}: ${e?.message}`);
      throw new AppError('ACCOUNT_DELETION_FAILED', 'No se pudo eliminar la cuenta. Revisa el detalle e inténtalo de nuevo.', HttpStatus.CONFLICT, { reason: e?.message });
    }
    return this.list({});
  }

}
