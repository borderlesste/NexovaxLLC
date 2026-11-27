import { Locale, setMailRuntime } from '../mail/mail.templates';
import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';
import { badRequest } from '../common/errors';
import { defaultHomeLayout, HomeLayout, normalizeHomeLayout } from '../catalog/home-layout';
import { DEFAULT_RECEIPT_TAX_ID, normalizeReceiptTaxId, ReceiptTaxIdSettings } from '../orders/receipt-tax-id';

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

export interface HelpFaq { q: string; a: string; qEn?: string; aEn?: string; qFr?: string; aFr?: string; qHt?: string; aHt?: string }
export interface HelpSection { title: string; body: string; titleEn?: string; bodyEn?: string; titleFr?: string; bodyFr?: string; titleHt?: string; bodyHt?: string }
export interface HelpCommissions { body: string; bodyEn?: string; bodyFr?: string; bodyHt?: string; showRate: boolean; showPayoutMinimum: boolean }
export type SocialNetwork = 'facebook' | 'instagram' | 'youtube' | 'x' | 'tiktok' | 'linkedin' | 'whatsapp' | 'pinterest';
export interface SocialLink { network: SocialNetwork; url: string }

/** Site-wide SEO defaults (Admin → Configuración → SEO). Empty fields fall back as documented per field. */
export interface SeoSettings {
  /** og:site_name and the title suffix; empty → marketplace.name. */
  siteName: string;
  /** Home page title next to the site name (es + optional translations). */
  title: string; titleEn?: string; titleFr?: string; titleHt?: string;
  /** Title of every other page; %s is the page title. Empty → "%s · {siteName}". */
  titleTemplate: string;
  description: string; descriptionEn?: string; descriptionFr?: string; descriptionHt?: string;
  keywords: string;
  /** Public origin for canonical links, Open Graph URLs and the sitemap; empty → the web's env (NEXT_PUBLIC_SITE_URL). */
  canonicalUrl: string;
  /** Default share image (1200×630) for pages without their own. */
  ogImage: string;
  ogImageAlt: string;
  /** @handle of the marketplace on X/Twitter (twitter:site). */
  twitterHandle: string;
  twitterCard: 'summary_large_image' | 'summary';
  googleVerification: string;
  bingVerification: string;
  /** Asks search engines not to index the site (staging copies, pre-launch). */
  noindex: boolean;
}

/** Delivery-country context (NX-GEO-001): how the browsing destination is suggested. */
export interface GeoDeliverySettings {
  /** Use the country the hosting edge estimates from the visitor's IP (never the IP itself). */
  ipDetection: boolean;
  /** Show the "Enviar a" selector in the store header. */
  showSelector: boolean;
  /** Destinations offered in the selector (ISO alpha-2); empty = every country in the catalog. */
  countries: string[];
  /** Days a store's past live carrier quote to a country counts as proof the route works ("Disponible"). */
  laneHistoryDays?: number;
}

/** Google integrations (Admin → Configuración → Google): GA4 and the Merchant Center product feed. */
export interface GoogleSettings {
  /** Measures visits and e-commerce events with Google Analytics 4, only after the visitor accepts analytics cookies. */
  ga4Enabled: boolean;
  /** GA4 web stream measurement ID (G-XXXXXXXXXX). */
  ga4MeasurementId: string;
  /** Publishes the product feed at /feeds/google-merchant.xml for Merchant Center (free listings and Shopping ads). */
  merchantFeedEnabled: boolean;
  /** Countries whose flat shipping price goes in each item (g:shipping); empty = the marketplace's default country. */
  merchantShippingCountries: string[];
  /** Fallback condition for items whose seller has not specified one. */
  merchantCondition: 'new' | 'used' | 'refurbished';
  /** List out-of-stock products as out_of_stock instead of leaving them out. */
  merchantIncludeOutOfStock: boolean;
  /** Use the store name as brand when a product has no brand. */
  merchantStoreAsBrand: boolean;
}

/**
 * Company behind the marketplace (Admin → Configuración → Ayuda y redes → Empresa y pie de página).
 * Shown in the footer, /sobre-nosotros and the legal texts. Empty fields are not shown.
 * Texts with En/Fr/Ht variants fall back to the built-in translation, then to Spanish.
 */
