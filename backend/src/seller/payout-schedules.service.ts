import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { badRequest, conflict, notFound } from '../common/errors';
import { fromMinor, money, toMinor } from '../common/money';
import { RequestUser } from '../auth/auth';
import { SettingsService } from '../settings/settings.service';
import { MailService } from '../mail/mail.service';

export type Frequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export interface ScheduleInput {
  enabled: boolean;
  frequency: Frequency;
  weekday?: number;
  monthday?: number;
  accountId: string;
  minimumAmount?: number | string;
}

/** Scheduled runs happen at 13:00 UTC (morning in the Americas). */
const RUN_HOUR_UTC = 13;
const OPEN_PAYOUT = ['REQUESTED', 'APPROVAL_REQUIRED', 'APPROVED', 'PROCESSING'];

/** Next run strictly after `from`: ISO weekday 1–7 / day of month 1–28. */
export function nextRun(f: Frequency, weekday: number | null, monthday: number | null, from: Date, lastRun?: Date | null): Date {
  const at = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RUN_HOUR_UTC));
  if (f === 'MONTHLY') {
    let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), monthday!, RUN_HOUR_UTC));
    if (d <= from) d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, monthday!, RUN_HOUR_UTC));
    return d;
  }
  let d = at(from);
  const iso = (x: Date) => ((x.getUTCDay() + 6) % 7) + 1;
  while (iso(d) !== weekday || d <= from) d = new Date(d.getTime() + 86400_000);
  if (f === 'BIWEEKLY' && lastRun && d.getTime() - lastRun.getTime() < 13 * 86400_000) d = new Date(d.getTime() + 7 * 86400_000);
  return d;
}

/**
 * Automatic payouts: the seller picks a frequency and a verified payout account; on each
 * run the available balance is requested as a normal payout (same policy, approval and
 * ledger as a manual request). Runs are idempotent per seller and day.
 */
