import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { badRequest } from '../common/errors';
import { RequestUser } from '../auth/auth';

export type Payer = 'SELLER' | 'PLATFORM' | 'SHARED';
export interface ComponentInput { payer: Payer; sellerPercent?: number }

const COMPONENTS = { principal: 'CHARGEBACK_PRINCIPAL', fee: 'CHARGEBACK_FEE' } as const;

/**
 * Who bears a lost dispute: the disputed amount (principal) and the processor's dispute fee.
 * Each change publishes a new version of the cost-allocation rule; every order pins the version in
 * force when it was paid, so earlier orders keep the terms they were sold under.
 */
@Injectable()
export class ChargebackPolicyService {
  constructor(private readonly db: DbService) {}

  private async group(component: string) {
    const g = await this.db.one(
      `select g.id, g.code from public.business_rule_groups g
        where g.rule_type_code = 'COST_ALLOCATION' and g.scope_type_code = 'GLOBAL' and g.status = 'ACTIVE'
          and exists (select 1 from public.business_rule_versions v join public.cost_allocation_rule_definitions d on d.rule_version_id = v.id
                       where v.rule_group_id = g.id and d.cost_component_code = $1)
        order by g.created_at limit 1`,
      [component],
    );
    if (!g) throw badRequest('CHARGEBACK_POLICY_MISSING', 'La política de disputas no está configurada.');
    return g;
  }

  private view(r: any) {
    const payer: Payer = r.allocation_method === 'PLATFORM' ? 'PLATFORM' : r.allocation_method === 'SHARED' ? 'SHARED' : 'SELLER';
    return { versionId: r.id, version: r.version_number, status: r.status, effectiveFrom: r.effective_from, payer, sellerPercent: Math.round(Number(r.seller_share_rate) * 10000) / 100, by: r.by ?? null };
  }

  async get() {
    const out: any = {};
    for (const [key, component] of Object.entries(COMPONENTS)) {
      const g = await this.group(component);
      const rows = await this.db.many(
        `select v.id, v.version_number, v.status, v.effective_from, d.allocation_method, d.seller_share_rate::text, coalesce(up.display_name, u.email::text) as by
           from public.business_rule_versions v join public.cost_allocation_rule_definitions d on d.rule_version_id = v.id
           left join public.users u on u.id = v.created_by left join public.user_profiles up on up.user_id = u.id
          where v.rule_group_id = $1 and v.status in ('ACTIVE','SUPERSEDED','EXPIRED') order by v.version_number desc`,
        [g.id],
      );
      out[key] = { current: rows[0] ? this.view(rows[0]) : null, history: rows.map((r: any) => this.view(r)) };
    }
    out.openDisputes = (await this.db.one<{ n: number }>(`select count(*)::int as n from public.payment_disputes where status in ('OPEN','UNDER_REVIEW','INQUIRY_OPEN')`))!.n;
    return out;
  }

  private shape(component: string, i: ComponentInput) {
    if (!['SELLER', 'PLATFORM', 'SHARED'].includes(i.payer)) throw badRequest('CHARGEBACK_POLICY_INVALID', 'Elige quién paga.');
    if (i.payer === 'PLATFORM') return { method: 'PLATFORM', platform: 1, seller: 0 };
    if (i.payer === 'SELLER') return { method: component === 'CHARGEBACK_FEE' ? 'PROPORTIONAL_BY_SELLER_AMOUNT' : 'SELLER', platform: 0, seller: 1 };
    const pct = Number(i.sellerPercent);
    if (!Number.isFinite(pct) || pct < 1 || pct > 99 || Math.round(pct * 100) !== pct * 100) throw badRequest('CHARGEBACK_POLICY_SHARE', 'En el reparto compartido, la parte de la tienda va de 1 % a 99 % (hasta 2 decimales).');
    const seller = Math.round(pct * 100) / 10000;
    return { method: 'SHARED', platform: Math.round((1 - seller) * 10000) / 10000, seller };
  }

  /** Publishes new versions for the components that changed (effective now, for orders paid from now on). */
  async update(user: RequestUser, input: { principal: ComponentInput; fee: ComponentInput }) {
    const cur = await this.get();
    let changed = 0;
    await this.db.tx(async (c) => {
      for (const [key, component] of Object.entries(COMPONENTS) as ['principal' | 'fee', string][]) {
        const want = this.shape(component, input[key]);
        const now = cur[key].current;
        const nowShape = now && this.shape(component, { payer: now.payer, sellerPercent: now.sellerPercent });
        if (nowShape && nowShape.method === want.method && nowShape.seller === want.seller) continue;
        const g = await this.group(component);
        const last = await this.db.one(
          `select d.* from public.business_rule_versions v join public.cost_allocation_rule_definitions d on d.rule_version_id = v.id
            where v.rule_group_id = $1 order by v.version_number desc limit 1`,
          [g.id],
          c,
        );
        const label = component === 'CHARGEBACK_FEE' ? 'Comisión del procesador por disputa' : 'Monto de la disputa perdida';
        const v = await this.db.one(
          `select (public.create_business_rule_version($1,$2,'{}'::jsonb,$3,'APPLICATION','Cambio de política de disputas',null)).id as id`,
          [g.id, user.id, `${label}: ${want.method} (tienda ${want.seller * 100} %)`],
          c,
        );
        await this.db.exec(
          `insert into public.cost_allocation_rule_definitions (rule_version_id, cost_component_code, allocation_method, platform_share_rate, seller_share_rate, customer_share_rate, calculation_base_code, config)
           values ($1,$2,$3,$4,$5,0,$6,$7::jsonb)`,
          [v!.id, component, want.method, want.platform, want.seller, last?.calculation_base_code ?? null, JSON.stringify({ ...(last?.config ?? {}), changedBy: 'ADMIN_SETTINGS' })],
          c,
        );
        await this.db.exec(`select public.publish_business_rule_version($1,$2,now(),'APPLICATION','Cambio de política de disputas',null)`, [v!.id, user.id], c);
        changed += 1;
      }
    });
    if (!changed) throw badRequest('CHARGEBACK_POLICY_UNCHANGED', 'No hay cambios respecto a la política vigente.');
    return this.get();
  }
}
