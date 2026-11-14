import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/auth';
import { badRequest } from '../common/errors';
import { countryGeo, matchRegion, normalizeCountry, REAL_COUNTRY, regionValue } from '../common/geo';
import { DbService } from '../db/db.service';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Example postal code from a GeoNames format: "#####-###" → "12345-678", "@#@ #@#" → "A1B 2C3". */
const postalExample = (fmt: string | null) => {
  if (!fmt) return null;
  const first = fmt.split('|')[0];
  let d = 0, l = 0;
  return first.replace(/#/g, () => String((d++ % 9) + 1)).replace(/@/g, () => 'ABCDEFGH'[l++ % 8]);
};

/**
 * Geographic reference data for address forms (GeoNames, CC BY 4.0): countries
 * with calling code and postal format, states, city search and postal-code lookup.
 */
@ApiTags('geo')
@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('geo')
export class GeoController {
  constructor(private readonly db: DbService) {}

  @Get('countries/:code')
  async country(@Param('code') code: string) {
    const cc = await normalizeCountry(this.db, code);
    const geo = await countryGeo(this.db, cc);
    return {
      code: cc,
      phonePrefix: geo.phonePrefix,
      postalFormat: geo.postalFormat,
      postalExample: ({ US: '33131', PR: '00901' } as Record<string, string>)[cc] ?? postalExample(geo.postalFormat), // ZIP+4 is optional
      postalPattern: geo.postalRegex?.source ?? null,
      regions: geo.regions.map((r) => ({ code: r.code, name: r.name, value: regionValue(r), shortCode: r.shortCode })),
    };
  }

  /** Cities of a country (optionally of one state), most populated first, matching the typed prefix. */
  @Get('cities')
  async cities(@Query('country') country: string, @Query('q') q = '', @Query('region') region?: string) {
    const cc = await normalizeCountry(this.db, country);
    const term = fold(q).slice(0, 60);
    if (!term) return [];
    if (/[%_\\]/.test(term)) throw badRequest('QUERY_INVALID', 'Búsqueda inválida.');
    const geo = await countryGeo(this.db, cc);
    const r = region ? matchRegion(geo, region) : undefined;
    const rows = await this.db.many<{ name: string; admin1_code: string | null }>(
      `select name, admin1_code from (
         select distinct on (lower(ascii_name), admin1_code) name, admin1_code, population, ascii_name
           from public.city_references
          where country_code = $1 and lower(ascii_name) like $2 || '%' and ($3::text is null or admin1_code = $3)
            -- cities typed by users only when the catalog doesn't already have that name
            and not (source_url like 'nexovax:%' and exists (
              select 1 from public.city_references g where g.country_code = $1 and lower(g.ascii_name) = lower(city_references.ascii_name) and g.source_url not like 'nexovax:%'))
          order by lower(ascii_name), admin1_code, population desc) x
        order by population desc, name limit 12`,
      [cc, term, r?.code ?? null],
    );
    return rows.map((c) => {
      const reg = geo.regions.find((x) => x.code === c.admin1_code);
      return { name: c.name, regionName: reg?.name ?? null, region: reg ? regionValue(reg) : null };
    });
  }

  /** Places for a postal code (suggestion: city and state). */
  @Get('postal')
  async postal(@Query('country') country: string, @Query('code') code = '') {
    const cc = await normalizeCountry(this.db, country);
    const pc = code.trim().toUpperCase().slice(0, 12);
    if (!pc) return [];
    const geo = await countryGeo(this.db, cc);
    // CA files carry only the first three characters (FSA)
    const keys = cc === 'CA' ? [pc.slice(0, 3)] : cc === 'BR' && /^\d{8}$/.test(pc) ? [`${pc.slice(0, 5)}-${pc.slice(5)}`] : [pc, pc.split('-')[0]];
    type Row = { place_name: string; region_name: string | null; region_code: string | null };
    let rows = await this.db.many<Row>(
      `select place_name, region_name, region_code from public.geo_postal_codes where country_code = $1 and postal_code = any($2::text[]) limit 8`,
      [cc, keys],
    );
    let exact = true;
    if (!rows.length && pc.replace(/[^A-Z0-9]/g, '').length >= 4) {
      // Some files only carry area-level codes (BR "01000-000"): infer from the shared prefix when unambiguous.
      exact = false;
      rows = await this.db.many<Row>(
        `select place_name, region_name, region_code from public.geo_postal_codes where country_code = $1 and postal_code like $2 || '%' limit 200`,
        [cc, pc.slice(0, 3)],
      );
    }
    const resolve = (p: Row) => {
      const reg = (p.region_code && matchRegion(geo, p.region_code)) || (p.region_name && matchRegion(geo, p.region_name)) || undefined;
      return { city: p.place_name.replace(/\s*\(.*\)\s*$/, '').trim(), region: reg ? regionValue(reg) : p.region_name, regionName: reg?.name ?? p.region_name };
    };
    const out = rows.map(resolve);
    if (exact) return out.filter((x, i) => out.findIndex((y) => y.city === x.city && y.region === x.region) === i);
    const regions = [...new Set(out.map((x) => x.region))];
    if (regions.length !== 1 || !regions[0]) return [];
    const cities = [...new Set(out.map((x) => x.city))];
    return [{ city: cities.length === 1 ? cities[0] : null, region: regions[0], regionName: out[0].regionName }];
  }
}
