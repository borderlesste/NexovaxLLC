import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';
import { badRequest } from '../common/errors';

export interface ShippingRate {
  code: string;
  name: string;
  description: string;
  amount: number;
  estimated_days: number;
  requires_address: boolean;
}

export interface PlatformSettings {
  'marketplace.name': string;
  'marketplace.base_url': string;
  'marketplace.support_email': string;
  'marketplace.currency': string;
  'marketplace.locale': string;
  'tax.itbis_rate': number;
  'shipping.rates': ShippingRate[];
  'features.featured_products': boolean;
  'features.seller_registration': boolean;
  'features.mandatory_moderation': boolean;
  'features.email_notifications': boolean;
}

const DEFAULTS: PlatformSettings = {
  'marketplace.name': 'RD Marketplace Multivendedor',
  'marketplace.base_url': 'http://localhost:3000',
  'marketplace.support_email': 'soporte@rdmarketplace.do',
  'marketplace.currency': 'DOP',
  'marketplace.locale': 'es-DO',
  'tax.itbis_rate': 0.18,
  'shipping.rates': [],
  'features.featured_products': true,
  'features.seller_registration': true,
  'features.mandatory_moderation': true,
  'features.email_notifications': true,
};

/** Reads/writes versioned, typed platform settings (public.system_setting_values). */
@Injectable()
export class SettingsService {
  private cache?: { at: number; value: PlatformSettings };

  constructor(private readonly db: DbService) {}

  async all(client?: Queryable): Promise<PlatformSettings> {
    if (!client && this.cache && Date.now() - this.cache.at < 30_000) return this.cache.value;
    const rows = await this.db.many<{ setting_key: string; value: any }>(
      `select distinct on (setting_key) setting_key, value
         from public.system_setting_values
        where scope_type = 'GLOBAL' and status = 'ACTIVE'
          and (effective_at is null or effective_at <= now())
          and (expires_at is null or expires_at > now())
        order by setting_key, version_number desc`,
      [],
      client,
    );
    const out: any = { ...DEFAULTS };
    for (const r of rows) out[r.setting_key] = r.value;
    if (!client) this.cache = { at: Date.now(), value: out };
    return out;
  }

  async get<K extends keyof PlatformSettings>(key: K, client?: Queryable): Promise<PlatformSettings[K]> {
    return (await this.all(client))[key];
  }

  async currency(client?: Queryable) {
    return (await this.get('marketplace.currency', client)) || 'DOP';
  }

  /** Publishes new versions for every changed key (audited by activate_system_setting_value). */
  async update(actorUserId: string, patch: Partial<PlatformSettings>) {
    const current = await this.all();
    const keys = Object.keys(patch) as (keyof PlatformSettings)[];
    await this.db.tx(async (c) => {
      for (const key of keys) {
        if (!(key in DEFAULTS)) throw badRequest('UNKNOWN_SETTING', `Configuración desconocida: ${key}`);
        const value = patch[key];
        if (JSON.stringify(value) === JSON.stringify(current[key])) continue;
        const row = await this.db.one<{ id: string }>(
          `insert into public.system_setting_values (setting_key, version_number, scope_type, value, checksum, created_by_user_id)
           values ($1, coalesce((select max(version_number) from public.system_setting_values where setting_key = $1), 0) + 1,
                   'GLOBAL', $2::jsonb, decode(repeat('00', 32), 'hex'), $3)
           returning id`,
          [key, JSON.stringify(value), actorUserId],
          c,
        );
        await this.db.exec(`select public.activate_system_setting_value($1, $2, now())`, [row!.id, actorUserId], c);
      }
    });
    this.cache = undefined;
    return this.all();
  }
}
