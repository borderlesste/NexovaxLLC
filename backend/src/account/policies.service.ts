import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { badRequest } from '../common/errors';

export type PolicyCode = 'TERMS_OF_SERVICE' | 'PRIVACY_POLICY' | 'SELLER_TERMS' | 'RETURN_POLICY' | 'SHIPPING_POLICY' | 'ABOUT_US' | 'BUYER_PROTECTION';
/** What every account accepts; SELLER_TERMS is accepted per store at onboarding. */
export const USER_POLICIES: PolicyCode[] = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'];
/** Informational public pages (returns, shipping, about us): published and versioned, never accepted. */
export const PUBLIC_POLICIES: PolicyCode[] = ['RETURN_POLICY', 'SHIPPING_POLICY', 'ABOUT_US', 'BUYER_PROTECTION'];
export const EDITABLE_POLICIES: PolicyCode[] = [...USER_POLICIES, 'SELLER_TERMS', ...PUBLIC_POLICIES];

export interface AcceptanceContext {
  method: 'REGISTRATION' | 'LOGIN_GATE' | 'SELLER_ONBOARDING' | 'EXPLICIT_CHECKBOX';
  locale?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  evidence?: Record<string, unknown>;
}

const hash = (v?: string | null) => (v ? createHash('sha256').update(v).digest() : null);

/**
 * Legal policies (published in the policy engine) and their acceptance. Each acceptance is an
 * append-only record of the exact version, language, method and (hashed) IP / browser.
 */
@Injectable()
export class PoliciesService {
  constructor(private readonly db: DbService) {}

  /** Current published version of each policy, in the requested language (Spanish if missing). */
  async current(locale: string, codes?: PolicyCode[]) {
    const rows = await this.db.many(
      `select p.code, p.slug, v.id as version_id, v.version_number, v.effective_at,
              coalesce(l.title, d.title) as title, coalesce(l.content, d.content)->>'text' as text
         from public.policies p join public.policy_versions v on v.id = p.current_published_version_id
         left join public.policy_version_localizations l on l.policy_version_id = v.id and l.locale = $1
         join public.policy_version_localizations d on d.policy_version_id = v.id and d.locale = p.default_locale
        where p.status = 'ACTIVE' and ($2::text[] is null or p.code = any($2))
        order by array_position(array['TERMS_OF_SERVICE','PRIVACY_POLICY','SELLER_TERMS','RETURN_POLICY','SHIPPING_POLICY','BUYER_PROTECTION','ABOUT_US'], p.code::text)`,
      [locale, codes ?? null],
    );
    return rows.map((r: any) => ({ code: r.code as PolicyCode, slug: r.slug, versionId: r.version_id, version: r.version_number, effectiveAt: r.effective_at, title: r.title, text: r.text }));
  }

  /**
   * Policies this person still has to accept: account policies (terms, privacy) and, for each store
   * they own, the seller terms. A new version needs acceptance only when it was published with
   * "requires re-acceptance" or the person never accepted any version of that policy.
   */
  async pending(userId: string, locale: string) {
    const cur = await this.current(locale, [...USER_POLICIES, 'SELLER_TERMS']);
    const stores = await this.db.many<{ id: string; name: string }>(
      `select s.id, coalesce(ssp.display_name, s.slug) as name from public.sellers s left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where s.status not in ('CLOSED','DELETED')
          and (s.owner_user_id = $1 or exists (select 1 from public.seller_members m where m.seller_id = s.id and m.user_id = $1 and m.status = 'ACTIVE'))`,
      [userId],
    ).catch(() => []);
    const rows = await this.db.many<{ policy_id_code: string; version_id: string; seller_id: string | null }>(
      `select p.code as policy_id_code, a.policy_version_id as version_id, a.seller_id
         from public.policy_acceptances a join public.policy_versions v on v.id = a.policy_version_id join public.policies p on p.id = v.policy_id
        where a.user_id = $1`,
      [userId],
    );
    // Seller terms are accepted once per store (by the owner or any active member).
    if (stores.length)
      rows.push(...(await this.db.many<{ policy_id_code: string; version_id: string; seller_id: string }>(
        `select p.code as policy_id_code, a.policy_version_id as version_id, a.seller_id
           from public.policy_acceptances a join public.policy_versions v on v.id = a.policy_version_id join public.policies p on p.id = v.policy_id
          where a.acceptance_scope = 'SELLER' and a.seller_id = any($1::uuid[]) and a.user_id <> $2`,
        [stores.map((x) => x.id), userId],
      )));
    const reaccept = new Map((await this.db.many<{ id: string; r: boolean }>(
      `select id, requires_reacceptance as r from public.policy_versions where id = any($1::uuid[])`, [cur.map((c) => c.versionId)],
    )).map((x) => [x.id, x.r]));
    const needs = (code: string, versionId: string, sellerId: string | null) => {
      const mine = rows.filter((r) => r.policy_id_code === code && (r.seller_id ?? null) === sellerId);
      if (mine.some((r) => r.version_id === versionId)) return false;
      return !mine.length || !!reaccept.get(versionId);
    };
    const out: (typeof cur[number] & { sellerId?: string; store?: string })[] = [];
    for (const c of cur) {
      if (c.code === 'SELLER_TERMS') {
        for (const st of stores) if (needs(c.code, c.versionId, st.id)) out.push({ ...c, sellerId: st.id, store: st.name });
      } else if (needs(c.code, c.versionId, null)) out.push(c);
    }
    return out;
  }