export interface CompanyInfo {
  /** Legal name of the company that operates the marketplace (e.g. "NEXOVAX LLC"). */
  legalName: string;
  /** Where it is organized and whose laws govern the terms (e.g. "Pensilvania, Estados Unidos"). */
  jurisdiction: string;
  /** Registered business address. */
  address: string;
  /** Business registration number (state entity number), when the company wants to show it. */
  registrationNumber: string;
  /** Tax ID (e.g. EIN), when the company wants to show it. */
  taxId?: string;
  /** Legal representative / managing member. */
  legalRepresentative?: string;
  phone: string;
  /** Support hours, e.g. "Lunes a viernes, 9:00–18:00 (hora del Este, EE. UU.)". */
  supportHours: string; supportHoursEn?: string; supportHoursFr?: string; supportHoursHt?: string;
  /** Short description under the logo in the footer; empty = the built-in text. */
  footerText: string; footerTextEn?: string; footerTextFr?: string; footerTextHt?: string;
}

export interface CatalogListingSettings {
  /** Products per page in /catalogo, category pages and search results (CATALOG_PAGE_SIZE_MIN..MAX). */
  pageSize: number;
}
/** Bounds of catalog.listing.pageSize; the max is also the API cap for ?pageSize on /products. */
export const CATALOG_PAGE_SIZE_MIN = 4;
export const CATALOG_PAGE_SIZE_MAX = 60;

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
  /** Only administrators can use the marketplace while it is on. */
  'features.maintenance_mode': boolean;
  /** First visit without a saved language: use the browser's language when it is one of the four supported. */
  'features.browser_language': boolean;
  'help.faq': HelpFaq[];
  'help.sellers': { sections: HelpSection[] };
  'help.commissions': HelpCommissions;
  'social.links': SocialLink[];
  'seo.defaults': SeoSettings;
  'geo.delivery': GeoDeliverySettings;
  'google.integrations': GoogleSettings;
  'company.info': CompanyInfo;
  /** Home page sections: order, on/off, titles and item counts (Admin → Configuración → Portada). */
  'home.layout': HomeLayout;
  /** Public catalog listings (/catalogo, categories, search): products per page. */
  'catalog.listing': CatalogListingSettings;
  /** Seller entity types whose tax ID is printed on buyers' receipts (businesses only). */
  'receipts.seller_tax_id': ReceiptTaxIdSettings;
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
  'features.mandatory_moderation': false,
  'features.email_notifications': true,
  'features.maintenance_mode': false,
  'features.browser_language': true,
  'help.faq': [
    { q: '¿Cómo compro en NEXOVAX?', a: 'Agrega productos al carrito desde cualquier tienda, ve a "Finalizar compra", elige tu dirección, el método de envío de cada tienda y paga con tarjeta o transferencia bancaria.' },
    { q: '¿Qué métodos de pago aceptan?', a: 'Tarjetas de crédito y débito, y transferencias bancarias. Con transferencia reservamos tu inventario por 72 horas mientras validamos el pago.' },
    { q: '¿Cuánto cuesta el envío?', a: 'Depende del origen de la tienda y de tu dirección. Mostramos tarifas en vivo de transportadoras (USPS, UPS, DHL Express y otras) o las tarifas del marketplace, y el retiro en tienda cuando está disponible.' },
    { q: '¿Hacen envíos internacionales?', a: 'Sí. Las tiendas despachan desde distintos países; en el checkout verás las transportadoras disponibles para tu país. Los envíos internacionales pueden estar sujetos a impuestos y aranceles de importación del país de destino.' },
    { q: '¿Cómo se calculan los impuestos?', a: 'Aplicamos el impuesto al consumo del país de destino (IVA, VAT, GST, ITBIS…) sobre el precio de los productos. Verás el detalle antes de confirmar la compra.' },
    { q: '¿Cómo sigo mi pedido?', a: 'En "Mi cuenta → Mis pedidos" verás el estado, la transportadora, el número de guía y el historial de eventos de cada envío. Los envíos con etiqueta se actualizan automáticamente.' },
    { q: '¿Puedo devolver un producto?', a: 'Sí. Todas las tiendas usan la política de devoluciones estándar de NexovaX (hasta 30 días desde la entrega). Pide la devolución desde tu pedido o reporta un problema.' },
    { q: '¿Cómo vendo en NEXOVAX?', a: 'Crea una cuenta y completa el registro de tu tienda con tu país y tu identificación fiscal. Tu tienda queda activa al instante y tus productos se muestran en cuanto los publicas.' },
  ],
  'help.sellers': {
    sections: [
      { title: 'Registra tu tienda', body: 'Crea una cuenta y completa el registro de tu tienda con tu país, tu identificación fiscal y la dirección desde donde despachas. Tu tienda queda activa al instante; solo verificamos tu cuenta de cobro antes de habilitar retiros.' },
      { title: 'Publica tus productos', body: 'Agrega fotos, descripción, atributos, variantes, precio, inventario y medidas del paquete. Al publicar, el producto aparece en el catálogo al instante.' },
      { title: 'Envía tus pedidos', body: 'Compra la etiqueta desde tu panel (se descuenta del envío que pagó el cliente) o despacha por tu cuenta y registra la guía: en ese caso recibes lo que el cliente pagó por el envío.' },
      { title: 'Devoluciones', body: 'Revisa las solicitudes, recibe e inspecciona los productos. Todas las tiendas usan la política de devoluciones estándar de NexovaX.' },
    ],
  },
  'help.commissions': {
    body: 'La plataforma cobra una comisión por venta sobre el valor de los productos (sin envío ni impuestos), configurada por la administración y visible en tu panel de finanzas. Los fondos de cada pedido se liberan a tu saldo disponible cuando el pedido se entrega; luego puedes solicitar un retiro (o programarlo) a tu cuenta verificada.',
    showRate: true,
    showPayoutMinimum: true,
  },
  'social.links': [],
  'seo.defaults': {
    siteName: '', title: '', titleTemplate: '', description: '', keywords: '', canonicalUrl: '', ogImage: '', ogImageAlt: '',
    twitterHandle: '', twitterCard: 'summary_large_image', googleVerification: '', bingVerification: '', noindex: false,
  },
  'geo.delivery': { ipDetection: true, showSelector: true, countries: [], laneHistoryDays: 90 },
  'google.integrations': {
    ga4Enabled: false, ga4MeasurementId: '', merchantFeedEnabled: false, merchantShippingCountries: [],
    merchantCondition: 'new', merchantIncludeOutOfStock: false, merchantStoreAsBrand: false,
  },
  'company.info': { legalName: '', jurisdiction: '', address: '', registrationNumber: '', taxId: '', legalRepresentative: '', phone: '', supportHours: '', footerText: '' },
  'home.layout': defaultHomeLayout(),
  'catalog.listing': { pageSize: 12 },
  'receipts.seller_tax_id': DEFAULT_RECEIPT_TAX_ID,
};

