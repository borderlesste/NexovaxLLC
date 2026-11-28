import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { SettingsService } from '../settings/settings.service';
import { AppError, badRequest, conflict, notFound } from '../common/errors';
import { HttpStatus } from '@nestjs/common';
import { RequestUser } from '../auth/auth';
import { allocate, applyRate, fromMinor, Minor, toMinor } from '../common/money';

export interface CouponInput {
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  minSubtotal?: number | null;
  maxDiscount?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  maxRedemptions?: number | null;
  perCustomer?: number | null;
  productIds?: string[] | null;
  active?: boolean;
  /** Personal offer: only the buyers the store sent it to (Ofertas) can redeem it. */
  recipientsOnly?: boolean;
}

/** One cart line as the coupon engine sees it (variant id in quotes, checkout item id when placing). */
export interface CouponLine {
  key: string;
  sellerId: string;
  productId: string;
  gross: Minor;
}

export interface CouponResult {
  code: string;
  codeId: string;
  sellerId: string;
  ruleVersionId: string;
  ruleGroupId: string;
  discount: Minor;
  allocations: { key: string; discount: Minor }[];
}

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;

/**
 * Seller coupons on the PROMOTION engine: one rule group per coupon (scope SELLER,
 * funding SELLER, requires a code) and its promotion_codes row. The discount lowers
 * the store's product net, so the store funds it entirely.
 */
