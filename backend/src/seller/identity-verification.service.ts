import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { SupabaseAdminService } from '../storage/supabase-admin.service';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { config } from '../config';
import { badRequest, conflict, notFound } from '../common/errors';
import { DEFAULT_SECURITY_CONTROLS } from '../common/security-controls';
import { RequestUser } from '../auth/auth';

export const IDENTITY_DOCUMENT_TYPES = ['GOVERNMENT_ID', 'BUSINESS_REGISTRY'] as const;
export type IdentityDocumentType = (typeof IDENTITY_DOCUMENT_TYPES)[number];
export const IDENTITY_REJECTION_REASONS = ['ILLEGIBLE', 'EXPIRED', 'MISMATCH', 'INCOMPLETE', 'OTHER'] as const;
export type IdentityRejectionReason = (typeof IDENTITY_REJECTION_REASONS)[number];
export const IDENTITY_MAX_FILES = 3;

type UploadFile = { originalname?: string; mimetype: string; size: number; buffer: Buffer };

/**
 * «Identidad verificada»: the store owner sends an official ID (or the business's official registry),
 * an administrator reviews it and approves or rejects it. Files sit in a private bucket, are streamed
 * only to administrators (every view is logged) and are deleted after the retention period
 * (Admin → Configuración → Seguridad); the decision record is kept.
 */
@Injectable()
export class IdentityVerificationService {
  private readonly logger = new Logger(IdentityVerificationService.name);
  constructor(
    private readonly db: DbService,
    private readonly storage: SupabaseAdminService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  private async retentionDays() {
    return (await this.settings.get('security.controls'))?.identityDocRetentionDays ?? DEFAULT_SECURITY_CONTROLS.identityDocRetentionDays;
  }

  private log(requestId: string, action: string, userId: string | null, fileId?: string | null, c?: any) {
    return this.db.exec(`insert into public.nx_identity_verification_log (request_id, file_id, user_id, action) values ($1,$2,$3,$4)`, [requestId, fileId ?? null, userId, action], c);
  }

  // ------------------------------------------------------------------ seller side (owner only)

  /** Current state for the seller's Settings page: badge, open or last request (no file contents). */
  async sellerStatus(sellerId: string) {
    const [s, last] = await Promise.all([
      this.db.one(`select identity_verified_at, identity_verification_method from public.sellers where id = $1`, [sellerId]),
      this.db.one(
        `select r.id, r.document_type, r.status, r.rejection_reason, r.review_note, r.created_at, r.reviewed_at,
                (select count(*)::int from public.nx_identity_verification_files f where f.request_id = r.id) as files
           from public.nx_identity_verification_requests r where r.seller_id = $1 and r.status <> 'CANCELLED'
          order by r.created_at desc limit 1`,
        [sellerId],
      ),
    ]);
    if (!s) throw notFound('Tienda');
    return {
      verified: !!s.identity_verified_at,
      verifiedAt: s.identity_verified_at ?? null,
      method: s.identity_verification_method ?? null,
      maxFiles: IDENTITY_MAX_FILES,
      lastRequest: last
        ? { id: last.id, documentType: last.document_type, status: last.status, rejectionReason: last.rejection_reason, reviewNote: last.status === 'REJECTED' ? last.review_note : null,
            createdAt: last.created_at, reviewedAt: last.reviewed_at, files: last.files }
        : null,
    };
  }

  async submit(user: RequestUser, sellerId: string, documentType: IdentityDocumentType, files: UploadFile[], note?: string) {
    if (!IDENTITY_DOCUMENT_TYPES.includes(documentType)) throw badRequest('DOCUMENT_TYPE_INVALID', 'Elige el tipo de documento.');
    if (!files?.length) throw badRequest('NO_FILES', 'Adjunta al menos un archivo.');
    if (files.length > IDENTITY_MAX_FILES) throw badRequest('TOO_MANY_FILES', `Puedes adjuntar hasta ${IDENTITY_MAX_FILES} archivos.`);
    const s = await this.db.one(`select status, identity_verified_at from public.sellers where id = $1`, [sellerId]);
    if (!s) throw notFound('Tienda');
    if (s.status !== 'ACTIVE') throw conflict('SELLER_NOT_ACTIVE', 'Tu tienda debe estar activa para solicitar la verificación.');
    if (s.identity_verified_at) throw conflict('IDENTITY_ALREADY_VERIFIED', 'Tu identidad ya está verificada.');
    if (await this.db.one(`select 1 from public.nx_identity_verification_requests where seller_id = $1 and status = 'PENDING'`, [sellerId]))
      throw conflict('IDENTITY_REQUEST_PENDING', 'Ya tienes una solicitud en revisión.');
    // Upload first (validated and re-encoded); if anything fails afterwards the objects are removed.
    const stored: { key: string; name: string; size: number; mime: string }[] = [];
    try {
      for (const f of files) stored.push(await this.storage.uploadIdentityFile(sellerId, f));
      await this.db.tx(async (c) => {
        const r = await this.db.one<{ id: string }>(
          `insert into public.nx_identity_verification_requests (seller_id, submitted_by, document_type, seller_note) values ($1,$2,$3,$4) returning id`,
          [sellerId, user.id, documentType, note?.trim() || null],
          c,
        );
        let i = 0;
        for (const f of stored)
          await this.db.exec(
            `insert into public.nx_identity_verification_files (request_id, storage_key, original_filename, mime_type, size_bytes, sort_order) values ($1,$2,$3,$4,$5,$6)`,
            [r!.id, f.key, f.name, f.mime, f.size, i++],
            c,
          );
        await this.log(r!.id, 'SUBMIT', user.id, null, c);
      });
    } catch (e: any) {
      if (stored.length) await this.storage.removeObjects(config.identityBucket, stored.map((f) => f.key));
      if (e?.code === '23505') throw conflict('IDENTITY_REQUEST_PENDING', 'Ya tienes una solicitud en revisión.');
      throw e;
    }
    return this.sellerStatus(sellerId);
  }

  /** The owner withdraws a pending request: its files are deleted right away. */
  async cancel(user: RequestUser, sellerId: string) {
    const r = await this.db.one<{ id: string }>(
      `update public.nx_identity_verification_requests set status = 'CANCELLED', files_purge_after = now()
        where seller_id = $1 and status = 'PENDING' returning id`,
      [sellerId],
    );
    if (!r) throw notFound('Solicitud');
    await this.log(r.id, 'CANCEL', user.id);
    await this.purgeRequestFiles(r.id).catch((e) => this.logger.warn(`purge ${r.id}: ${e.message}`));
    return this.sellerStatus(sellerId);
  }

  // ------------------------------------------------------------------ administrators

  async adminList(status: string = 'PENDING') {
    const st = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status) ? status : 'PENDING';
    const rows = await this.db.many(
      `select r.id, r.seller_id, r.document_type, r.status, r.rejection_reason, r.created_at, r.reviewed_at, r.files_purged_at,
              s.slug, coalesce(ssp.display_name, s.slug) as store, slp.legal_name, slp.registration_country_code,
              (select count(*)::int from public.nx_identity_verification_files f where f.request_id = r.id and f.deleted_at is null) as files,
              coalesce(up.display_name, u.email::text) as reviewer
         from public.nx_identity_verification_requests r
         join public.sellers s on s.id = r.seller_id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         left join public.seller_legal_profiles slp on slp.seller_id = s.id
         left join public.users u on u.id = r.reviewed_by left join public.user_profiles up on up.user_id = u.id
        where r.status = $1
        order by case when r.status = 'PENDING' then r.created_at end asc, r.reviewed_at desc nulls last, r.created_at desc
        limit 200`,
      [st],
    );
    const counts = await this.db.one(`select count(*) filter (where status = 'PENDING')::int as pending from public.nx_identity_verification_requests`);
    return {
      counts,
      items: rows.map((r: any) => ({
        id: r.id, sellerId: r.seller_id, store: r.store, slug: r.slug, legalName: r.legal_name, countryCode: r.registration_country_code,
        documentType: r.document_type, status: r.status, rejectionReason: r.rejection_reason, files: r.files,
        createdAt: r.created_at, reviewedAt: r.reviewed_at, filesPurgedAt: r.files_purged_at, reviewer: r.reviewer,
      })),
    };
  }

