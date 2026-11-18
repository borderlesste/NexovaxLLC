import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { badRequest } from '../common/errors';

export type PolicyCode = 'TERMS_OF_SERVICE' | 'PRIVACY_POLICY' | 'SELLER_TERMS';
/** What every account accepts; SELLER_TERMS is accepted per store at onboarding. */
export const USER_POLICIES: PolicyCode[] = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'];

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
        order by array_position(array['TERMS_OF_SERVICE','PRIVACY_POLICY','SELLER_TERMS'], p.code::text)`,
      [locale, codes ?? null],
    );
    return rows.map((r: any) => ({ code: r.code as PolicyCode, slug: r.slug, versionId: r.version_id, version: r.version_number, effectiveAt: r.effective_at, title: r.title, text: r.text }));
  }

  /** Account policies whose current version this user hasn't accepted yet (new account or new version). */
  async pending(userId: string, locale: string) {
    const cur = await this.current(locale, USER_POLICIES);
    const done = await this.db.many<{ policy_version_id: string }>(
      `select distinct policy_version_id from public.policy_acceptances where user_id = $1 and acceptance_scope = 'USER' and policy_version_id = any($2::uuid[])`,
      [userId, cur.map((c) => c.versionId)],
    );
    const ok = new Set(done.map((d) => d.policy_version_id));
    return cur.filter((c) => !ok.has(c.versionId));
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