  /** Accepts what is pending among the given versions (account policies and the person's stores). */
  async acceptPending(userId: string, versionIds: string[], ctx: AcceptanceContext) {
    const pending = (await this.pending(userId, ctx.locale ?? 'es')).filter((p) => versionIds.includes(p.versionId));
    for (const p of pending) await this.accept(userId, [p.versionId], ctx, { sellerId: p.sellerId });
    return pending.length;
  }

  // ------------------------------------------------------------------ admin
  /** Every policy with its current texts (all languages), version history and acceptances. */
  async adminList() {
    const pols = await this.db.many(
      `select p.id, p.code, p.slug, p.default_locale, p.current_published_version_id as current_id, pt.name as type_name, pt.acceptance_mode, pt.audience
         from public.policies p join public.policy_types pt on pt.code = p.policy_type_code where p.status = 'ACTIVE'
        order by array_position(array['TERMS_OF_SERVICE','PRIVACY_POLICY','SELLER_TERMS','RETURN_POLICY','SHIPPING_POLICY','BUYER_PROTECTION','ABOUT_US'], p.code::text)`,
    );
    const out = [];
    for (const p of pols) {
      const locs = await this.db.many(
        `select locale, title, content->>'text' as text from public.policy_version_localizations where policy_version_id = $1 order by locale`,
        [p.current_id],
      );
      const versions = await this.db.many(
        `select v.id, v.version_number, v.status, v.requires_reacceptance, v.effective_at, v.published_at, v.scheduled_at, v.withdrawn_at,
                coalesce(up.display_name, u.email::text) as published_by,
                (select count(*)::int from public.policy_acceptances a where a.policy_version_id = v.id) as acceptances
           from public.policy_versions v left join public.users u on u.id = v.published_by_user_id left join public.user_profiles up on up.user_id = u.id
          where v.policy_id = $1 order by v.version_number desc`,
        [p.id],
      );
      out.push({
        code: p.code, slug: p.slug, name: p.type_name, audience: p.audience, acceptanceMode: p.acceptance_mode, defaultLocale: p.default_locale,
        localizations: Object.fromEntries(locs.map((l: any) => [l.locale, { title: l.title, text: l.text }])),
        versions: versions.map((v: any) => ({ id: v.id, version: v.version_number, status: v.status, scheduledAt: v.scheduled_at, requiresReacceptance: v.requires_reacceptance, effectiveAt: v.effective_at, publishedAt: v.published_at, publishedBy: v.published_by, acceptances: v.acceptances, current: v.id === p.current_id })),
      });
    }
    return out;
  }

  /** Publishes a new version (Spanish required; other languages optional) and makes it current. */
  async publishVersion(adminId: string, code: string, input: { localizations: Record<string, { title?: string; text?: string } | undefined>; requiresReacceptance: boolean; effectiveAt?: string | null; note?: string }) {
    // Scheduled: kept aside until its date; the current version stays in force meanwhile.
    const at = input.effectiveAt ? new Date(input.effectiveAt) : null;
    if (at && (isNaN(at.getTime()) || at.getTime() > Date.now() + 366 * 86400_000)) throw badRequest('POLICY_DATE_INVALID', 'La fecha de entrada en vigor no es válida (como máximo un año).');
    const scheduled = !!at && at.getTime() > Date.now() + 60_000;
    const pol = await this.db.one(`select id, default_locale from public.policies where code = $1 and status = 'ACTIVE'`, [code]);
    if (!pol) throw badRequest('POLICY_NOT_FOUND', 'Política no encontrada.');
    const locs = Object.entries(input.localizations ?? {})
      .filter(([l, v]) => ['es', 'en', 'fr', 'ht'].includes(l) && v && (v.title?.trim() || v.text?.trim()))
      .map(([l, v]) => [l, { title: v!.title!.trim(), text: v!.text!.trim() }] as const);
    for (const [l, v] of locs) {
      if (!v.title || v.title.length < 3 || v.title.length > 120 || !v.text || v.text.length < 30 || v.text.length > 20000 || /[<>]/.test(v.title + v.text))
        throw badRequest('POLICY_TEXT_INVALID', `Revisa el texto en ${l.toUpperCase()}: título de 3 a 120 caracteres y texto de 30 a 20 000, sin etiquetas HTML.`);
    }
    if (!locs.some(([l]) => l === pol.default_locale)) throw badRequest('POLICY_DEFAULT_LOCALE_REQUIRED', 'El texto en español es obligatorio.');
    const cur = await this.db.many<{ locale: string; title: string; text: string }>(
      `select l.locale, l.title, l.content->>'text' as text from public.policies p join public.policy_version_localizations l on l.policy_version_id = p.current_published_version_id where p.id = $1`,
      [pol.id],
    );
    const same = cur.length === locs.length && locs.every(([l, v]) => cur.some((c) => c.locale === l && c.title === v.title && c.text === v.text));
    if (same) throw badRequest('POLICY_UNCHANGED', 'No hay cambios respecto a la versión vigente.');
    if (scheduled && (await this.db.one(`select 1 from public.policy_versions where policy_id = $1 and status = 'SCHEDULED'`, [pol.id])))
      throw badRequest('POLICY_ALREADY_SCHEDULED', 'Ya hay una versión programada para esta política. Cancélala antes de programar otra.');
    return this.db.tx(async (c) => {
      const v = (await this.db.one<{ id: string; n: number }>(
        `insert into public.policy_versions (policy_id, version_number, requires_reacceptance, created_by_user_id)
         values ($1, (select coalesce(max(version_number),0)+1 from public.policy_versions where policy_id = $1), $2, $3) returning id, version_number as n`,
        [pol.id, !!input.requiresReacceptance && !PUBLIC_POLICIES.includes(code as PolicyCode), adminId],
        c,
      ))!;
      for (const [l, t] of locs)
        await this.db.exec(
          `insert into public.policy_version_localizations (policy_version_id, locale, title, content_format, content) values ($1,$2,$3,'PLAIN_TEXT',$4::jsonb)`,
          [v.id, l, t.title, JSON.stringify({ text: t.text })],
          c,
        );
      if (scheduled) {
        await this.db.exec(`update public.policy_versions set status = 'SCHEDULED', scheduled_at = $2 where id = $1`, [v.id, at], c);
        return { versionId: v.id, version: v.n, scheduledAt: at!.toISOString() };
      }
      await this.db.exec(`select public.publish_policy_version($1,$2,now())`, [v.id, adminId], c);
      return { versionId: v.id, version: v.n };
    });
  }