  async adminDetail(id: string) {
    const r = await this.db.one(
      `select r.*, s.slug, s.status as seller_status, s.identity_verified_at, coalesce(ssp.display_name, s.slug) as store,
              slp.legal_name, slp.entity_type_code, slp.registration_country_code, slp.tax_identifier_last4,
              coalesce(oup.display_name, ou.email::text) as owner_name, ou.email::text as owner_email,
              coalesce(rup.display_name, ru.email::text) as reviewer
         from public.nx_identity_verification_requests r
         join public.sellers s on s.id = r.seller_id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         left join public.seller_legal_profiles slp on slp.seller_id = s.id
         left join public.users ou on ou.id = s.owner_user_id left join public.user_profiles oup on oup.user_id = ou.id
         left join public.users ru on ru.id = r.reviewed_by left join public.user_profiles rup on rup.user_id = ru.id
        where r.id = $1`,
      [id],
    );
    if (!r) throw notFound('Solicitud');
    const [files, log] = await Promise.all([
      this.db.many(
        `select id, original_filename as name, mime_type as mime, size_bytes as size from public.nx_identity_verification_files
          where request_id = $1 and deleted_at is null order by sort_order`,
        [id],
      ),
      this.db.many(
        `select l.action, l.created_at, l.file_id, coalesce(up.display_name, u.email::text) as actor
           from public.nx_identity_verification_log l left join public.users u on u.id = l.user_id left join public.user_profiles up on up.user_id = u.id
          where l.request_id = $1 order by l.created_at desc limit 100`,
        [id],
      ),
    ]);
    return {
      id: r.id, status: r.status, documentType: r.document_type, sellerNote: r.seller_note, rejectionReason: r.rejection_reason, reviewNote: r.review_note,
      createdAt: r.created_at, reviewedAt: r.reviewed_at, reviewer: r.reviewer, filesPurgeAfter: r.files_purge_after, filesPurgedAt: r.files_purged_at,
      seller: {
        id: r.seller_id, slug: r.slug, status: r.seller_status, store: r.store, identityVerified: !!r.identity_verified_at,
        legalName: r.legal_name, entityType: r.entity_type_code, countryCode: r.registration_country_code, taxIdLast4: r.tax_identifier_last4,
        ownerName: r.owner_name, ownerEmail: r.owner_email,
      },
      files,
      log: log.map((l: any) => ({ action: l.action, at: l.created_at, actor: l.actor, fileId: l.file_id })),
    };
  }

