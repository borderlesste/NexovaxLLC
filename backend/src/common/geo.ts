import { DbService, Queryable } from '../db/db.service';
import { createHash } from 'node:crypto';
import { badRequest } from './errors';

/** Countries where carriers require a state/province code. */
const REGION_REQUIRED = new Set(['US', 'CA', 'MX', 'AU', 'BR', 'IN']);
/** Postal-code formats for the most common destinations (others: optional, free text). */
const POSTAL: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/,
  MX: /^\d{5}$/,
  ES: /^\d{5}$/,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
  IT: /^\d{5}$/,
  GB: /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/,
  PR: /^\d{5}(-\d{4})?$/,
  CO: /^\d{6}$/,
  BR: /^\d{5}-?\d{3}$/,
  AU: /^\d{4}$/,
  // Validated when provided (optional in these countries).
  DO: /^\d{5}$/,
  CL: /^\d{7}$/,
  PE: /^\d{5}$/,
  AR: /^([A-Za-z]\d{4}[A-Za-z]{3}|\d{4})$/,
  PT: /^\d{4}-\d{3}$/,
  NL: /^\d{4}\s?[A-Za-z]{2}$/,
  BE: /^\d{4}$/,
  CH: /^\d{4}$/,
  AT: /^\d{4}$/,
  SE: /^\d{3}\s?\d{2}$/,
  JP: /^\d{3}-?\d{4}$/,
  IN: /^\d{6}$/,
  CR: /^\d{5}$/,
  GT: /^\d{5}$/,
  EC: /^\d{6}$/,
  VE: /^\d{4}$/,
  UY: /^\d{5}$/,
  PY: /^\d{4,6}$/,
  PA: /^\d{4}$/,
  HN: /^\d{5}$/,
  SV: /^\d{4}$/,
  NI: /^\d{5}$/,
  BO: /^\d{4}$/,
};
const POSTAL_REQUIRED = new Set(['US', 'CA', 'MX', 'ES', 'DE', 'FR', 'IT', 'GB', 'PR', 'CO', 'BR', 'AU']);

export interface PostalAddressInput {
  countryCode: string;
  city: string;
  region?: string | null;
  postalCode?: string | null;
  phone?: string | null;
}

/** Reference data of one country (GeoNames): calling code, postal format, states. */
export interface CountryGeo {
  code: string;
  phonePrefix: string | null;
  postalFormat: string | null;
  postalRegex: RegExp | null;
  regions: { code: string; name: string; asciiName: string; shortCode: string | null }[];
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Words that vary between sources ("Provincia de Santiago" vs "Santiago Province", "Distrito Nacional" vs "Nacional").
const NOISE = /\b(provincia|province|departamento|department|estado|state|region|regione|distrito|district|de|del|la|el|of|the)\b/g;
const core = (s: string) => fold(s).replace(NOISE, ' ').replace(/\s+/g, ' ').trim();

const geoCache = new Map<string, { at: number; geo: CountryGeo }>();
export async function countryGeo(db: DbService, country: string, c?: Queryable): Promise<CountryGeo> {
  const hit = geoCache.get(country);
  if (hit && Date.now() - hit.at < 3600_000) return hit.geo;
  const row = await db.one<{ phone_prefix: string | null; postal_format: string | null; postal_regex: string | null }>(
    `select phone_prefix, postal_format, postal_regex from public.countries where alpha2 = $1`, [country], c);
  const regions = await db.many<{ code: string; name: string; ascii_name: string; short_code: string | null }>(
    `select code, name, ascii_name, short_code from public.geo_regions where country_code = $1 order by ascii_name`, [country], c);
  let postalRegex: RegExp | null = null;
  try {
    postalRegex = row?.postal_regex ? new RegExp(row.postal_regex.trim(), 'i') : null;
  } catch {}
  const geo: CountryGeo = {
    code: country,
    phonePrefix: row?.phone_prefix ?? null,
    postalFormat: row?.postal_format ?? null,
    postalRegex,
    regions: regions.map((r) => ({ code: r.code, name: r.name, asciiName: r.ascii_name, shortCode: r.short_code })),
  };
  geoCache.set(country, { at: Date.now(), geo });
  return geo;
}

/** Finds a state by carrier code, GeoNames code or name (accent/case-insensitive, tolerant to "Province of…"). */
export function matchRegion(geo: CountryGeo, raw: string) {
  const v = fold(raw);
  if (!v) return undefined;
  const exact = geo.regions.find((r) => fold(r.shortCode ?? '') === v || fold(r.code) === v || fold(r.name) === v || fold(r.asciiName) === v);
  if (exact) return exact;
  const k = core(raw);
  if (!k) return undefined;
  const loose = geo.regions.filter((r) => { const n = core(r.asciiName); return n === k || (n.length > 3 && (n.includes(k) || k.includes(n))); });
  return loose.length === 1 ? loose[0] : loose.find((r) => core(r.asciiName) === k);
}

/** Value stored for a region: the carrier code where carriers expect one (US FL, CA ON), else the name. */
export const regionValue = (r: { name: string; shortCode: string | null }) => r.shortCode ?? r.name;

/**
 * International phone in E.164-like form: a number without "+" gets the
 * country's calling code. "809-555-0101" in DO → "+1 809-555-0101".
 */
export function normalizePhone(geo: CountryGeo, raw?: string | null) {
  const v = raw?.trim();
  if (!v) return null;
  const digits = v.replace(/\D/g, '');
  if (v.startsWith('+')) return v.replace(/\s+/g, ' ');
  if (geo.phonePrefix && digits.startsWith('00' + geo.phonePrefix)) return `+${v.replace(/^\s*00/, '')}`;
  if (!geo.phonePrefix) return v;
  // NANP numbers typed with the leading 1 ("1 809 555 0101")
  if (geo.phonePrefix === '1' && digits.length === 11 && digits.startsWith('1')) return `+${v}`;
  if (geo.phonePrefix === '1' && digits.length !== 10) throw badRequest('PHONE_INVALID', 'El teléfono debe tener 10 dígitos (código de área + número).');
  if (digits.length + geo.phonePrefix.length > 15) throw badRequest('PHONE_INVALID', 'El teléfono tiene demasiados dígitos para el país seleccionado.');
  return `+${geo.phonePrefix} ${v}`;
}

/** Excludes user-assigned / fixture codes present in shared reference data. */
export const REAL_COUNTRY = `alpha2 !~ '^Q' and alpha2 <> 'ZZ' and name not ilike '%test%' and name not ilike '%fixture%'`;

export const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);

