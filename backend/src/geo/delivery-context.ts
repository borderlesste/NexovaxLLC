import { DbService } from '../db/db.service';
import { REAL_COUNTRY } from '../common/geo';
import { fromTrustedProxy } from '../common/client-ip';
import { SettingsService } from '../settings/settings.service';

/** Cookie with the visitor's explicit choice (functional, independent of nx_locale). */
export const DELIVERY_COOKIE = 'nx_delivery_country';
/**
 * Country the hosting edge estimated from the visitor's IP (x-vercel-ip-country, cf-ipcountry),
 * forwarded by our web middleware. Trusted only together with the proxy's shared secret, so a
 * client can't set it. The IP itself is never stored.
 */
export const IP_COUNTRY_HEADER = 'x-nx-ip-country';

export type DeliverySource = 'manual' | 'account' | 'ip' | 'default';

export interface DeliveryContext {
  /** Country estimated by the infrastructure, or null when unknown / detection is off. */
  detectedCountry: string | null;
  /** Destination used for browsing. */
  deliveryCountry: string;
  source: DeliverySource;
  /** True when the destination is an estimate or a suggestion (IP or marketplace default). */
  isApproximate: boolean;
  /** Destinations offered in the selector; empty = every country. */
  countries: string[];
  showSelector: boolean;
}

let known: { at: number; codes: Set<string> } | undefined;
async function knownCountries(db: DbService) {
  if (known && Date.now() - known.at < 3_600_000) return known.codes;
  const rows = await db.many<{ alpha2: string }>(`select alpha2 from public.countries where is_active and ${REAL_COUNTRY}`);
  known = { at: Date.now(), codes: new Set(rows.map((r) => r.alpha2)) };
  return known.codes;
}

function header(req: any, name: string) {
  const v = req.headers?.[name];
  return ((Array.isArray(v) ? v[0] : v) ?? '').trim() as string;
}

export function readCookie(req: any, name: string) {
  for (const part of header(req, 'cookie').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0 || part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      return '';
    }
  }
  return '';
}

/**
 * Resolves the browsing destination (NX-GEO-001 §3):
 * explicit choice (cookie) > account preference > IP country > marketplace default.
 * Every candidate is validated against the country catalog and the destinations the admin offers.
 * Informative only: checkout always validates the confirmed address.
 */
export async function resolveDeliveryContext(db: DbService, settings: SettingsService, req: any, userId?: string | null): Promise<DeliveryContext> {
  const s = await settings.all();
  const geo = s['geo.delivery'] ?? { ipDetection: true, showSelector: true, countries: [] };
  const codes = await knownCountries(db);
  const offered = (geo.countries ?? []).filter((c) => codes.has(c));
  const ok = (c: string | null | undefined): c is string => {
    const cc = (c ?? '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(cc) && codes.has(cc) && (!offered.length || offered.includes(cc));
  };
  const up = (c: string) => c.trim().toUpperCase();

  // XX / T1 (Tor) and other non-country values are discarded by the catalog check.
  const ipRaw = geo.ipDetection && fromTrustedProxy(req) ? up(header(req, IP_COUNTRY_HEADER)) : '';
  const detected = /^[A-Z]{2}$/.test(ipRaw) && codes.has(ipRaw) ? ipRaw : null;
  const base = { detectedCountry: detected, countries: offered, showSelector: geo.showSelector !== false };

  const manual = readCookie(req, DELIVERY_COOKIE);
  if (ok(manual)) return { ...base, deliveryCountry: up(manual), source: 'manual', isApproximate: false };
  if (userId) {
    const row = await db.one<{ delivery_country: string | null }>(`select delivery_country from public.users where id = $1`, [userId]);
    if (ok(row?.delivery_country)) return { ...base, deliveryCountry: up(row!.delivery_country!), source: 'account', isApproximate: false };
  }
  if (ok(detected)) return { ...base, deliveryCountry: detected, source: 'ip', isApproximate: true };
  const def = s['marketplace.default_country'];
  const fallback = ok(def) ? up(def) : offered[0] ?? (codes.has('US') ? 'US' : [...codes][0]);
  return { ...base, deliveryCountry: fallback, source: 'default', isApproximate: true };
}
