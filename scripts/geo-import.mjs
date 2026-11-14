#!/usr/bin/env node
/**
 * Imports GeoNames reference data (https://www.geonames.org, CC BY 4.0):
 *   countries  → phone_prefix, postal_format, postal_regex      (countryInfo.txt)
 *   geo_regions                                                (admin1CodesASCII.txt)
 *   city_references (cities with population ≥ 5,000)           (cities5000.zip)
 *   geo_postal_codes (selected countries)                      (export/zip/<CC>.zip)
 *
 * Download first (≈ 11 MB) into scripts/data/geonames/ (gitignored):
 *   countryInfo.txt, admin1CodesASCII.txt, cities5000.zip → cities/cities5000.txt,
 *   postal/<CC>.zip → postal/<CC>/<CC>.txt
 * Run from backend/:  node ../scripts/geo-import.mjs      (idempotent)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(ROOT, 'backend/package.json'));
const pg = require('pg');
const DIR = resolve(ROOT, 'scripts/data/geonames');
const secret = (env, file) => process.env[env]?.trim() || readFileSync(resolve(ROOT, '.secrets', file), 'utf8').trim();
const db = new pg.Client({
  connectionString: secret('DATABASE_URL', 'database_url').replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, ''),
  ssl: { ca: readFileSync(resolve(ROOT, 'backend/certs/supabase-root-2021.crt'), 'utf8'), rejectUnauthorized: true },
});
const ascii = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').trim();
const rows = (file) => readFileSync(file, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));

async function batchInsert(sql, cols, data, size = 1000) {
  let n = 0;
  for (let i = 0; i < data.length; i += size) {
    const chunk = data.slice(i, i + size);
    const params = [];
    const values = chunk.map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(',')})`).join(',');
    n += (await db.query(sql.replace('%VALUES%', values), params)).rowCount;
  }
  return n;
}

await db.connect();
const known = new Set((await db.query('select alpha2 from public.countries')).rows.map((r) => r.alpha2));

// ---- countries
let n = 0;
for (const r of rows(resolve(DIR, 'countryInfo.txt'))) {
  const [iso, , , , , , , , , , , , phone, postalFormat, postalRegex] = r;
  if (!known.has(iso)) continue;
  const prefix = (phone ?? '').match(/\d{1,4}/)?.[0] ?? null;
  n += (await db.query(`update public.countries set phone_prefix = $2, postal_format = nullif($3, ''), postal_regex = nullif($4, '') where alpha2 = $1`, [iso, prefix, postalFormat ?? '', postalRegex ?? ''])).rowCount;
}
console.log(`countries: ${n} actualizados (prefijo y formato postal)`);

// ---- regions (carrier short codes: US uses the admin1 code; CA from the postal file)
const caShort = new Map();
const caFile = resolve(DIR, 'postal/CA/CA.txt');
if (existsSync(caFile)) for (const r of rows(caFile)) if (r[3] && r[4]) caShort.set(ascii(r[3]).toLowerCase(), r[4]);
// GeoNames uses English suffixes ("Azua Province"); Spanish/Portuguese-speaking countries get the local form.
const LOCAL = new Set(['AR', 'BO', 'BR', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'ES', 'GT', 'HN', 'MX', 'NI', 'PA', 'PE', 'PR', 'PT', 'PY', 'SV', 'UY', 'VE', 'GQ']);
const REGION_NAMES = {
  'DO.34': 'Distrito Nacional', 'MX.09': 'Ciudad de México', 'CO.34': 'Bogotá D.C.', 'AR.07': 'Ciudad Autónoma de Buenos Aires',
  // Spain: GeoNames ships English names
  'ES.51': 'Andalucía', 'ES.52': 'Aragón', 'ES.34': 'Asturias', 'ES.07': 'Islas Baleares', 'ES.59': 'País Vasco', 'ES.53': 'Canarias', 'ES.39': 'Cantabria',
  'ES.55': 'Castilla y León', 'ES.54': 'Castilla-La Mancha', 'ES.56': 'Cataluña', 'ES.CE': 'Ceuta', 'ES.57': 'Extremadura', 'ES.58': 'Galicia', 'ES.27': 'La Rioja',
  'ES.29': 'Comunidad de Madrid', 'ES.ML': 'Melilla', 'ES.31': 'Región de Murcia', 'ES.32': 'Navarra', 'ES.60': 'Comunidad Valenciana',
};
const localName = (cc, key, name) => REGION_NAMES[key] ?? (LOCAL.has(cc) ? name.replace(/\s+(Province|Department|Region|State|Governorate)$/i, '').replace(/^(Province|Department|State) of\s+/i, '') : name);
const regions = [];
for (const [key, rawName, rawAscii, geonameId] of rows(resolve(DIR, 'admin1CodesASCII.txt'))) {
  const [cc, code] = key.split('.');
  if (!known.has(cc) || !code) continue;
  const name = localName(cc, key, rawName);
  const asciiName = ascii(localName(cc, key, rawAscii || rawName));
  const short = cc === 'US' ? code : cc === 'CA' ? caShort.get(asciiName.toLowerCase()) ?? null : null;
  regions.push([cc, code, name, asciiName || ascii(name), short, geonameId ? Number(geonameId) : null]);
}
n = await batchInsert(
  `insert into public.geo_regions (country_code, code, name, ascii_name, short_code, geoname_id) values %VALUES%
   on conflict (country_code, code) do update set name = excluded.name, ascii_name = excluded.ascii_name, short_code = excluded.short_code, geoname_id = excluded.geoname_id`,
  6, regions,
);
console.log(`geo_regions: ${n} estados/provincias`);

// ---- cities (skip ids already present, e.g. the original countries.dev rows)
const existing = new Set((await db.query('select id::text from public.city_references')).rows.map((r) => r.id));
const cities = [];
for (const r of rows(resolve(DIR, 'cities/cities5000.txt'))) {
  const [id, name, asciiName, , , , , , cc, , admin1, , , , population] = r;
  if (!known.has(cc) || existing.has(id) || !name?.trim() || /[\u0000-\u001f]/.test(name)) continue;
  cities.push([Number(id), cc, name.trim(), admin1 || null, Number(population) || 0, `https://www.geonames.org/${id}`, (asciiName || ascii(name)).trim()]);
}
n = await batchInsert(
  `insert into public.city_references (id, country_code, name, admin1_code, population, source_url, ascii_name) values %VALUES% on conflict do nothing`,
  7, cities,
);
const fixed = (await db.query(`select id::text, name from public.city_references where ascii_name is null`)).rows;
for (const c of fixed) await db.query(`update public.city_references set ascii_name = $2 where id = $1::bigint and name = $3`, [c.id, ascii(c.name), c.name]);
console.log(`city_references: ${n} ciudades nuevas, ${fixed.length} existentes con nombre de búsqueda`);

// ---- postal codes
const postalDir = resolve(DIR, 'postal');
for (const cc of existsSync(postalDir) ? readdirSync(postalDir).filter((d) => /^[A-Z]{2}$/.test(d)) : []) {
  if (!known.has(cc)) continue;
  const file = resolve(postalDir, cc, `${cc}.txt`);
  if (!existsSync(file)) continue;
  const seen = new Set();
  const data = [];
  for (const r of rows(file)) {
    const [, code, place, admin1Name, admin1Code] = r;
    if (!code || !place) continue;
    const k = `${code}|${place}`;
    if (seen.has(k)) continue;
    seen.add(k);
    data.push([cc, code.trim().toUpperCase(), place.trim(), admin1Name?.trim() || null, admin1Code?.trim() || null]);
  }
  await db.query('delete from public.geo_postal_codes where country_code = $1', [cc]);
  n = await batchInsert(`insert into public.geo_postal_codes (country_code, postal_code, place_name, region_name, region_code) values %VALUES%`, 5, data, 2000);
  console.log(`geo_postal_codes ${cc}: ${n}`);
}
await db.end();
console.log('Datos geográficos: GeoNames (https://www.geonames.org), CC BY 4.0.');
