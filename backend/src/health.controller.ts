import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth';
import { DbService } from './db/db.service';
import { SupabaseAdminService } from './storage/supabase-admin.service';
import { StripeService } from './payments/stripe.service';
import { PaypalService } from './payments/paypal.service';
import { config } from './config';

type State = 'OPERATIONAL' | 'DEGRADED' | 'DOWN';
const TTL_MS = 60_000;

@Controller('health')
export class HealthController {
  private cache?: { at: number; data: any };
  private pending?: Promise<any>;

  constructor(
    private readonly db: DbService,
    private readonly supa: SupabaseAdminService,
    private readonly stripe: StripeService,
    private readonly paypal: PaypalService,
  ) {}

  @Public()
  @Get()
  async health() {
    const started = Date.now();
    let database = 'down';
    try {
      await this.db.one('select 1 as ok');
      database = 'up';
    } catch {}
    return { status: database === 'up' ? 'ok' : 'degraded', database, storage: this.supa.enabled ? 'configured' : 'not_configured', latencyMs: Date.now() - started };
  }

  /**
   * Public status of the main services ("Estado de la plataforma"): each one is actually checked,
   * cached for a minute so the page can't be used to hammer the providers. No internals are exposed.
   */
  @Public()
  @Get('services')
  async services() {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.data;
    this.pending ??= this.check().then((data) => {
      this.cache = { at: Date.now(), data };
      return data;
    }).finally(() => (this.pending = undefined));
    return this.pending;
  }

  private async check() {
    const timed = async (fn: () => Promise<unknown>, ms = 6000) => {
      const t0 = Date.now();
      try {
        await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
        return { ok: true, ms: Date.now() - t0 };
      } catch {
        return { ok: false, ms: Date.now() - t0 };
      }
    };
    const db = await timed(() => this.db.one('select 1 as ok'));

    // Web: API + database answering, and not slow.
    const web: State = !db.ok ? 'DOWN' : db.ms > 1500 ? 'DEGRADED' : 'OPERATIONAL';

    // Payments: every configured processor answers, and webhooks aren't failing.
    const procs = [
      ...(this.stripe.enabled ? [timed(() => this.stripe.ping())] : []),
      ...(this.paypal.enabled ? [timed(() => this.paypal.ping())] : []),
    ];
    const res = await Promise.all(procs);
    const failing = db.ok
      ? Number((await this.db.one<{ n: number }>(
          `select count(*)::int as n from public.integration_webhook_receipts where status = 'FAILED' and provider_code in ('STRIPE','PAYPAL') and received_at > now() - interval '1 hour'`,
        ).catch(() => ({ n: 0 })))!.n)
      : 0;
    const okProcs = res.filter((r) => r.ok).length;
    const payments: State = !db.ok || !res.length || okProcs === 0 ? 'DOWN' : okProcs < res.length || failing > 0 ? 'DEGRADED' : 'OPERATIONAL';

    // Messaging: conversations readable and e-mail delivery configured.
    const msg = db.ok ? await timed(() => this.db.one('select 1 from public.conversations limit 1')) : { ok: false, ms: 0 };
    const messaging: State = !msg.ok ? 'DOWN' : !config.resendApiKey ? 'DEGRADED' : 'OPERATIONAL';

    // Catalog: products readable and image storage configured.
    const cat = db.ok ? await timed(() => this.db.one(`select count(*) from public.products where status = 'ACTIVE'`)) : { ok: false, ms: 0 };
    const catalog: State = !cat.ok ? 'DOWN' : !this.supa.enabled || cat.ms > 1500 ? 'DEGRADED' : 'OPERATIONAL';

    const all: State[] = [web, payments, messaging, catalog];
    return {
      status: all.includes('DOWN') ? 'DOWN' : all.includes('DEGRADED') ? 'DEGRADED' : 'OPERATIONAL',
      checkedAt: new Date().toISOString(),
      services: [
        { code: 'WEB', status: web },
        { code: 'PAYMENTS', status: payments },
        { code: 'MESSAGING', status: messaging },
        { code: 'CATALOG', status: catalog },
      ],
    };
  }
}