  async adminFile(admin: RequestUser, requestId: string, fileId: string) {
    const f = await this.db.one(
      `select f.storage_key, f.mime_type, f.original_filename from public.nx_identity_verification_files f
        where f.id = $1 and f.request_id = $2 and f.deleted_at is null`,
      [fileId, requestId],
    );
    if (!f) throw notFound('Archivo');
    await this.log(requestId, 'VIEW_FILE', admin.id, fileId);
    return { buffer: await this.storage.download(config.identityBucket, f.storage_key), mime: f.mime_type as string, name: f.original_filename as string };
  }

  async decide(admin: RequestUser, id: string, approve: boolean, reason?: IdentityRejectionReason, note?: string) {
    if (!approve && (!reason || !IDENTITY_REJECTION_REASONS.includes(reason))) throw badRequest('REASON_REQUIRED', 'Indica el motivo.');
    if (!approve && reason === 'OTHER' && !note?.trim()) throw badRequest('REASON_REQUIRED', 'Indica el motivo.');
    const days = await this.retentionDays();
    const sellerId = await this.db.tx(async (c) => {
      const r = await this.db.one(`select seller_id, status, document_type from public.nx_identity_verification_requests where id = $1 for update`, [id], c);
      if (!r) throw notFound('Solicitud');
      if (r.status !== 'PENDING') throw conflict('IDENTITY_REQUEST_DECIDED', 'Esta solicitud ya fue revisada.');
      const s = await this.db.one(`select status from public.sellers where id = $1 for update`, [r.seller_id], c);
      if (approve && s?.status !== 'ACTIVE') throw conflict('INVALID_TRANSITION', 'Acción no válida para el estado actual de la tienda.');
      await this.db.exec(
        `update public.nx_identity_verification_requests
            set status = $2, rejection_reason = $3, review_note = $4, reviewed_by = $5, reviewed_at = now(),
                files_purge_after = now() + make_interval(days => $6::int)
          where id = $1`,
        [id, approve ? 'APPROVED' : 'REJECTED', approve ? null : reason, note?.trim() || null, admin.id, days],
        c,
      );
      if (approve)
        await this.db.exec(
          `update public.sellers set identity_verified_at = now(), identity_verified_by = $2, identity_verification_method = $3, version = version + 1 where id = $1`,
          [r.seller_id, admin.id, r.document_type],
          c,
        );
      const label = r.document_type === 'GOVERNMENT_ID' ? 'documento de identidad oficial' : 'registro oficial de la empresa';
      await this.db.exec(
        `insert into public.seller_status_history (seller_id, from_status, to_status, changed_by, reason)
         select id, status, status, $2, $3 from public.sellers where id = $1`,
        [r.seller_id, admin.id, approve ? `Identidad verificada (${label})` : `Identidad no verificada: ${reason}${note?.trim() ? ` · ${note.trim()}` : ''}`],
        c,
      );
      await this.log(id, approve ? 'APPROVE' : 'REJECT', admin.id, null, c);
      return r.seller_id as string;
    });
    this.mail.fire(() => this.mail.identityVerificationDecided(sellerId, approve, reason, note));
    return this.adminDetail(id);
  }

  // ------------------------------------------------------------------ retention

  private async purgeRequestFiles(requestId: string) {
    const files = await this.db.many<{ id: string; storage_key: string }>(
      `select id, storage_key from public.nx_identity_verification_files where request_id = $1 and deleted_at is null`,
      [requestId],
    );
    if (files.length) await this.storage.removeObjects(config.identityBucket, files.map((f) => f.storage_key));
    await this.db.tx(async (c) => {
      await this.db.exec(`update public.nx_identity_verification_files set deleted_at = now() where request_id = $1 and deleted_at is null`, [requestId], c);
      await this.db.exec(`update public.nx_identity_verification_requests set files_purged_at = now() where id = $1`, [requestId], c);
      await this.log(requestId, 'PURGE_FILES', null, null, c);
    });
  }

  /** Daily job: deletes the files of requests whose retention period ended. Returns how many requests. */
  async purgeExpired() {
    const due = await this.db.many<{ id: string }>(
      `select id from public.nx_identity_verification_requests
        where files_purged_at is null and files_purge_after is not null and files_purge_after <= now() order by files_purge_after limit 200`,
    );
    for (const r of due) await this.purgeRequestFiles(r.id).catch((e) => this.logger.warn(`purge ${r.id}: ${e.message}`));
    return due.length;
  }
}