/** Reads/writes versioned, typed platform settings (public.system_setting_values). */
@Injectable()
export class SettingsService {
  private cache?: { at: number; value: PlatformSettings };

  constructor(private readonly db: DbService) {}

  /** Loads the settings at start-up so e-mails use them from the first one. */
  async onModuleInit() {
    await this.all().catch(() => undefined);
  }

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
    out['google.integrations'] = { ...DEFAULTS['google.integrations'], ...(out['google.integrations'] ?? {}) };
    out['company.info'] = { ...DEFAULTS['company.info'], ...(out['company.info'] ?? {}) };
    out['home.layout'] = normalizeHomeLayout(out['home.layout']);
    out['catalog.listing'] = { ...DEFAULTS['catalog.listing'], ...(out['catalog.listing'] ?? {}) };
    out['receipts.seller_tax_id'] = normalizeReceiptTaxId(out['receipts.seller_tax_id']);
    if (!client) {
      this.cache = { at: Date.now(), value: out };
      setMailRuntime({
        baseUrl: out['marketplace.base_url'] || '', name: out['marketplace.name'] || 'NEXOVAX', supportEmail: out['marketplace.support_email'] || '',
        locale: (['es', 'en', 'fr', 'ht'].includes(out['marketplace.locale']) ? out['marketplace.locale'] : 'es') as Locale,
        emailsOn: out['features.email_notifications'] !== false,
      });
    }
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
        const value = key === 'home.layout' ? normalizeHomeLayout(patch[key]) : patch[key];
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
