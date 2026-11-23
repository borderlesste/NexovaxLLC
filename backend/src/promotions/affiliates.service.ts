import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { badRequest, conflict } from '../common/errors';
import { RequestUser } from '../auth/auth';
import { applyRate, fromMinor, Minor } from '../common/money';
import { orderRef } from '../common/refs';
import { NotificationsService } from '../notifications/notifications.service';
import { activeAffiliateProgramSql } from './affiliates.sql';

export interface ProgramInput {
  enabled: boolean;
  ratePercent: number;
  windowDays: number;
  productIds?: string[] | null;
}

/** Wallets paid to an email (Zelle also accepts a US phone number). */
export const WALLET_METHODS = ['WISE', 'PAYONEER', 'ZELLE', 'SKRILL'] as const;
export const PAYOUT_METHODS = ['PAYPAL', 'BANK', ...WALLET_METHODS] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export interface PayoutProfileInput {
  method: PayoutMethod;
  paypalEmail?: string;
  bank?: { holderName?: string; bankName?: string; accountNumber?: string; accountType?: string; routingCode?: string; country?: string };
  wallet?: { holderName?: string; account?: string };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

/**
 * Seller affiliate programs on the referral engine. The store decides whether it pays
 * affiliates, the rate and which products; any registered user shares a link, and sales
 * inside the attribution window earn a commission that the platform pays the affiliate
 * out of that store's funds for the sale (never the platform's money).
 */
@Injectable()
export class AffiliatesService {
  private readonly logger = new Logger(AffiliatesService.name);

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ seller program
  async program(sellerId: string) {
    const r = await this.db.one(
      `select p.id as program_id, p.status, p.attribution_window_days, nsp.rule_group_id, v.conditions, d.percentage_rate::text as rate
         from public.nx_seller_affiliate_programs nsp join public.referral_programs p on p.id = nsp.program_id
         left join lateral (select * from public.business_rule_versions x where x.rule_group_id = nsp.rule_group_id and x.status = 'ACTIVE' order by x.version_number desc limit 1) v on true
         left join public.referral_rule_definitions d on d.rule_version_id = v.id
        where nsp.seller_id = $1`,
      [sellerId],
    );
    const stats = await this.db.one(
      `select count(distinct rc.referrer_id)::int as affiliates, count(distinct rc.order_id)::int as orders,
              coalesce(sum(oifs.product_net_amount),0)::text as sales, coalesce(sum(rc.final_amount),0)::text as commissions,
              coalesce(sum(rc.final_amount) filter (where rc.status = 'PENDING'),0)::text as pending,
              coalesce(sum(rc.final_amount) filter (where rc.status in ('AVAILABLE','PAID')),0)::text as confirmed,
              (select coalesce(sum(rv.reversal_amount),0) from public.referral_commission_reversals rv join public.referral_commissions x on x.id = rv.referral_commission_id
                 join public.seller_orders y on y.id = x.seller_order_id where y.seller_id = $1)::text as reversed
         from public.referral_commissions rc join public.seller_orders so on so.id = rc.seller_order_id
         join public.order_item_financial_snapshots oifs on oifs.order_item_id = rc.order_item_id
        where so.seller_id = $1`,
      [sellerId],
    );
    return {
      enabled: r?.status === 'ACTIVE',
      ratePercent: r?.rate != null ? Number((Number(r.rate) * 100).toFixed(2)) : 5,
      windowDays: r?.attribution_window_days ?? 30,
      productIds: Array.isArray(r?.conditions?.productIds) ? r.conditions.productIds : [],
      stats,
    };
  }

  async saveProgram(user: RequestUser, sellerId: string, i: ProgramInput) {
    const rate = Number(i.ratePercent);
    const days = Number(i.windowDays);
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 50 || Math.round(rate * 100) !== rate * 100) throw badRequest('AFFILIATE_RATE_INVALID', 'La comisión debe estar entre 0,5 % y 50 %.');
    if (!Number.isInteger(days) || days < 1 || days > 90) throw badRequest('AFFILIATE_WINDOW_INVALID', 'La vigencia del enlace debe ser de 1 a 90 días.');
    const productIds = Array.isArray(i.productIds) ? [...new Set(i.productIds)] : [];
    if (productIds.length) {
      const own = await this.db.one(`select count(*)::int as n from public.products where id = any($1::uuid[]) and seller_id = $2 and status <> 'ARCHIVED'`, [productIds, sellerId]);
      if (own!.n !== productIds.length) throw badRequest('AFFILIATE_PRODUCTS_INVALID', 'Algunos productos no pertenecen a tu tienda.');
    }
    const conditions = productIds.length ? { productIds } : {};
    await this.db.tx(async (c) => {
      let link = await this.db.one(`select * from public.nx_seller_affiliate_programs where seller_id = $1 for update`, [sellerId], c);
      if (!link) {
        const store = await this.db.one(`select coalesce(ssp.display_name, s.slug) as name from public.sellers s left join public.seller_store_profiles ssp on ssp.seller_id = s.id where s.id = $1`, [sellerId], c);
        const tag = `${sellerId.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
        const program = await this.db.one(
          `insert into public.referral_programs (code, name, description, status, attribution_window_days, created_by)
           values ($1,$2,'Programa de afiliados de la tienda: la comisión la paga la tienda.','DRAFT',$3,$4) returning id`,
          [`NX-AFF-${tag}`, `Afiliados de ${store?.name ?? 'la tienda'}`.slice(0, 120), days, user.id],
          c,
        );
        const group = await this.db.one(
          `insert into public.business_rule_groups (rule_type_code, code, name, description, scope_type_code, scope_seller_id, priority, application_mode, created_by)
           values ('REFERRAL_COMMISSION',$1,'Comisión de afiliados de la tienda','La paga la tienda con sus ventas.','SELLER',$2,0,'EXCLUSIVE',$3) returning id`,
          [`NX-AFF-RULE-${tag}`, sellerId, user.id],
          c,
        );
        link = await this.db.one(
          `insert into public.nx_seller_affiliate_programs (seller_id, program_id, rule_group_id, created_by) values ($1,$2,$3,$4) returning *`,
          [sellerId, program!.id, group!.id, user.id],
          c,
        );
        await this.publish(c, link!.rule_group_id, link!.program_id, user.id, rate, conditions);
      } else {
        const cur = await this.db.one(
          `select v.conditions, d.percentage_rate::text as rate from public.business_rule_versions v join public.referral_rule_definitions d on d.rule_version_id = v.id
            where v.rule_group_id = $1 and v.status = 'ACTIVE' order by v.version_number desc limit 1`,
          [link.rule_group_id],
          c,
        );
        if (!cur || Number(cur.rate) !== rate / 100 || JSON.stringify(cur.conditions ?? {}) !== JSON.stringify(conditions))
          await this.publish(c, link.rule_group_id, link.program_id, user.id, rate, conditions);
      }
      await this.db.exec(
        `update public.referral_programs set status = $2, attribution_window_days = $3, activated_at = case when $2 = 'ACTIVE' then coalesce(activated_at, now()) else activated_at end,
                version = version + 1 where id = $1`,
        [link!.program_id, i.enabled ? 'ACTIVE' : 'PAUSED', days],
        c,
      );
      await this.db.exec(`update public.nx_seller_affiliate_programs set updated_at = now() where seller_id = $1`, [sellerId], c);
    });
    return this.program(sellerId);
  }

  private async publish(c: PoolClient, groupId: string, programId: string, actor: string, rate: number, conditions: object) {
    const v = await this.db.one(
      `select (public.create_business_rule_version($1,$2,$3::jsonb,'Comisión de afiliados','APPLICATION','Cambio del programa de afiliados',null)).id as id`,
      [groupId, actor, JSON.stringify(conditions)],
      c,
    );
    await this.db.exec(
      `insert into public.referral_rule_definitions (rule_version_id, calculation_type, calculation_base_code, percentage_rate, funding_source_code,
               seller_funding_rate, platform_funding_rate, requires_new_customer, first_order_only, program_id, rounding_mode)
       values ($1,'PERCENTAGE','PRODUCT_AFTER_DISCOUNT',$2,'SELLER',1,0,false,false,$3,'CURRENCY_PRECISION')`,
      [v!.id, (rate / 100).toFixed(6), programId],
      c,
    );
    await this.db.exec(`select public.publish_business_rule_version($1,$2,now(),'APPLICATION','Cambio del programa de afiliados',null)`, [v!.id, actor], c);
  }

  /** Active program terms for a store (rule in force), or null. */
  private async active(sellerId: string, c?: PoolClient) {
    const r = await this.db.one(activeAffiliateProgramSql('$1'), [sellerId], c);
    if (!r) return null;
    return {
      programId: r.program_id as string,
      windowDays: r.attribution_window_days as number,
      ruleVersionId: r.rule_version_id as string,
      rate: r.rate as string,
      productIds: r.product_ids as string[] | null,
    };
  }

  // ------------------------------------------------------------------ public offer & links
  async offerForProduct(productId: string) {
    const p = await this.db.one(`select seller_id from public.products where id = $1 and status in ('ACTIVE','OUT_OF_STOCK')`, [productId]);
    if (!p) return null;
    const a = await this.active(p.seller_id);
    if (!a || (a.productIds && !a.productIds.includes(productId))) return null;
    return { sellerId: p.seller_id, ratePercent: Number((Number(a.rate) * 100).toFixed(2)), windowDays: a.windowDays };
  }

  /** The user's personal code for a store's program (created on first request). */
  async link(user: RequestUser, sellerId: string) {
    if (user.sellers?.some((s) => s.id === sellerId)) throw badRequest('AFFILIATE_OWN_STORE', 'No puedes ser afiliado de tu propia tienda.');
    const a = await this.active(sellerId);
    if (!a) throw conflict('AFFILIATE_PROGRAM_INACTIVE', 'Esta tienda no tiene un programa de afiliados activo.');
    let code = await this.db.one(`select code::text as code from public.referral_codes where program_id = $1 and owner_user_id = $2 and status = 'ACTIVE'`, [a.programId, user.id]);
    if (!code) {
      for (let attempt = 0; attempt < 5 && !code; attempt++)
        code = await this.db.one(
          `insert into public.referral_codes (program_id, owner_user_id, code) values ($1,$2,$3) on conflict (code) do nothing returning code::text as code`,
          [a.programId, user.id, newCode()],
        );
      if (!code) throw conflict('AFFILIATE_CODE_FAILED', 'No se pudo generar tu enlace. Inténtalo de nuevo.');
    }
    return { code: code.code, ratePercent: Number((Number(a.rate) * 100).toFixed(2)), windowDays: a.windowDays };
  }

  /**
   * Records which affiliate brought the buyer (last link wins, per store). Own codes and
   * codes of inactive programs are ignored silently.
   */
  async track(user: RequestUser, codes: string[]) {
    let tracked = 0;
    for (const raw of [...new Set(codes.map((x) => String(x ?? '').trim().toUpperCase()).filter((x) => /^[A-Z0-9]{6,16}$/.test(x)))].slice(0, 10)) {
      const rc = await this.db.one(
        `select rc.id, rc.program_id, rc.owner_user_id, p.attribution_window_days, nsp.seller_id
           from public.referral_codes rc join public.referral_programs p on p.id = rc.program_id and p.status = 'ACTIVE'
           join public.nx_seller_affiliate_programs nsp on nsp.program_id = p.id
          where rc.code = $1::citext and rc.status = 'ACTIVE' and (rc.expires_at is null or rc.expires_at > now())`,
        [raw],
      );
      if (!rc || rc.owner_user_id === user.id || user.sellers?.some((s) => s.id === rc.seller_id)) continue;
      await this.db.tx(async (c) => {
        const cur = await this.db.one(
          `select id, referrer_id from public.referral_attributions where program_id = $1 and customer_id = $2 and status = 'ACTIVE' and expires_at > now() for update`,
          [rc.program_id, user.id],
          c,
        );
        if (cur?.referrer_id === rc.owner_user_id) {
          await this.db.exec(`update public.referral_attributions set expires_at = now() + $2 * interval '1 day' where id = $1`, [cur.id, rc.attribution_window_days], c);
          return;
        }
        if (cur) await this.db.exec(`update public.referral_attributions set status = 'INVALIDATED', invalidated_at = now() where id = $1`, [cur.id], c);
        await this.db.exec(
          `insert into public.referral_attributions (program_id, referral_code_id, customer_id, referrer_id, source, expires_at, metadata)
           values ($1,$2,$3,$4,'LINK', now() + $5 * interval '1 day', '{}'::jsonb)`,
          [rc.program_id, rc.id, user.id, rc.owner_user_id, rc.attribution_window_days],
          c,
        );
      });
      tracked++;
    }
    return { tracked };
  }

  // ------------------------------------------------------------------ checkout
  /**
   * Referral eligibility for one store's lines: the buyer must have an active attribution
   * for the store's active program. Commission = rate × product net after discount.
   */
  async forCheckout(c: PoolClient, customerId: string, sellerId: string, lines: { key: string; productId: string; net: Minor }[]) {
    const a = await this.active(sellerId, c);
    if (!a) return null;
    const att = await this.db.one(
      `select id, referrer_id from public.referral_attributions where program_id = $1 and customer_id = $2 and status = 'ACTIVE' and expires_at > now()
        order by attributed_at desc limit 1`,
      [a.programId, customerId],
      c,
    );
    if (!att || att.referrer_id === customerId) return null;
    const items = lines
      .filter((l) => !a.productIds || a.productIds.includes(l.productId))
      .map((l) => ({ itemId: l.key, base: l.net, commission: applyRate(l.net, a.rate) }))
      .filter((x) => x.commission > 0n);
    if (!items.length) return null;
    return {
      programId: a.programId,
      attributionId: att.id as string,
      referrerId: att.referrer_id as string,
      ruleVersionId: a.ruleVersionId,
      rate: a.rate,
      items,
      eligible: items.reduce((s, x) => s + x.base, 0n),
      commission: items.reduce((s, x) => s + x.commission, 0n),
      snapshot: {
        sellerId, ruleVersionId: a.ruleVersionId, rate: a.rate, baseCode: 'PRODUCT_AFTER_DISCOUNT',
        items: items.map((x) => ({ itemId: x.itemId, base: fromMinor(x.base), commission: fromMinor(x.commission), raw: fromMinor(x.commission), baseCode: 'PRODUCT_AFTER_DISCOUNT' })),
      },
    };
  }

  // ------------------------------------------------------------------ affiliate dashboard
  async dashboard(user: RequestUser) {
    const [links, earnings, balances, profile] = await Promise.all([
      this.db.many(
        `select rc.code::text as code, nsp.seller_id, s.slug, coalesce(ssp.display_name, s.slug) as store, p.status, p.attribution_window_days,
                (select d.percentage_rate::text from public.business_rule_versions v join public.referral_rule_definitions d on d.rule_version_id = v.id
                  where v.rule_group_id = nsp.rule_group_id and v.status = 'ACTIVE' order by v.version_number desc limit 1) as rate,
                (select count(*)::int from public.referral_attributions ra where ra.referral_code_id = rc.id) as visitors,
                (select count(distinct x.order_id)::int from public.referral_commissions x where x.referrer_id = rc.owner_user_id and x.referral_program_id = rc.program_id) as orders
           from public.referral_codes rc join public.nx_seller_affiliate_programs nsp on nsp.program_id = rc.program_id
           join public.referral_programs p on p.id = rc.program_id join public.sellers s on s.id = nsp.seller_id
           left join public.seller_store_profiles ssp on ssp.seller_id = s.id
          where rc.owner_user_id = $1 and rc.status = 'ACTIVE' order by rc.created_at desc`,
        [user.id],
      ),
      this.db.many(
        `select rc.id, rc.final_amount::text as amount, rc.currency_code, rc.status, rc.created_at, rc.available_at, rc.paid_at,
                o.public_number as order_number, coalesce(ssp.display_name, s.slug) as store, ois.product_title,
                coalesce((select sum(rv.reversal_amount) from public.referral_commission_reversals rv where rv.referral_commission_id = rc.id),0)::text as reversed,
                ar.hold_seconds, ar.status as hold_status
           from public.referral_commissions rc join public.orders o on o.id = rc.order_id
           join public.seller_orders so on so.id = rc.seller_order_id join public.sellers s on s.id = so.seller_id
           left join public.seller_store_profiles ssp on ssp.seller_id = s.id
           left join public.order_item_snapshots ois on ois.order_item_id = rc.order_item_id
           left join public.referral_availability_records ar on ar.referral_commission_id = rc.id
          where rc.referrer_id = $1 order by rc.created_at desc limit 200`,
        [user.id],
      ),
      this.balances(user.id),
      this.db.one(`select method, paypal_email, bank from public.nx_affiliate_payout_profiles where user_id = $1`, [user.id]),
    ]);
    return {
      links: links.map((l: any) => ({ code: l.code, sellerId: l.seller_id, store: l.store, slug: l.slug, active: l.status === 'ACTIVE', ratePercent: l.rate != null ? Number((Number(l.rate) * 100).toFixed(2)) : null, windowDays: l.attribution_window_days, visitors: l.visitors, orders: l.orders })),
      earnings: earnings.map((e: any) => ({
        id: e.id, amount: e.amount, reversed: e.reversed, currency: e.currency_code, createdAt: e.created_at, availableAt: e.available_at, paidAt: e.paid_at,
        order: orderRef(e.order_number), store: e.store, product: e.product_title,
        status: Number(e.reversed) >= Number(e.amount) ? 'REVERSED' : e.status,
      })),
      balances,
      payoutProfile: profile ? { method: profile.method, paypalEmail: profile.paypal_email, bank: profile.bank } : null,
    };
  }

  private async balances(userId: string) {
    const r = await this.db.one(
      `select coalesce(sum(public.ledger_account_posted_balance(la.id)) filter (where la.definition_code = 'REFERRAL_PENDING'),0)::text as pending,
              coalesce(sum(public.ledger_account_posted_balance(la.id)) filter (where la.definition_code = 'REFERRAL_AVAILABLE'),0)::text as available
         from public.ledger_accounts la where la.owner_user_id = $1 and la.definition_code in ('REFERRAL_PENDING','REFERRAL_AVAILABLE')`,
      [userId],
    );
    const paid = await this.db.one(
      `select coalesce(sum(sr.amount),0)::text as paid from public.referral_user_settlement_reservations sr
         join public.referral_user_settlement_results st on st.reservation_id = sr.id and st.result = 'SETTLED' where sr.owner_user_id = $1`,
      [userId],
    );
    return { pending: r!.pending, available: r!.available, paid: paid!.paid };
  }

  async setPayoutProfile(user: RequestUser, i: PayoutProfileInput) {
    if (i.method === 'PAYPAL') {
      const email = String(i.paypalEmail ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) throw badRequest('PAYOUT_EMAIL_INVALID', 'Indica el correo de tu cuenta PayPal.');
      await this.db.exec(
        `insert into public.nx_affiliate_payout_profiles (user_id, method, paypal_email, bank, updated_at) values ($1,'PAYPAL',$2,'{}'::jsonb,now())
         on conflict (user_id) do update set method = 'PAYPAL', paypal_email = excluded.paypal_email, bank = '{}'::jsonb, updated_at = now()`,
        [user.id, email],
      );
    } else if (i.method === 'BANK') {
      const b = i.bank ?? {};
      const clean = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
      const bank = { holderName: clean(b.holderName, 80), bankName: clean(b.bankName, 80), accountNumber: clean(b.accountNumber, 40), accountType: clean(b.accountType, 20), routingCode: clean(b.routingCode, 20), country: clean(b.country, 2).toUpperCase() };
      if (bank.holderName.length < 3 || bank.bankName.length < 2 || !/^[A-Za-z0-9-]{4,40}$/.test(bank.accountNumber) || !/^[A-Z]{2}$/.test(bank.country))
        throw badRequest('PAYOUT_BANK_INVALID', 'Completa el titular, el banco, el número de cuenta y el país.');
      await this.db.exec(
        `insert into public.nx_affiliate_payout_profiles (user_id, method, paypal_email, bank, updated_at) values ($1,'BANK',null,$2::jsonb,now())
         on conflict (user_id) do update set method = 'BANK', paypal_email = null, bank = excluded.bank, updated_at = now()`,
        [user.id, JSON.stringify(bank)],
      );
    } else if ((WALLET_METHODS as readonly string[]).includes(i.method)) {
      const holderName = String(i.wallet?.holderName ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
      let account = String(i.wallet?.account ?? '').trim().toLowerCase();
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(account) && account.length <= 254;
      const phone = account.replace(/[\s().-]/g, '');
      const isUsPhone = /^(\+?1)?[2-9]\d{9}$/.test(phone);
      if (i.method === 'ZELLE' && !isEmail && isUsPhone) account = `+1${phone.slice(-10)}`;
      else if (!isEmail)
        throw badRequest('PAYOUT_WALLET_INVALID', i.method === 'ZELLE' ? 'Indica el correo o el teléfono de EE. UU. registrado en Zelle.' : 'Indica el correo de tu cuenta.');
      if (holderName.length < 3) throw badRequest('PAYOUT_HOLDER_REQUIRED', 'Indica el nombre del titular de la cuenta.');
      await this.db.exec(
        `insert into public.nx_affiliate_payout_profiles (user_id, method, paypal_email, bank, updated_at) values ($1,$2,null,$3::jsonb,now())
         on conflict (user_id) do update set method = excluded.method, paypal_email = null, bank = excluded.bank, updated_at = now()`,
        [user.id, i.method, JSON.stringify({ holderName, account })],
      );
    } else throw badRequest('PAYOUT_METHOD_INVALID', 'Elige cómo quieres cobrar.');
    return (await this.dashboard(user)).payoutProfile;
  }

  // ------------------------------------------------------------------ admin payouts
  async payables() {
    const rows = await this.db.many(
      `select u.id, u.email::text as email, coalesce(up.display_name, u.email::text) as name, pp.method, pp.paypal_email, pp.bank,
              sum(public.ledger_account_posted_balance(la.id))::text as available,
              (select count(*)::int from public.referral_commissions rc where rc.referrer_id = u.id and rc.status = 'AVAILABLE') as earnings
         from public.ledger_accounts la join public.users u on u.id = la.owner_user_id
         left join public.user_profiles up on up.user_id = u.id
         left join public.nx_affiliate_payout_profiles pp on pp.user_id = u.id
        where la.definition_code = 'REFERRAL_AVAILABLE'
        group by u.id, u.email, up.display_name, pp.method, pp.paypal_email, pp.bank
       having sum(public.ledger_account_posted_balance(la.id)) > 0
        order by 7 desc`,
    );
    return rows.map((r: any) => ({ userId: r.id, name: r.name, email: r.email, available: r.available, earnings: r.earnings,
      payoutProfile: r.method ? { method: r.method, paypalEmail: r.paypal_email, bank: r.bank } : null }));
  }

  /** Admin pays the affiliate everything available (outside the platform) and records the reference. */
  async pay(admin: RequestUser, userId: string, reference: string) {
    const ref = String(reference ?? '').trim();
    if (ref.length < 3 || ref.length > 80) throw badRequest('PAYOUT_REFERENCE_REQUIRED', 'Indica la referencia del pago realizado.');
    const earnings = await this.db.many(
      `select rc.id, coalesce(n.residual_amount, ar.amount)::text as released,
              coalesce((select sum(sr.amount) from public.referral_user_settlement_reservations sr join public.referral_user_settlement_results st
                          on st.reservation_id = sr.id and st.result = 'SETTLED' where sr.referral_commission_id = rc.id),0)::text as settled
         from public.referral_commissions rc join public.referral_availability_records ar on ar.referral_commission_id = rc.id and ar.status = 'RELEASED'
         left join public.referral_net_release_evidence n on n.availability_record_id = ar.id
        where rc.referrer_id = $1 and rc.status = 'AVAILABLE' order by rc.available_at`,
      [userId],
    );
    if (!earnings.length) throw conflict('NOTHING_TO_PAY', 'Este afiliado no tiene comisiones disponibles para pagar.');
    const corr = randomUUID();
    let total = 0;
    const paidAt = new Date(Date.now() - 1000);
    for (const e of earnings) {
      const amount = Math.round((Number(e.released) - Number(e.settled)) * 100) / 100;
      if (amount <= 0) continue;
      await this.db.exec(`select public.settle_referral_user_manually($1,$2,$3,$4,$5,$6,$7)`, [e.id, admin.id, amount.toFixed(2), `affiliate-pay:${e.id}:${corr}`, ref, paidAt, corr]);
      total += amount;
    }
    await this.notifications.notify(userId, {
      category: 'PAYMENTS', eventType: 'AFFILIATE_PAID', title: 'Te pagamos tus comisiones de afiliado',
      body: `Enviamos ${total.toFixed(2)} a tu método de cobro (referencia ${ref}).`,
      localized: {
        en: { title: 'We paid your affiliate commissions', body: `We sent ${total.toFixed(2)} to your payout method (reference ${ref}).` },
        fr: { title: 'Nous avons versé vos commissions d’affiliation', body: `Nous avons envoyé ${total.toFixed(2)} sur votre moyen de versement (référence ${ref}).` },
        ht: { title: 'Nou peye komisyon afilye ou yo', body: `Nou voye ${total.toFixed(2)} sou metòd peman ou (referans ${ref}).` },
      }, url: '/cuenta/afiliados', entityType: 'USER', entityId: userId, dedupeKey: `affiliate-paid:${corr}`,
    });
    return { paid: total.toFixed(2), earnings: earnings.length };
  }

  // ------------------------------------------------------------------ jobs
  /** Notifies new earnings and releases the ones whose delivery + return window passed. */
  async processDue() {
    const fresh = await this.db.many(
      `select rc.id, rc.referrer_id, rc.final_amount::text as amount, coalesce(ssp.display_name, s.slug) as store
         from public.referral_commissions rc join public.seller_orders so on so.id = rc.seller_order_id join public.sellers s on s.id = so.seller_id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where rc.created_at > now() - interval '3 days' and not exists (select 1 from public.notifications n where n.user_id = rc.referrer_id and n.deduplication_key = 'affiliate-earning:' || rc.id)
        limit 200`,
    );
    for (const e of fresh)
      await this.notifications.notify(e.referrer_id, {
        category: 'PAYMENTS', eventType: 'AFFILIATE_EARNING', title: 'Ganaste una comisión de afiliado',
        body: `Una compra en ${e.store} con tu enlace te generó ${Number(e.amount).toFixed(2)}. Estará disponible tras la entrega y el plazo de devolución.`,
        localized: {
          en: { title: 'You earned an affiliate commission', body: `A purchase at ${e.store} through your link earned you ${Number(e.amount).toFixed(2)}. It becomes available after delivery and the return window.` },
          fr: { title: 'Vous avez gagné une commission d’affiliation', body: `Un achat chez ${e.store} via votre lien vous a rapporté ${Number(e.amount).toFixed(2)}. Elle sera disponible après la livraison et le délai de retour.` },
          ht: { title: 'Ou touche yon komisyon afilye', body: `Yon acha nan ${e.store} ak lyen ou ba ou ${Number(e.amount).toFixed(2)}. L ap disponib apre livrezon ak delè retou a.` },
        },
        url: '/cuenta/afiliados', entityType: 'REFERRAL_COMMISSION', entityId: e.id, dedupeKey: `affiliate-earning:${e.id}`,
      });
    const due = await this.db.many(
      `select ar.id, rc.referrer_id, rc.id as earning_id from public.referral_availability_records ar join public.referral_commissions rc on rc.id = ar.referral_commission_id
        join public.order_items oi on oi.id = rc.order_item_id
        where ar.status = 'PENDING' and rc.status = 'PENDING' and oi.delivered_quantity >= oi.quantity
          and not exists (select 1 from public.nx_payment_incidents i where i.order_id = oi.order_id and i.status = 'OPEN')
          and not exists (select 1 from public.payment_disputes pd where pd.order_id = oi.order_id and pd.status in ('OPEN','UNDER_REVIEW'))
        limit 200`,
    );
    let released = 0;
    for (const d of due) {
      try {
        const r = await this.db.tx(async (c) => (await this.db.one(`select public.nx_release_referral_earning($1, null) as r`, [d.id], c))!.r);
        if (r === 'RELEASED') {
          released++;
          await this.notifications.notify(d.referrer_id, {
            category: 'PAYMENTS', eventType: 'AFFILIATE_AVAILABLE', title: 'Tu comisión de afiliado ya está disponible',
            body: 'La compra se entregó y pasó el plazo de devolución. Te la pagaremos al método de cobro que registraste.', url: '/cuenta/afiliados',
            localized: {
              en: { title: 'Your affiliate commission is available', body: 'The purchase was delivered and the return window passed. We’ll pay it to the payout method you registered.' },
              fr: { title: 'Votre commission d’affiliation est disponible', body: 'L’achat a été livré et le délai de retour est passé. Nous la verserons sur le moyen que vous avez enregistré.' },
              ht: { title: 'Komisyon afilye ou disponib', body: 'Acha a livre epi delè retou a pase. N ap peye l sou metòd peman ou anrejistre a.' },
            },
            entityType: 'REFERRAL_COMMISSION', entityId: d.earning_id, dedupeKey: `affiliate-available:${d.earning_id}`,
          });
        }
      } catch (e: any) {
        this.logger.warn(`release referral ${d.id}: ${e.message}`);
      }
    }
    return { notified: fresh.length, released };
  }

  /** Earnings and affiliate commission of a seller order (for the order detail). */
  async forSellerOrder(sellerOrderId: string) {
    const r = await this.db.one(
      `select coalesce(sum(final_amount),0)::text as commission,
              coalesce((select sum(rv.reversal_amount) from public.referral_commission_reversals rv join public.referral_commissions x on x.id = rv.referral_commission_id where x.seller_order_id = $1),0)::text as reversed
         from public.referral_commissions where seller_order_id = $1`,
      [sellerOrderId],
    );
    return r;
  }
}
