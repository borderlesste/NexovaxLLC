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
  /**
   * Where the rate applies (default ANY): DOMESTIC = same country as the store,
   * INTERNATIONAL = another country, COUNTRIES = only the listed destinations
   * (optionally only some states/provinces when a single country is listed).
   */
  zone?: 'ANY' | 'DOMESTIC' | 'INTERNATIONAL' | 'COUNTRIES';
  countries?: string[];
  regions?: string[];
}

/** True when a marketplace flat rate covers the route. */
export function rateCoversRoute(r: ShippingRate, originCountry: string | null | undefined, dest: { country_code: string; region?: string | null } | null) {
  const zone = r.zone ?? 'ANY';
  if (zone === 'ANY') return true;
  if (!dest) return zone !== 'COUNTRIES' || !!r.countries?.length; // no address yet: show it as an estimate
  const to = dest.country_code.toUpperCase();
  if (zone === 'DOMESTIC') return !!originCountry && to === originCountry.toUpperCase();
  if (zone === 'INTERNATIONAL') return !!originCountry && to !== originCountry.toUpperCase();
  if (!(r.countries ?? []).map((c) => c.toUpperCase()).includes(to)) return false;
  if (r.regions?.length && (r.countries ?? []).length === 1) {
    const reg = (dest.region ?? '').trim().toLowerCase();
    return r.regions.some((x) => x.trim().toLowerCase() === reg);
  }
  return true;
}

export interface BankTransferSettings {
  enabled: boolean;
  bank_name: string;
  account_holder: string;
  account_number: string;
  routing_or_swift?: string | null;
  iban?: string | null;
  instructions: string;
}

export interface HelpFaq { q: string; a: string; qEn?: string; aEn?: string }
export interface HelpSection { title: string; body: string; titleEn?: string; bodyEn?: string }
export interface HelpCommissions { body: string; bodyEn?: string; showRate: boolean; showPayoutMinimum: boolean }
export type SocialNetwork = 'facebook' | 'instagram' | 'youtube' | 'x' | 'tiktok' | 'linkedin' | 'whatsapp' | 'pinterest';
export interface SocialLink { network: SocialNetwork; url: string }

export interface PlatformSettings {
  'marketplace.name': string;
  'marketplace.base_url': string;
  'marketplace.support_email': string;
  'marketplace.currency': string;
  'marketplace.locale': string;
  'marketplace.default_country': string;
  'shipping.rates': ShippingRate[];
  'shipping.shippo_enabled': boolean;
  'payments.bank_transfer': BankTransferSettings;
  'features.featured_products': boolean;
  'features.seller_registration': boolean;
  'features.mandatory_moderation': boolean;
  'features.email_notifications': boolean;
  'help.faq': HelpFaq[];
  'help.sellers': { sections: HelpSection[] };
  'help.commissions': HelpCommissions;
  'social.links': SocialLink[];
}

const DEFAULTS: PlatformSettings = {
  'marketplace.name': 'NEXOVAX',
  'marketplace.base_url': 'http://localhost:3000',
  'marketplace.support_email': 'soporte@nexovax.com',
  'marketplace.currency': 'USD',
  'marketplace.locale': 'es',
  'marketplace.default_country': 'US',
  'shipping.rates': [],
  'shipping.shippo_enabled': true,
  'payments.bank_transfer': { enabled: false, bank_name: '', account_holder: '', account_number: '', instructions: '' },
  'features.featured_products': true,
  'features.seller_registration': true,
  'features.mandatory_moderation': true,
  'features.email_notifications': true,
  'help.faq': [
    { q: '¿Cómo compro en NEXOVAX?', a: 'Agrega productos al carrito desde cualquier tienda, ve a "Finalizar compra", elige tu dirección, el método de envío de cada tienda y paga con tarjeta o transferencia bancaria.' },
    { q: '¿Qué métodos de pago aceptan?', a: 'Tarjetas de crédito y débito, y transferencias bancarias. Con transferencia reservamos tu inventario por 72 horas mientras validamos el pago.' },
    { q: '¿Cuánto cuesta el envío?', a: 'Depende del origen de la tienda y de tu dirección. Mostramos tarifas en vivo de transportadoras (USPS, UPS, DHL Express y otras) o las tarifas del marketplace, y el retiro en tienda cuando está disponible.' },
    { q: '¿Hacen envíos internacionales?', a: 'Sí. Las tiendas despachan desde distintos países; en el checkout verás las transportadoras disponibles para tu país. Los envíos internacionales pueden estar sujetos a impuestos y aranceles de importación del país de destino.' },
    { q: '¿Cómo se calculan los impuestos?', a: 'Aplicamos el impuesto al consumo del país de destino (IVA, VAT, GST, ITBIS…) sobre el precio de los productos. Verás el detalle antes de confirmar la compra.' },
    { q: '¿Cómo sigo mi pedido?', a: 'En "Mi cuenta → Mis pedidos" verás el estado, la transportadora, el número de guía y el historial de eventos de cada envío. Los envíos con etiqueta se actualizan automáticamente.' },
    { q: '¿Puedo devolver un producto?', a: 'Sí, según la política de cada tienda (hasta 30 días). Escríbele al vendedor desde tu pedido o reporta un problema.' },
    { q: '¿Cómo vendo en NEXOVAX?', a: 'Crea una cuenta, completa el registro de tu tienda con tu país y tu identificación fiscal, y espera la verificación. Luego publica tus productos; pasan por moderación antes de mostrarse.' },
  ],
  'help.sellers': {
    sections: [
      { title: 'Registra tu tienda', body: 'Crea una cuenta y completa el registro de tu tienda con tu país, tu identificación fiscal y la dirección desde donde despachas. El equipo verifica los datos antes de activar la tienda.' },
      { title: 'Publica tus productos', body: 'Agrega fotos, descripción, atributos, variantes, precio, inventario y medidas del paquete. Cada publicación pasa por moderación antes de mostrarse en el catálogo.' },
      { title: 'Envía tus pedidos', body: 'Compra la etiqueta desde tu panel (se descuenta del envío que pagó el cliente) o despacha por tu cuenta y registra la guía: en ese caso recibes lo que el cliente pagó por el envío.' },
      { title: 'Devoluciones', body: 'Revisa las solicitudes, recibe e inspecciona los productos. Puedes tener una política propia más favorable que la del marketplace desde Devoluciones en tu panel.' },
    ],
  },
  'help.commissions': {
    body: 'La plataforma cobra una comisión por venta sobre el valor de los productos (sin envío ni impuestos), configurada por la administración y visible en tu panel de finanzas. Los fondos de cada pedido se liberan a tu saldo disponible cuando el pedido se entrega; luego puedes solicitar un retiro (o programarlo) a tu cuenta verificada.',
    showRate: true,
    showPayoutMinimum: true,
  },
  'social.links': [],
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
    return (await this.get('marketplace.currency', client)) || 'USD';
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
