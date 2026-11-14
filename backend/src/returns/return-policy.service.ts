import { HttpStatus, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { AppError, badRequest } from '../common/errors';
import { RequestUser } from '../auth/auth';

export type LabelPayer = 'CUSTOMER' | 'BY_REASON' | 'STORE' | 'MARKETPLACE';
export type ShippingRefund = 'NONE' | 'FULL_IF_ALL_RETURNED' | 'FULL';

export interface ReturnPolicyInput {
  windowDays: number;
  requireEvidence: boolean;
  inspectionRequired: boolean;
  shippingRefund: ShippingRefund;
  restockingFeePercent: number;
  labelPayer: LabelPayer;
}

export interface ResolvedPolicy extends ReturnPolicyInput {
  versionId: string;
  scope: 'GLOBAL' | 'SELLER';
  windowSeconds: number;
  anchor: string;
}

/** Reasons that are the store's fault: with BY_REASON the store pays the return label. */
export const STORE_FAULT_REASONS = ['DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'MISSING_PARTS'];
const PAYER_RANK: Record<LabelPayer, number> = { CUSTOMER: 0, BY_REASON: 1, STORE: 2, MARKETPLACE: 2 };
const GLOBAL_CODE = 'NX-GLOBAL-RETURNS';

/**
 * Versioned return policies (RETURN_POLICY business rules): one marketplace-wide policy and,
 * optionally, one per store. A store policy can only be more generous to the customer.
 * Every return request pins the version that applied when it was created.
 */
@Injectable()
export class ReturnPolicyService {
  constructor(private readonly db: DbService) {}

  private map(r: any, scope: 'GLOBAL' | 'SELLER'): ResolvedPolicy {
    const payer = (r.metadata?.return_label as LabelPayer) ?? 'CUSTOMER';
    return {
      versionId: r.rule_version_id,
      scope,
      windowSeconds: Number(r.return_window_seconds ?? 0),
      windowDays: Math.round(Number(r.return_window_seconds ?? 0) / 86400),
      anchor: r.return_window_anchor,
      requireEvidence: !!r.require_evidence,
      inspectionRequired: !!r.inspection_required,
      shippingRefund: (['NONE', 'FULL_IF_ALL_RETURNED', 'FULL'].includes(r.original_shipping_refund_mode) ? r.original_shipping_refund_mode : 'NONE') as ShippingRefund,
      restockingFeePercent: r.restocking_fee_type === 'PERCENTAGE' ? Math.round(Number(r.restocking_fee_rate) * 100) : 0,
      labelPayer: ['CUSTOMER', 'BY_REASON', 'STORE', 'MARKETPLACE'].includes(payer) ? payer : 'CUSTOMER',
    };
  }

  /** The policy that applies to a store right now (its own, else the marketplace one). */
  async resolve(sellerId: string | null, c?: PoolClient): Promise<ResolvedPolicy> {
    const row = await this.db.one(
      `select cand.scope_type_code, d.* from public.get_business_rule_candidates('RETURN_POLICY', $1, null, null, null, now()) cand
         join public.return_policy_rule_definitions d on d.rule_version_id = cand.rule_version_id
        order by cand.specificity_rank desc, cand.priority desc, cand.version_number desc limit 1`,
      [sellerId],
      c,
    );
    if (!row) throw new AppError('RETURN_POLICY_MISSING', 'Las devoluciones no están disponibles en este momento.', HttpStatus.SERVICE_UNAVAILABLE);
    return this.map(row, row.scope_type_code === 'SELLER' ? 'SELLER' : 'GLOBAL');
  }

  async global(): Promise<ResolvedPolicy> {
    return this.resolve(null);
  }

  /** The store's own policy (null when it follows the marketplace policy). */
  async seller(sellerId: string) {
    const r = await this.resolve(sellerId);
    return r.scope === 'SELLER' ? r : null;
  }

  /** Policy pinned by a return request (what the customer was promised). */
  async forVersion(versionId: string): Promise<ResolvedPolicy | null> {
    const r = await this.db.one(
      `select d.*, g.scope_type_code from public.return_policy_rule_definitions d join public.business_rule_versions v on v.id = d.rule_version_id
         join public.business_rule_groups g on g.id = v.rule_group_id where d.rule_version_id = $1`,
      [versionId],
    );
    return r ? this.map(r, r.scope_type_code === 'SELLER' ? 'SELLER' : 'GLOBAL') : null;
  }

  private validate(p: ReturnPolicyInput) {
    if (!Number.isInteger(p.windowDays) || p.windowDays < 0 || p.windowDays > 365) throw badRequest('RETURN_POLICY_INVALID', 'El plazo debe estar entre 0 y 365 días.');
    if (!Number.isInteger(p.restockingFeePercent) || p.restockingFeePercent < 0 || p.restockingFeePercent > 50) throw badRequest('RETURN_POLICY_INVALID', 'El cargo por reposición debe estar entre 0 % y 50 %.');
  }

  async setGlobal(admin: RequestUser, p: ReturnPolicyInput) {
    this.validate(p);
    await this.db.tx(async (c) => {
      const g = await this.db.one(`select id from public.business_rule_groups where code = $1`, [GLOBAL_CODE], c);
      await this.publish(c, g!.id, admin.id, p, 'Política de devoluciones del marketplace');
    });
    return this.global();
  }

  async setSeller(user: RequestUser, sellerId: string, p: ReturnPolicyInput) {
    this.validate(p);
    if (p.labelPayer === 'MARKETPLACE') throw badRequest('RETURN_POLICY_INVALID', 'Una tienda no puede cargar la etiqueta de devolución al marketplace.');
    const g = await this.global();
    // A store can only be more generous than the marketplace.
    const worse: string[] = [];
    if (p.windowDays < g.windowDays) worse.push(`el plazo no puede ser menor a ${g.windowDays} días`);
    if (p.restockingFeePercent > g.restockingFeePercent) worse.push(`el cargo por reposición no puede superar ${g.restockingFeePercent} %`);
    if (PAYER_RANK[p.labelPayer] < PAYER_RANK[g.labelPayer]) worse.push('la etiqueta de devolución no puede ser menos favorable para el cliente que la del marketplace');
    if (p.requireEvidence && !g.requireEvidence) worse.push('no puedes exigir fotos si el marketplace no las exige');
    if (p.shippingRefund === 'NONE' && g.shippingRefund !== 'NONE') worse.push('debes reembolsar el envío como mínimo como el marketplace');
    if (worse.length) throw badRequest('RETURN_POLICY_TOO_STRICT', `Tu política no puede ser menos favorable que la del marketplace: ${worse.join('; ')}.`);
    await this.db.tx(async (c) => {
      const code = `NX-RETURNS-SELLER-${sellerId.slice(0, 8).toUpperCase()}`;
      let group = await this.db.one(`select id, status from public.business_rule_groups where rule_type_code = 'RETURN_POLICY' and scope_type_code = 'SELLER' and scope_seller_id = $1`, [sellerId], c);
      if (!group)
        group = await this.db.one(
          `insert into public.business_rule_groups (rule_type_code, code, name, description, scope_type_code, scope_seller_id, priority, application_mode, created_by)
           values ('RETURN_POLICY',$1,'Política de devoluciones de la tienda','Política propia de la tienda (más favorable que la del marketplace).','SELLER',$2,0,'EXCLUSIVE',$3) returning id, status`,
          [code, sellerId, user.id],
          c,
        );
      else if (group.status !== 'ACTIVE') await this.db.exec(`update public.business_rule_groups set status = 'ACTIVE', archived_at = null where id = $1`, [group.id], c);
      await this.publish(c, group!.id, user.id, p, 'Política de devoluciones de la tienda');
    });
    return this.seller(sellerId);
  }

  /** The store goes back to the marketplace policy (returns already requested keep theirs). */
  async clearSeller(sellerId: string) {
    await this.db.exec(
      `update public.business_rule_groups set status = 'ARCHIVED', archived_at = now()
        where rule_type_code = 'RETURN_POLICY' and scope_type_code = 'SELLER' and scope_seller_id = $1 and status <> 'ARCHIVED'`,
      [sellerId],
    );
    return null;
  }

  private async publish(c: PoolClient, groupId: string, actor: string, p: ReturnPolicyInput, name: string) {
    const v = await this.db.one(
      `select (public.create_business_rule_version($1,$2,'{}'::jsonb,$3,'APPLICATION','Cambio de política de devoluciones',null)).id as id`,
      [groupId, actor, name],
      c,
    );
    await this.db.exec(
      `insert into public.return_policy_rule_definitions (rule_version_id, return_window_seconds, return_window_anchor, allow_partial_return,
               allow_return_after_refund, require_reason, require_evidence, inspection_required, auto_approve, restocking_fee_type, restocking_fee_rate,
               original_shipping_refund_mode, tax_refund_mode, customer_fee_refund_mode, platform_commission_reversal_mode,
               referral_clawback_mode, processing_fee_recovery_mode, metadata)
       values ($1,$2,'DELIVERED_AT',true,false,true,$3,$4,false,$5,$6,$7,'PROPORTIONAL','PROPORTIONAL','PROPORTIONAL','PROPORTIONAL','NONE',$8::jsonb)`,
      [v!.id, p.windowDays * 86400, p.requireEvidence, p.inspectionRequired, p.restockingFeePercent > 0 ? 'PERCENTAGE' : 'NONE',
       p.restockingFeePercent > 0 ? p.restockingFeePercent / 100 : null, p.shippingRefund,
       JSON.stringify({ return_shipping: p.labelPayer === 'CUSTOMER' ? 'CUSTOMER_ARRANGED' : 'PREPAID_LABEL', return_label: p.labelPayer, max_evidence_files: 4 })],
      c,
    );
    await this.db.exec(`select public.publish_business_rule_version($1,$2,now(),'APPLICATION','Cambio de política de devoluciones',null)`, [v!.id, actor], c);
  }
}