@Injectable()
export class CouponsService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------------ seller management
  async list(sellerId: string) {
    const rows = await this.db.many(
      `select pc.id, pc.code::text as code, pc.status, pc.starts_at, pc.ends_at, pc.max_redemptions, pc.max_redemptions_per_customer, pc.created_at,
              g.id as group_id, v.id as version_id, v.conditions, d.benefit_type, d.percentage_rate::text as rate, d.fixed_amount::text as fixed_amount,
              d.maximum_discount_amount::text as max_discount,
              (select count(*)::int from public.promotion_code_reservations r where r.promotion_code_id = pc.id and r.status = 'CONSUMED') as uses,
              (select coalesce(sum(ops.discount_amount),0)::text from public.order_promotion_snapshots ops where ops.promotion_code_id = pc.id) as discounted
         from public.promotion_codes pc
         join public.business_rule_groups g on g.id = pc.rule_group_id and g.rule_type_code = 'PROMOTION' and g.scope_type_code = 'SELLER' and g.scope_seller_id = $1
         left join lateral (select * from public.business_rule_versions x where x.rule_group_id = g.id and x.status = 'ACTIVE' order by x.version_number desc limit 1) v on true
         left join public.promotion_rule_definitions d on d.rule_version_id = v.id
        where pc.status <> 'REVOKED'
        order by pc.created_at desc`,
      [sellerId],
    );
    return rows.map((r: any) => this.view(r));
  }

  async create(user: RequestUser, sellerId: string, input: CouponInput) {
    const p = await this.validate(sellerId, input);
    if (await this.db.one(`select 1 from public.promotion_codes where code = $1::citext`, [p.code]))
      throw conflict('COUPON_CODE_TAKEN', 'Ese código ya existe en el marketplace. Elige otro.');
    const id = await this.db.tx(async (c) => {
      const group = await this.db.one(
        `insert into public.business_rule_groups (rule_type_code, code, name, description, scope_type_code, scope_seller_id, priority, application_mode, stacking_group, created_by)
         values ('PROMOTION',$1,$2,'Cupón de la tienda (lo financia la tienda).','SELLER',$3,0,'EXCLUSIVE','SELLER-COUPON',$4) returning id`,
        [`NX-CPN-${p.code}-${Date.now().toString(36).toUpperCase()}`, `Cupón ${p.code}`, sellerId, user.id],
        c,
      );
      await this.publish(c, group!.id, user.id, p);
      const code = await this.db.one(
        `insert into public.promotion_codes (rule_group_id, code, status, starts_at, ends_at, max_redemptions, max_redemptions_per_customer, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [group!.id, p.code, p.active ? 'ACTIVE' : 'INACTIVE', p.startsAt, p.endsAt, p.maxRedemptions, p.perCustomer, user.id],
        c,
      );
      return code!.id as string;
    });
    return this.get(sellerId, id);
  }

  async update(user: RequestUser, sellerId: string, id: string, input: CouponInput) {
    const cur = await this.own(sellerId, id);
    const p = await this.validate(sellerId, { ...input, code: cur.code, recipientsOnly: input.recipientsOnly ?? cur.raw.conditions?.recipientsOnly === true });
    await this.db.tx(async (c) => {
      const terms = (r: any) => JSON.stringify([r.benefit_type, Number(r.rate ?? 0), Number(r.fixed_amount ?? 0), Number(r.max_discount ?? 0), r.conditions ?? {}]);
      const next = { benefit_type: p.type === 'PERCENT' ? 'PERCENTAGE_DISCOUNT' : 'FIXED_DISCOUNT', rate: p.type === 'PERCENT' ? p.value / 100 : null,
        fixed_amount: p.type === 'FIXED' ? p.value : null, max_discount: p.maxDiscount, conditions: p.conditions };
      if (terms(cur.raw) !== terms(next)) await this.publish(c, cur.raw.group_id, user.id, p);
      await this.db.exec(
        `update public.promotion_codes set status = $2, starts_at = $3, ends_at = $4, max_redemptions = $5, max_redemptions_per_customer = $6 where id = $1`,
        [id, p.active ? 'ACTIVE' : 'INACTIVE', p.startsAt, p.endsAt, p.maxRedemptions, p.perCustomer],
        c,
      );
    });
    return this.get(sellerId, id);
  }

  async setActive(sellerId: string, id: string, active: boolean) {
    await this.own(sellerId, id);
    await this.db.exec(`update public.promotion_codes set status = $2 where id = $1 and status in ('ACTIVE','INACTIVE')`, [id, active ? 'ACTIVE' : 'INACTIVE']);
    return this.get(sellerId, id);
  }

  /** Removes the coupon (orders that used it keep their discount and history). */
  async remove(sellerId: string, id: string) {
    const cur = await this.own(sellerId, id);
    await this.db.tx(async (c) => {
      await this.db.exec(`update public.promotion_codes set status = 'REVOKED', revoked_at = now() where id = $1`, [id], c);
      await this.db.exec(`update public.business_rule_groups set status = 'ARCHIVED', archived_at = now() where id = $1 and status <> 'ARCHIVED'`, [cur.raw.group_id], c);
    });
    return { ok: true };
  }

  async get(sellerId: string, id: string) {
    return (await this.list(sellerId)).find((x) => x.id === id) ?? null;
  }

  // ------------------------------------------------------------------ checkout
  /**
   * Evaluates the codes the buyer typed against the cart. Returns the applicable coupons
   * (one per store) and a readable error for each code that does not apply.
   */
  async evaluate(codes: string[], lines: CouponLine[], customerId: string, c?: PoolClient) {
    const results: CouponResult[] = [];
    const errors: { code: string; message: string; unknown?: boolean }[] = [];
    const seen = new Set<string>();
    for (const raw of codes) {
      const code = raw.trim().toUpperCase();
      if (!code || seen.has(code)) continue;
      seen.add(code);
      const r = await this.db.one(
        `select pc.id, pc.code::text as code, pc.status, pc.starts_at, pc.ends_at, pc.max_redemptions, pc.max_redemptions_per_customer,
                g.id as group_id, g.scope_seller_id as seller_id, g.status as group_status, v.id as version_id, v.conditions,
                d.benefit_type, d.percentage_rate::text as rate, d.fixed_amount::text as fixed_amount, d.maximum_discount_amount::text as max_discount,
                d.funding_source_code,
                (select count(*)::int from public.promotion_code_reservations x where x.promotion_code_id = pc.id and (x.status = 'CONSUMED' or (x.status = 'RESERVED' and x.expires_at > now()))) as used,
                (select count(*)::int from public.promotion_code_reservations x where x.promotion_code_id = pc.id and x.customer_id = $2 and (x.status = 'CONSUMED' or (x.status = 'RESERVED' and x.expires_at > now()))) as used_by_me
           from public.promotion_codes pc
           join public.business_rule_groups g on g.id = pc.rule_group_id and g.rule_type_code = 'PROMOTION' and g.scope_type_code = 'SELLER'
           left join lateral (select * from public.business_rule_versions x where x.rule_group_id = g.id and x.status = 'ACTIVE'
                                and x.effective_from <= now() and (x.effective_to is null or x.effective_to > now()) order by x.version_number desc limit 1) v on true
           left join public.promotion_rule_definitions d on d.rule_version_id = v.id
          where pc.code = $1::citext`,
        [code, customerId],
        c,
      );
      const fail = (message: string) => errors.push({ code, message });
      if (!r || r.status === 'REVOKED' || r.group_status === 'ARCHIVED' || !r.version_id) { errors.push({ code, message: 'El cupón no existe.', unknown: true }); continue; }
      if (r.status !== 'ACTIVE' || r.group_status !== 'ACTIVE') { fail('El cupón no está activo.'); continue; }
      if (r.starts_at && new Date(r.starts_at) > new Date()) { fail('El cupón aún no está vigente.'); continue; }
      if (r.ends_at && new Date(r.ends_at) <= new Date()) { fail('El cupón venció.'); continue; }
      if (r.max_redemptions != null && r.used >= Number(r.max_redemptions)) { fail('El cupón ya alcanzó su límite de usos.'); continue; }
      if (r.max_redemptions_per_customer != null && r.used_by_me >= Number(r.max_redemptions_per_customer)) { fail('Ya usaste este cupón el máximo de veces permitido.'); continue; }
      if (r.funding_source_code !== 'SELLER') { fail('El cupón no es válido.'); continue; }
      if (results.some((x) => x.sellerId === r.seller_id)) { fail('Solo puedes usar un cupón por tienda.'); continue; }
      if (r.conditions?.recipientsOnly === true) {
        const invited = await this.db.one(
          `select 1 from public.nx_offer_recipients x join public.nx_offer_campaigns oc on oc.id = x.campaign_id
            where oc.promotion_code_id = $1 and x.user_id = $2 limit 1`,
          [r.id, customerId],
          c,
        );
        if (!invited) { fail('Este cupón es una oferta personal y no está disponible para tu cuenta.'); continue; }
      }
      const products: string[] | null = Array.isArray(r.conditions?.productIds) && r.conditions.productIds.length ? r.conditions.productIds : null;
      const eligible = lines.filter((l) => l.sellerId === r.seller_id && (!products || products.includes(l.productId)));
      if (!eligible.length) { fail('El cupón no aplica a los productos de tu carrito.'); continue; }
      const base = eligible.reduce((a, l) => a + l.gross, 0n);
      const min = r.conditions?.minSubtotal != null ? toMinor(r.conditions.minSubtotal) : 0n;
      if (base < min) { fail(`El cupón requiere una compra mínima de ${fromMinor(min)} en esa tienda.`); continue; }
      let discount = r.benefit_type === 'PERCENTAGE_DISCOUNT' ? applyRate(base, r.rate) : toMinor(r.fixed_amount);
      if (r.max_discount != null && discount > toMinor(r.max_discount)) discount = toMinor(r.max_discount);
      if (discount > base) discount = base;
      if (discount <= 0n) { fail('El cupón no aplica a los productos de tu carrito.'); continue; }
      const parts = allocate(discount, eligible.map((l) => l.gross));
      results.push({
        code: r.code, codeId: r.id, sellerId: r.seller_id, ruleVersionId: r.version_id, ruleGroupId: r.group_id, discount,
        allocations: eligible.map((l, i) => ({ key: l.key, discount: parts[i] })),
      });
    }
    return { results, errors };
  }

  /**
   * Row-locks the typed codes inside the checkout transaction, in a fixed order. Concurrent checkouts
   * with the same coupon wait here, so the usage limits evaluated next can't be exceeded by a race.
   */
  async lockCodes(codes: string[], c: PoolClient) {
    const list = [...new Set(codes.map((x) => x.trim().toUpperCase()).filter(Boolean))].sort();
    if (!list.length) return;
    await this.db.exec(`select id from public.promotion_codes where code = any($1::citext[]) order by id for update`, [list], c);
  }

  /** Refuses coupon codes once a buyer has typed too many that don't exist (guessing codes). */
  async guardAttempts(customerId: string, codes: string[]) {
    if (!codes.some((x) => x.trim())) return;
    const limit = (await this.settings.get('security.controls')).couponFailedAttemptsPerHour;
    const r = await this.db.one<{ n: number }>(
      `select count(*)::int as n from public.nx_coupon_failed_attempts where user_id = $1 and last_attempt_at > now() - interval '1 hour'`,
      [customerId],
    ).catch(() => null); // table not migrated yet: never block checkout because of the limiter itself
    if ((r?.n ?? 0) >= limit)
      throw new AppError('COUPON_ATTEMPTS_EXCEEDED', 'Probaste demasiados códigos que no existen. Espera una hora antes de intentarlo de nuevo.', HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Remembers each distinct unknown code a buyer typed in the last hour (counted by guardAttempts). */
  async recordFailures(customerId: string, errors: { code: string; unknown?: boolean }[]) {
    const unknown = [...new Set(errors.filter((e) => e.unknown).map((e) => e.code))];
    if (!unknown.length) return;
    await this.db.exec(
      `insert into public.nx_coupon_failed_attempts (user_id, code, last_attempt_at)
       select $1, x, now() from unnest($2::text[]) x
       on conflict (user_id, code) do update set last_attempt_at = excluded.last_attempt_at`,
      [customerId, unknown],
    ).catch(() => undefined);
    await this.db.exec(`delete from public.nx_coupon_failed_attempts where user_id = $1 and last_attempt_at < now() - interval '1 day'`, [customerId]).catch(() => undefined);
  }

  // ------------------------------------------------------------------ helpers
  private async own(sellerId: string, id: string) {
    const r = await this.db.one(
      `select pc.id, pc.code::text as code, g.id as group_id, v.conditions, d.benefit_type, d.percentage_rate::text as rate, d.fixed_amount::text as fixed_amount,
              d.maximum_discount_amount::text as max_discount
         from public.promotion_codes pc join public.business_rule_groups g on g.id = pc.rule_group_id
         left join lateral (select * from public.business_rule_versions x where x.rule_group_id = g.id and x.status = 'ACTIVE' order by x.version_number desc limit 1) v on true
         left join public.promotion_rule_definitions d on d.rule_version_id = v.id
        where pc.id = $1 and g.scope_seller_id = $2 and g.rule_type_code = 'PROMOTION' and pc.status <> 'REVOKED'`,
      [id, sellerId],
    );
    if (!r) throw notFound('Cupón');
    return { code: r.code as string, raw: r };
  }

  private async validate(sellerId: string, i: CouponInput) {
    const code = String(i.code ?? '').trim().toUpperCase();
    if (!CODE_RE.test(code)) throw badRequest('COUPON_CODE_INVALID', 'El código debe tener de 3 a 24 caracteres: letras, números, guion o guion bajo.');
    if (i.type !== 'PERCENT' && i.type !== 'FIXED') throw badRequest('COUPON_TYPE_INVALID', 'Elige el tipo de descuento.');
    const value = Number(i.value);
    if (!Number.isFinite(value) || value <= 0) throw badRequest('COUPON_VALUE_INVALID', 'Indica el valor del descuento.');
    if (i.type === 'PERCENT' && (value > 90 || Math.round(value * 100) !== value * 100)) throw badRequest('COUPON_VALUE_INVALID', 'El porcentaje debe estar entre 0,01 y 90.');
    if (i.type === 'FIXED' && (value > 100000 || Math.round(value * 100) !== value * 100)) throw badRequest('COUPON_VALUE_INVALID', 'El monto fijo debe ser mayor que 0 y con máximo 2 decimales.');
    const minSubtotal = i.minSubtotal != null && i.minSubtotal !== ('' as any) ? Number(i.minSubtotal) : null;
    if (minSubtotal != null && (!Number.isFinite(minSubtotal) || minSubtotal < 0 || minSubtotal > 1000000)) throw badRequest('COUPON_MIN_INVALID', 'La compra mínima no es válida.');
    const maxDiscount = i.type === 'PERCENT' && i.maxDiscount != null && i.maxDiscount !== ('' as any) ? Number(i.maxDiscount) : null;
    if (maxDiscount != null && (!Number.isFinite(maxDiscount) || maxDiscount <= 0)) throw badRequest('COUPON_MAX_INVALID', 'El descuento máximo debe ser mayor que 0.');
    let startsAt = i.startsAt ? new Date(i.startsAt) : null;
    const endsAt = i.endsAt ? new Date(i.endsAt) : null;
    if ((startsAt && isNaN(+startsAt)) || (endsAt && isNaN(+endsAt))) throw badRequest('COUPON_DATES_INVALID', 'Las fechas no son válidas.');
    if (endsAt && !startsAt) startsAt = new Date();
    if (endsAt && startsAt && endsAt <= startsAt) throw badRequest('COUPON_DATES_INVALID', 'La fecha de fin debe ser posterior a la de inicio.');
    const maxRedemptions = i.maxRedemptions ? Number(i.maxRedemptions) : null;
    const perCustomer = i.perCustomer ? Number(i.perCustomer) : null;
    if ((maxRedemptions != null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 1000000)) ||
        (perCustomer != null && (!Number.isInteger(perCustomer) || perCustomer < 1 || perCustomer > 1000)))
      throw badRequest('COUPON_LIMITS_INVALID', 'Los límites de uso deben ser números enteros mayores que 0.');
    const productIds = Array.isArray(i.productIds) ? [...new Set(i.productIds)] : [];
    if (productIds.length) {
      if (productIds.length > 200) throw badRequest('COUPON_PRODUCTS_INVALID', 'Selecciona como máximo 200 productos.');
      const own = await this.db.one(`select count(*)::int as n from public.products where id = any($1::uuid[]) and seller_id = $2 and status <> 'ARCHIVED'`, [productIds, sellerId]);
      if (own!.n !== productIds.length) throw badRequest('COUPON_PRODUCTS_INVALID', 'Algunos productos no pertenecen a tu tienda.');
    }
    const conditions: Record<string, unknown> = {};
    if (minSubtotal != null) conditions.minSubtotal = minSubtotal.toFixed(2);
    if (productIds.length) conditions.productIds = productIds;
    if (i.recipientsOnly === true) conditions.recipientsOnly = true;
    return {
      code, type: i.type, value, minSubtotal, maxDiscount, startsAt: startsAt?.toISOString() ?? null, endsAt: endsAt?.toISOString() ?? null,
      maxRedemptions, perCustomer, conditions, active: i.active !== false,
    };
  }

  private async publish(c: PoolClient, groupId: string, actor: string, p: Awaited<ReturnType<CouponsService['validate']>>) {
    const currency = await this.settings.currency();
    const v = await this.db.one(
      `select (public.create_business_rule_version($1,$2,$3::jsonb,$4,'APPLICATION','Cambio de cupón',null)).id as id`,
      [groupId, actor, JSON.stringify(p.conditions), `Cupón ${p.code}`],
      c,
    );
    await this.db.exec(
      `insert into public.promotion_rule_definitions (rule_version_id, benefit_type, calculation_base_code, percentage_rate, fixed_amount, fixed_currency_code,
               maximum_discount_amount, maximum_discount_currency_code, funding_source_code, seller_funding_rate, platform_funding_rate, requires_code, combinability_mode)
       values ($1,$2,'PRODUCT_GROSS',$3,$4,$5,$6,$7,'SELLER',1,0,true,'EXCLUSIVE')`,
      [v!.id, p.type === 'PERCENT' ? 'PERCENTAGE_DISCOUNT' : 'FIXED_DISCOUNT', p.type === 'PERCENT' ? (p.value / 100).toFixed(6) : null,
       p.type === 'FIXED' ? p.value.toFixed(2) : null, p.type === 'FIXED' ? currency : null, p.maxDiscount != null ? p.maxDiscount.toFixed(2) : null,
       p.maxDiscount != null ? currency : null],
      c,
    );
    await this.db.exec(`select public.publish_business_rule_version($1,$2,now(),'APPLICATION','Cambio de cupón',null)`, [v!.id, actor], c);
  }

  private view(r: any) {
    const now = new Date();
    const state =
      r.status !== 'ACTIVE' ? 'INACTIVE'
      : r.ends_at && new Date(r.ends_at) <= now ? 'EXPIRED'
      : r.starts_at && new Date(r.starts_at) > now ? 'SCHEDULED'
      : r.max_redemptions != null && r.uses >= Number(r.max_redemptions) ? 'EXHAUSTED'
      : 'ACTIVE';
    return {
      id: r.id,
      code: r.code,
      status: r.status,
      state,
      type: r.benefit_type === 'FIXED_DISCOUNT' ? 'FIXED' : 'PERCENT',
      value: r.benefit_type === 'FIXED_DISCOUNT' ? Number(r.fixed_amount) : Number((Number(r.rate) * 100).toFixed(2)),
      maxDiscount: r.max_discount != null ? Number(r.max_discount) : null,
      minSubtotal: r.conditions?.minSubtotal != null ? Number(r.conditions.minSubtotal) : null,
      productIds: Array.isArray(r.conditions?.productIds) ? r.conditions.productIds : [],
      recipientsOnly: r.conditions?.recipientsOnly === true,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      maxRedemptions: r.max_redemptions != null ? Number(r.max_redemptions) : null,
      perCustomer: r.max_redemptions_per_customer,
      uses: r.uses,
      discounted: r.discounted,
      createdAt: r.created_at,
    };
  }
}