@Injectable()
export class PayoutSchedulesService {
  private readonly logger = new Logger(PayoutSchedulesService.name);
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
  ) {}

  private async policyMinimum(sellerId: string, currency: string) {
    const p = await this.db
      .one(
        `select ppd.minimum_payout_amount::text as minimum from public.resolve_payout_policy($1, $2, now()) r join public.payout_policy_definitions ppd on ppd.rule_version_id = r.rule_version_id`,
        [sellerId, currency],
      )
      .catch(() => null);
    return p?.minimum ?? '0';
  }

  async get(sellerId: string) {
    const currency = (await this.settings.currency()).toUpperCase();
    const [s, bal, minimum, open] = await Promise.all([
      this.db.one(
        `select ps.*, a.display_label, a.display_last4, a.status as account_status, a.verification_status
           from public.nx_seller_payout_schedules ps join public.seller_payout_accounts a on a.id = ps.payout_account_id
          where ps.seller_id = $1 and ps.currency_code = $2`,
        [sellerId, currency],
      ),
      this.db.one(`select available_amount::text as available from public.seller_balance_projections where seller_id = $1 and currency_code = $2`, [sellerId, currency]),
      this.policyMinimum(sellerId, currency),
      this.db.one(`select 1 from public.payouts where seller_id = $1 and status = any($2::text[]) limit 1`, [sellerId, OPEN_PAYOUT]),
    ]);
    return {
      currency,
      policyMinimum: money(minimum),
      available: money(bal?.available ?? 0),
      hasOpenPayout: !!open,
      schedule: s
        ? {
            enabled: s.enabled,
            frequency: s.frequency,
            weekday: s.weekday,
            monthday: s.monthday,
            accountId: s.payout_account_id,
            account: { label: s.display_label, last4: s.display_last4, usable: s.account_status === 'ACTIVE' && s.verification_status === 'VERIFIED' },
            minimumAmount: money(s.minimum_amount),
            nextRunAt: s.enabled ? s.next_run_at : null,
            lastRunAt: s.last_run_at,
            lastResult: s.last_result,
          }
        : null,
    };
  }

  async set(user: RequestUser, sellerId: string, input: ScheduleInput) {
    const currency = (await this.settings.currency()).toUpperCase();
    if (input.frequency === 'MONTHLY' ? !input.monthday : !input.weekday) throw badRequest('SCHEDULE_DAY_REQUIRED', 'Elige el día del retiro.');
    const acc = await this.db.one(`select status, verification_status from public.seller_payout_accounts where id = $1 and seller_id = $2`, [input.accountId, sellerId]);
    if (!acc) throw notFound('Método de cobro');
    if (input.enabled && (acc.status !== 'ACTIVE' || acc.verification_status !== 'VERIFIED'))
      throw conflict('PAYOUT_ACCOUNT_NOT_VERIFIED', 'El método de cobro debe estar verificado por el equipo del marketplace para usarlo en retiros automáticos.');
    const min = input.minimumAmount != null && input.minimumAmount !== '' ? fromMinor(toMinor(input.minimumAmount)) : '0.00';
    const wd = input.frequency === 'MONTHLY' ? null : input.weekday!;
    const md = input.frequency === 'MONTHLY' ? input.monthday! : null;
    const prev = await this.db.one(`select last_run_at from public.nx_seller_payout_schedules where seller_id = $1 and currency_code = $2`, [sellerId, currency]);
    const next = nextRun(input.frequency, wd, md, new Date(), prev?.last_run_at ?? null);
    await this.db.exec(
      `insert into public.nx_seller_payout_schedules (seller_id, currency_code, enabled, frequency, weekday, monthday, payout_account_id, minimum_amount, next_run_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (seller_id, currency_code) do update set enabled = excluded.enabled, frequency = excluded.frequency, weekday = excluded.weekday,
         monthday = excluded.monthday, payout_account_id = excluded.payout_account_id, minimum_amount = excluded.minimum_amount,
         next_run_at = excluded.next_run_at, updated_at = now()`,
      [sellerId, currency, input.enabled, input.frequency, wd, md, input.accountId, min, next, user.id],
    );
    return this.get(sellerId);
  }

  /** Runs every due schedule (hourly job). Returns how many payouts were requested. */
  async runDue(onlySellerId?: string) {
    const due = await this.db.many(
      `select ps.*, s.owner_user_id, s.status as seller_status from public.nx_seller_payout_schedules ps join public.sellers s on s.id = ps.seller_id
        where ps.enabled and ($1::uuid is not null and ps.seller_id = $1 or $1::uuid is null and ps.next_run_at <= now())
        order by ps.next_run_at limit 200`,
      [onlySellerId ?? null],
    );
    let created = 0;
    for (const s of due) {
      let result: string;
      let payoutId: string | null = null;
      try {
        const bal = await this.db.one(`select available_amount::text as available from public.seller_balance_projections where seller_id = $1 and currency_code = $2`, [s.seller_id, s.currency_code]);
        const available = toMinor(bal?.available ?? 0);
        const minimum = [toMinor(await this.policyMinimum(s.seller_id, s.currency_code)), toMinor(s.minimum_amount)].reduce((a, b) => (a > b ? a : b));
        const acc = await this.db.one(`select status, verification_status from public.seller_payout_accounts where id = $1`, [s.payout_account_id]);
        const open = await this.db.one(`select 1 from public.payouts where seller_id = $1 and status = any($2::text[]) limit 1`, [s.seller_id, OPEN_PAYOUT]);
        if (s.seller_status !== 'ACTIVE') result = 'SKIPPED_STORE_INACTIVE';
        else if (acc?.status !== 'ACTIVE' || acc?.verification_status !== 'VERIFIED') result = 'SKIPPED_ACCOUNT_NOT_VERIFIED';
        else if (open) result = 'SKIPPED_OPEN_PAYOUT';
        else if (available <= 0n || available < minimum) result = 'SKIPPED_BELOW_MINIMUM';
        else {
          const day = new Date().toISOString().slice(0, 10);
          const r = await this.db.tx((c) =>
            this.db.one(
              `select public.request_seller_payout($1,$2,$3,$4,$5,$6,$7,$8,now()) as id`,
              [s.seller_id, s.currency_code, s.payout_account_id, fromMinor(available), `auto-payout:${s.seller_id}:${s.currency_code}:${onlySellerId ? randomUUID() : day}`,
               s.owner_user_id, 'Retiro programado automático', randomUUID()],
              c,
            ),
          );
          payoutId = r!.id;
          result = 'REQUESTED';
          created++;
          this.mail.fire(() => this.mail.payoutScheduled(payoutId!));
        }
      } catch (e: any) {
        result = `FAILED: ${String(e?.message ?? e).slice(0, 200)}`;
        this.logger.warn(`auto payout ${s.seller_id}: ${e?.message}`);
      }
      const next = nextRun(s.frequency, s.weekday, s.monthday, new Date(), result === 'REQUESTED' ? new Date() : s.last_run_at);
      await this.db.exec(
        `update public.nx_seller_payout_schedules set last_run_at = now(), last_result = $3, last_payout_id = coalesce($4, last_payout_id), next_run_at = $5, updated_at = now()
          where seller_id = $1 and currency_code = $2`,
        [s.seller_id, s.currency_code, result, payoutId, next],
      );
    }
    return created;
  }

  /** Finance view: upcoming automatic payouts with the amount they would request today. */
  async upcoming() {
    const rows = await this.db.many(
      `select ps.seller_id, ps.currency_code, ps.frequency, ps.weekday, ps.monthday, ps.next_run_at, ps.last_run_at, ps.last_result, ps.minimum_amount::text as minimum,
              coalesce(ssp.display_name, s.slug) as store, a.display_label, a.display_last4, a.verification_status,
              coalesce(b.available_amount, 0)::text as available
         from public.nx_seller_payout_schedules ps join public.sellers s on s.id = ps.seller_id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         join public.seller_payout_accounts a on a.id = ps.payout_account_id
         left join public.seller_balance_projections b on b.seller_id = ps.seller_id and b.currency_code = ps.currency_code
        where ps.enabled order by ps.next_run_at limit 100`,
    );
    return rows.map((r: any) => ({
      sellerId: r.seller_id, store: r.store, currency: r.currency_code, frequency: r.frequency, weekday: r.weekday, monthday: r.monthday,
      nextRunAt: r.next_run_at, lastRunAt: r.last_run_at, lastResult: r.last_result, minimum: money(r.minimum), estimated: money(r.available),
      account: { label: r.display_label, last4: r.display_last4, verified: r.verification_status === 'VERIFIED' },
    }));
  }
}
