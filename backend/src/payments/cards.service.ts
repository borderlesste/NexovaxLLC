import { Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { DbService } from '../db/db.service';
import { badRequest, conflict, notFound } from '../common/errors';
import { StripeService } from './stripe.service';

export interface SavedCard {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  expired: boolean;
}

/**
 * Saved cards: a Stripe Customer per buyer and environment, with references to its
 * card PaymentMethods (brand, last 4, expiry only). Card numbers never reach our servers.
 */
@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);
  constructor(
    private readonly db: DbService,
    private readonly stripe: StripeService,
  ) {}

  get enabled() {
    return this.stripe.enabled;
  }

  private get env() {
    return this.stripe.environment;
  }

  /** Stripe customer id of the buyer (created on first use). */
  async customerId(userId: string, create = true): Promise<string | null> {
    const row = await this.db.one<{ external_customer_id: string }>(
      `select external_customer_id from public.customer_payment_provider_profiles where customer_id = $1 and provider_code = 'STRIPE' and environment = $2 and status = 'ACTIVE'`,
      [userId, this.env],
    );
    if (row) return row.external_customer_id;
    if (!create) return null;
    const u = await this.db.one(
      `select u.email::text as email, coalesce(nullif(up.display_name,''), null) as name from public.users u left join public.user_profiles up on up.user_id = u.id where u.id = $1`,
      [userId],
    );
    const cus = await this.stripe.createCustomer({ email: u!.email, name: u!.name ?? undefined, userId, environment: this.env });
    await this.db.exec(
      `insert into public.customer_payment_provider_profiles (customer_id, provider_code, environment, external_customer_id, status, metadata)
       values ($1,'STRIPE',$2,$3,'ACTIVE','{}'::jsonb)
       on conflict (customer_id, provider_code, environment) do update set external_customer_id = excluded.external_customer_id, status = 'ACTIVE'`,
      [userId, this.env, cus.id],
    );
    return cus.id;
  }

  async list(userId: string): Promise<SavedCard[]> {
    const rows = await this.db.many(
      `select id, display_brand, display_last4, expiry_month, expiry_year, is_default
         from public.customer_payment_method_references
        where customer_id = $1 and provider_code = 'STRIPE' and environment = $2 and status = 'ACTIVE' and reusable
        order by is_default desc, created_at desc`,
      [userId, this.env],
    );
    const now = new Date();
    return rows.map((r: any) => ({
      id: r.id,
      brand: r.display_brand,
      last4: r.display_last4,
      expMonth: r.expiry_month,
      expYear: r.expiry_year,
      isDefault: r.is_default,
      expired: !!r.expiry_year && (r.expiry_year < now.getFullYear() || (r.expiry_year === now.getFullYear() && r.expiry_month < now.getMonth() + 1)),
    }));
  }

  /** SetupIntent so the buyer can add a card from the profile (3-D Secure handled by Stripe.js). */
  async setup(userId: string) {
    const cus = await this.customerId(userId);
    const si = await this.stripe.createSetupIntent(cus!);
    return { clientSecret: si.client_secret };
  }

  /** Records the card of a succeeded SetupIntent. */
  async confirmSetup(userId: string, setupIntentId: string) {
    if (!/^seti_[A-Za-z0-9]+$/.test(setupIntentId)) throw badRequest('SETUP_INVALID', 'Operación inválida.');
    const cus = await this.customerId(userId, false);
    const si = await this.stripe.retrieveSetupIntent(setupIntentId);
    if (!cus || si.customer !== cus) throw notFound('Tarjeta');
    if (si.status !== 'succeeded' || !si.payment_method) throw conflict('CARD_NOT_CONFIRMED', 'La tarjeta no fue confirmada. Inténtalo de nuevo.');
    await this.record(userId, typeof si.payment_method === 'string' ? si.payment_method : si.payment_method.id);
    return this.list(userId);
  }

  /** After a paid checkout where the buyer chose "save this card". */
  async recordFromIntent(userId: string, pi: Stripe.PaymentIntent) {
    try {
      if (pi.metadata?.save_card !== '1' || !pi.customer || !pi.payment_method) return;
      const cus = await this.customerId(userId, false);
      if ((typeof pi.customer === 'string' ? pi.customer : pi.customer.id) !== cus) return;
      await this.record(userId, typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method.id);
    } catch (e: any) {
      this.logger.warn(`save card: ${e?.message}`);
    }
  }

  private async record(userId: string, paymentMethodId: string) {
    const pm = await this.stripe.retrievePaymentMethod(paymentMethodId);
    if (pm.type !== 'card' || !pm.card) throw badRequest('CARD_INVALID', 'Solo se pueden guardar tarjetas.');
    const cus = await this.customerId(userId, false);
    if (!cus || (typeof pm.customer === 'string' ? pm.customer : pm.customer?.id) !== cus) throw notFound('Tarjeta');
    const profile = await this.db.one(`select id from public.customer_payment_provider_profiles where customer_id = $1 and provider_code = 'STRIPE' and environment = $2`, [userId, this.env]);
    await this.db.tx(async (c) => {
      // Same physical card saved twice (Stripe fingerprint): keep only the newest reference.
      const fp = pm.card!.fingerprint;
      const any = await this.db.one(`select 1 from public.customer_payment_method_references where customer_id = $1 and environment = $2 and status = 'ACTIVE' limit 1`, [userId, this.env], c);
      await this.db.exec(
        `insert into public.customer_payment_method_references (customer_id, provider_profile_id, provider_code, environment, external_payment_method_id, method_type,
                display_brand, display_last4, expiry_month, expiry_year, reusable, is_default, status)
         values ($1,$2,'STRIPE',$3,$4,'CARD',$5,$6,$7,$8,true,$9,'ACTIVE')
         on conflict (provider_code, environment, external_payment_method_id) do update set status = 'ACTIVE', reusable = true`,
        [userId, profile!.id, this.env, pm.id, pm.card!.brand, pm.card!.last4, pm.card!.exp_month, pm.card!.exp_year, !any],
        c,
      );
      if (fp) {
        const dups = await this.db.many(
          `select id, external_payment_method_id from public.customer_payment_method_references
            where customer_id = $1 and environment = $2 and status = 'ACTIVE' and external_payment_method_id <> $3
              and display_brand = $4 and display_last4 = $5 and expiry_month = $6 and expiry_year = $7`,
          [userId, this.env, pm.id, pm.card!.brand, pm.card!.last4, pm.card!.exp_month, pm.card!.exp_year],
          c,
        );
        for (const d of dups) {
          const other = await this.stripe.retrievePaymentMethod(d.external_payment_method_id).catch(() => null);
          if (other?.card?.fingerprint === fp) {
            await this.db.exec(`update public.customer_payment_method_references set status = 'DETACHED', is_default = false where id = $1`, [d.id], c);
            await this.stripe.detachPaymentMethod(d.external_payment_method_id).catch(() => undefined);
          }
        }
      }
      await this.ensureDefault(c, userId);
    });
  }

  async remove(userId: string, id: string) {
    const ref = await this.db.one(
      `select id, external_payment_method_id from public.customer_payment_method_references where id = $1 and customer_id = $2 and status = 'ACTIVE'`,
      [id, userId],
    );
    if (!ref) throw notFound('Tarjeta');
    await this.stripe.detachPaymentMethod(ref.external_payment_method_id);
    await this.db.tx(async (c) => {
      await this.db.exec(`update public.customer_payment_method_references set status = 'DETACHED', is_default = false, reusable = false where id = $1`, [id], c);
      await this.ensureDefault(c, userId);
    });
    return this.list(userId);
  }

  async setDefault(userId: string, id: string) {
    await this.db.tx(async (c) => {
      const ref = await this.db.one(`select id from public.customer_payment_method_references where id = $1 and customer_id = $2 and status = 'ACTIVE'`, [id, userId], c);
      if (!ref) throw notFound('Tarjeta');
      await this.db.exec(`update public.customer_payment_method_references set is_default = (id = $2) where customer_id = $1 and environment = $3 and status = 'ACTIVE'`, [userId, id, this.env], c);
    });
    return this.list(userId);
  }

  private async ensureDefault(c: any, userId: string) {
    await this.db.exec(
      `update public.customer_payment_method_references r set is_default = true
        where r.id = (select id from public.customer_payment_method_references where customer_id = $1 and environment = $2 and status = 'ACTIVE' order by created_at desc limit 1)
          and not exists (select 1 from public.customer_payment_method_references x where x.customer_id = $1 and x.environment = $2 and x.status = 'ACTIVE' and x.is_default)`,
      [userId, this.env],
      c,
    );
  }

  /** Resolves a saved card of the buyer for a payment (Stripe ids). */
  async forPayment(userId: string, savedCardId: string) {
    const ref = await this.db.one(
      `select r.external_payment_method_id, p.external_customer_id, r.expiry_month, r.expiry_year
         from public.customer_payment_method_references r join public.customer_payment_provider_profiles p on p.id = r.provider_profile_id
        where r.id = $1 and r.customer_id = $2 and r.status = 'ACTIVE' and r.environment = $3`,
      [savedCardId, userId, this.env],
    );
    if (!ref) throw badRequest('SAVED_CARD_INVALID', 'La tarjeta guardada ya no está disponible. Elige otra o ingresa una nueva.');
    const now = new Date();
    if (ref.expiry_year < now.getFullYear() || (ref.expiry_year === now.getFullYear() && ref.expiry_month < now.getMonth() + 1))
      throw badRequest('SAVED_CARD_EXPIRED', 'La tarjeta guardada está vencida. Elige otra o ingresa una nueva.');
    return { paymentMethodId: ref.external_payment_method_id as string, customerId: ref.external_customer_id as string };
  }
}