/** Validates an ISO 3166-1 alpha-2 country code against the reference catalog. */
export async function normalizeCountry(db: DbService, code: string | null | undefined, c?: Queryable) {
  const country = (code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw badRequest('COUNTRY_REQUIRED', 'Selecciona un país válido.');
  const known = await db.one(`select 1 from public.countries where alpha2 = $1 and is_active and ${REAL_COUNTRY}`, [country], c);
  if (!known) throw badRequest('COUNTRY_INVALID', 'Selecciona un país válido.');
  return country;
}

/**
 * Validates an international postal address so its parts agree with the country:
 * state from the country's list, city canonicalized and inside that state,
 * postal code in the country's format, phone with the country's calling code.
 */
export async function normalizeAddress(db: DbService, a: PostalAddressInput, c?: Queryable) {
  const country = await normalizeCountry(db, a.countryCode, c);
  const geo = await countryGeo(db, country, c);
  let city = clean(a.city);
  if (!city || city.length < 2) throw badRequest('CITY_REQUIRED', 'Indica la ciudad.');
  // ---- state / province
  let region = clean(a.region);
  if (REGION_REQUIRED.has(country) && !region) throw badRequest('REGION_REQUIRED', 'Indica el estado o provincia.');
  let regionCode: string | null = null;
  if (region && geo.regions.length) {
    const r = matchRegion(geo, region);
    if (!r) throw badRequest('REGION_INVALID', 'Selecciona un estado o provincia de la lista del país.');
    region = regionValue(r);
    regionCode = r.code;
  } else if (country === 'US' && region && !/^[A-Za-z]{2}$/.test(region)) {
    throw badRequest('REGION_INVALID', 'Usa el código de 2 letras del estado (ej. FL, CA, NY).');
  }
  // ---- city: canonical spelling; must belong to the chosen state when we know it
  const known = await db.many<{ name: string; admin1_code: string | null }>(
    `select name, admin1_code from public.city_references where country_code = $1 and lower(ascii_name) = $2 order by population desc limit 20`,
    [country, city.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()],
    c,
  );
  const sameName = known.length ? known : await db.many<{ name: string; admin1_code: string | null }>(
    `select name, admin1_code from public.city_references where country_code = $1 and lower(name) = lower($2) order by population desc limit 20`, [country, city], c);
  if (sameName.length) {
    const inRegion = regionCode ? sameName.filter((x) => x.admin1_code === regionCode) : sameName;
    if (regionCode && sameName.every((x) => x.admin1_code) && !inRegion.length)
      throw badRequest('CITY_REGION_MISMATCH', 'La ciudad no pertenece al estado o provincia seleccionado.');
    city = (inRegion[0] ?? sameName[0]).name;
  }
  // ---- postal code
  let postal = clean(a.postalCode)?.toUpperCase() ?? null;
  if (POSTAL_REQUIRED.has(country) && !postal) throw badRequest('POSTAL_CODE_REQUIRED', 'Indica el código postal.');
  if (postal && country === 'BR' && /^\d{8}$/.test(postal)) postal = `${postal.slice(0, 5)}-${postal.slice(5)}`;
  if (postal && country === 'CA' && /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(postal)) postal = `${postal.slice(0, 3)} ${postal.slice(3)}`;
  const fmt = POSTAL[country] ?? geo.postalRegex;
  if (postal && fmt && !fmt.test(postal)) throw badRequest('POSTAL_CODE_INVALID', 'El código postal no es válido para el país seleccionado.');
  // ---- phone
  const phone = normalizePhone(geo, a.phone);
  return { countryCode: country, city, region, postalCode: postal, phone };
}

/**
 * Returns the city_references id for a (country, city) pair, registering the
 * city when it is not in the catalog yet (addresses must reference a city).
 * Ids for user-entered cities are deterministic and live above GeoNames' range.
 */
export async function resolveCityId(db: DbService, countryCode: string, city: string, region: string | null, c?: Queryable): Promise<number> {
  const existing = await db.one<{ id: string }>(
    `select id::text from public.city_references where country_code = $1 and name = $2
      order by (admin1_code is not distinct from $3) desc, population desc limit 1`,
    [countryCode, city, region],
    c,
  );
  if (existing) return Number(existing.id);
  const h = createHash('sha256').update(`${countryCode}|${city.toLowerCase()}`).digest();
  const id = 1_000_000_000_000 + (h.readUInt32BE(0) * 4096 + (h.readUInt16BE(4) & 0xfff));
  await db.exec(
    `insert into public.city_references (id, country_code, name, admin1_code, population, source_url)
     values ($1::bigint,$2,$3,$4,0,'nexovax:address-entry/' || $1::bigint::text) on conflict do nothing`,
    [id, countryCode, city, region],
    c,
  );
  return id;
}
