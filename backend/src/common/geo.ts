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
};
const POSTAL_REQUIRED = new Set(Object.keys(POSTAL));

export interface PostalAddressInput {
  countryCode: string;
  city: string;
  region?: string | null;
  postalCode?: string | null;
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

/** Validates an international postal address and returns normalized parts. */
export async function normalizeAddress(db: DbService, a: PostalAddressInput, c?: Queryable) {
  const country = await normalizeCountry(db, a.countryCode, c);
  const city = clean(a.city);
  if (!city || city.length < 2) throw badRequest('CITY_REQUIRED', 'Indica la ciudad.');
  let region = clean(a.region);
  if (REGION_REQUIRED.has(country) && !region) throw badRequest('REGION_REQUIRED', 'Indica el estado o provincia.');
  if (country === 'US' && region && !/^[A-Za-z]{2}$/.test(region))
    throw badRequest('REGION_INVALID', 'Usa el código de 2 letras del estado (ej. FL, CA, NY).');
  if (region && /^[A-Za-z]{2}$/.test(region) && ['US', 'CA'].includes(country)) region = region.toUpperCase();
  const postal = clean(a.postalCode);
  if (POSTAL_REQUIRED.has(country) && !postal) throw badRequest('POSTAL_CODE_REQUIRED', 'Indica el código postal.');
  if (postal && POSTAL[country] && !POSTAL[country].test(postal)) throw badRequest('POSTAL_CODE_INVALID', 'El código postal no es válido para el país seleccionado.');
  return { countryCode: country, city, region, postalCode: postal ? (['CA', 'GB'].includes(country) ? postal.toUpperCase() : postal) : null };
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