  /** Cancels a scheduled version (it never takes effect; kept as WITHDRAWN). */
  async cancelScheduled(code: string, versionId: string) {
    const r = await this.db.one(
      `update public.policy_versions v set status = 'WITHDRAWN', withdrawn_at = now()
         from public.policies p where p.id = v.policy_id and p.code = $1 and v.id = $2 and v.status = 'SCHEDULED' returning v.id`,
      [code, versionId],
    );
    if (!r) throw badRequest('POLICY_NOT_SCHEDULED', 'Esa versión ya no está programada.');
    return { ok: true };
  }

  /** Job: publishes the scheduled versions whose date has come (on behalf of who scheduled them). */
  async publishDue() {
    const due = await this.db.many<{ id: string; by: string; at: Date }>(
      `select id, created_by_user_id as by, scheduled_at as at from public.policy_versions where status = 'SCHEDULED' and scheduled_at <= now() order by scheduled_at limit 20`,
    );
    for (const d of due) await this.db.tx((c) => this.db.exec(`select public.publish_policy_version($1,$2,$3)`, [d.id, d.by, d.at], c));
    return due.length;
  }

  /** Records acceptance of the given versions (they must be the current ones). */
  async accept(userId: string, versionIds: string[], ctx: AcceptanceContext, opts: { sellerId?: string; client?: PoolClient } = {}) {
    if (!versionIds.length) return [];
    const cur = await this.db.many<{ id: string; code: string }>(
      `select v.id, p.code from public.policies p join public.policy_versions v on v.id = p.current_published_version_id where v.id = any($1::uuid[])`,
      [versionIds],
      opts.client,
    );
    if (cur.length !== new Set(versionIds).size) throw badRequest('POLICY_VERSION_OUTDATED', 'Las políticas cambiaron. Vuelve a cargar la página y acéptalas de nuevo.');
    const out: string[] = [];
    for (const v of cur) {
      const r = await this.db.one<{ id: string }>(
        `select public.record_policy_acceptance($1,$2,$3,$4,$5,$6,null,$7,$8,$9::jsonb) as id`,
        [v.id, userId, opts.sellerId ? 'SELLER' : 'USER', opts.sellerId ?? null, ctx.method, ctx.locale ?? null, hash(ctx.ip), hash(ctx.userAgent), JSON.stringify({ policy: v.code, ...(ctx.evidence ?? {}) })],
        opts.client,
      );
      out.push(r!.id);
    }
    return out;
  }

  /** Accepts every current account policy (sign-up). */
  async acceptAccountPolicies(userId: string, ctx: AcceptanceContext) {
    const cur = await this.current(ctx.locale ?? 'es', USER_POLICIES);
    return this.accept(userId, cur.map((c) => c.versionId), ctx);
  }

  /** Seller terms, accepted for a specific store (with the commission in force as evidence). */
  async acceptSellerTerms(userId: string, sellerId: string, ctx: AcceptanceContext, client?: PoolClient) {
    const cur = await this.current(ctx.locale ?? 'es', ['SELLER_TERMS']);
    return this.accept(userId, cur.map((c) => c.versionId), ctx, { sellerId, client });
  }
}
