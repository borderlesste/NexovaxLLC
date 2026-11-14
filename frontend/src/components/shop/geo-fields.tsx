'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { get } from '@/lib/api';
import { countryName, t } from '@/lib/i18n';
import { Field, Input, Select } from '@/components/ui/input';

/** Region / postal-code wording per country (what carriers expect). */
export function geoLabels(country?: string | null) {
  switch (country) {
    case 'US':
      return { region: t('Estado'), regionHint: t('Código de 2 letras (FL, CA, NY…)'), postal: t('Código ZIP'), postalPlaceholder: '33131' };
    case 'CA':
      return { region: t('Provincia'), regionHint: 'ON, QC, BC…', postal: t('Código postal'), postalPlaceholder: 'M5V 2T6' };
    case 'MX':
      return { region: t('Estado'), regionHint: 'CDMX, Jalisco…', postal: t('Código postal'), postalPlaceholder: '03940' };
    case 'GB':
      return { region: t('Condado'), regionHint: '', postal: t('Código postal'), postalPlaceholder: 'SW1A 1AA' };
    default:
      return { region: t('Provincia / región'), regionHint: '', postal: t('Código postal'), postalPlaceholder: '' };
  }
}

export function useCountries() {
  const q = useQuery({ queryKey: ['countries'], queryFn: () => get<{ code: string; name: string }[]>('/geo/countries'), staleTime: Infinity });
  return useMemo(
    () => (q.data ?? []).map((c) => ({ code: c.code, name: countryName(c.code) || c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [q.data],
  );
}

export function CountrySelect({ value, onChange, required, label, className }: { value: string; onChange: (v: string) => void; required?: boolean; label?: string; className?: string }) {
  const countries = useCountries();
  return (
    <Field label={label ?? t('País')} required={required} className={className}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('Selecciona un país')}</option>
        {countries.map((c) => (
          <option key={c.code} value={c.code}>{c.name}</option>
        ))}
      </Select>
    </Field>
  );
}

export interface GeoValue {
  countryCode: string;
  city: string;
  region: string;
  postalCode: string;
}

type CountryGeo = { code: string; phonePrefix: string | null; postalFormat: string | null; postalExample: string | null; postalPattern: string | null; regions: { code: string; name: string; value: string; shortCode: string | null }[] };
type CityHit = { name: string; region: string | null; regionName: string | null };
type PostalHit = { city: string | null; region: string | null; regionName: string | null };

/** Calling code, postal format and states of a country (GeoNames reference data). */
export function useCountryGeo(country?: string | null) {
  return useQuery<CountryGeo>({ queryKey: ['country-geo', country], queryFn: () => get(`/geo/countries/${country}`), enabled: !!country && country.length === 2, staleTime: Infinity });
}

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

/**
 * Country → state → city → postal code, kept consistent: the country decides the
 * state list, the city suggestions come from that country (and state), and the
 * postal code follows the country's format and suggests the matching city/state.
 */
export function GeoFields({ value, onChange }: { value: GeoValue; onChange: (patch: Partial<GeoValue>) => void }) {
  const l = geoLabels(value.countryCode);
  const geo = useCountryGeo(value.countryCode).data;
  const regions = geo?.code === value.countryCode ? geo.regions : [];
  const cityQ = useDebounced(value.city.trim());
  const cities = useQuery<CityHit[]>({
    queryKey: ['geo-cities', value.countryCode, value.region, cityQ],
    queryFn: () => get(`/geo/cities?country=${value.countryCode}&q=${encodeURIComponent(cityQ)}${value.region ? `&region=${encodeURIComponent(value.region)}` : ''}`),
    enabled: !!value.countryCode && cityQ.length >= 1,
    staleTime: 60_000,
  });
  const [postalHit, setPostalHit] = useState<PostalHit | null>(null);
  const [postalBad, setPostalBad] = useState(false);
  const listId = useMemo(() => `cities-${Math.random().toString(36).slice(2)}`, []);
  const regionRequired = ['US', 'CA', 'MX', 'AU', 'BR', 'IN'].includes(value.countryCode);
  const known = !value.region || regions.some((r) => r.value === value.region);

  const changeCountry = (countryCode: string) => {
    if (countryCode === value.countryCode) return;
    setPostalHit(null);
    setPostalBad(false);
    // state, city and postal code belong to the previous country
    onChange({ countryCode, region: '', city: '', postalCode: '' });
  };
  const changeCity = (city: string) => {
    const hit = (cities.data ?? []).find((c) => c.name.toLowerCase() === city.trim().toLowerCase());
    onChange(hit?.region && !value.region ? { city, region: hit.region } : { city });
  };
  const checkPostal = async (code: string) => {
    setPostalHit(null);
    const pc = code.trim();
    if (!pc || !value.countryCode) return setPostalBad(false);
    let bad = false;
    try {
      bad = !!geo?.postalPattern && !new RegExp(geo.postalPattern, 'i').test(pc);
    } catch {}
    setPostalBad(bad);
    if (bad) return;
    try {
      const hits = await get<PostalHit[]>(`/geo/postal?country=${value.countryCode}&code=${encodeURIComponent(pc)}`);
      const h = hits[0];
      if (h && ((h.city && h.city.toLowerCase() !== value.city.trim().toLowerCase()) || (h.region && h.region !== value.region))) setPostalHit(h);
    } catch {}
  };
  const applyPostal = () => {
    if (!postalHit) return;
    onChange({ ...(postalHit.city ? { city: postalHit.city } : {}), ...(postalHit.region ? { region: postalHit.region } : {}) });
    setPostalHit(null);
  };

  return (
    <>
      <CountrySelect value={value.countryCode} onChange={changeCountry} required />
      <Field label={l.region} hint={l.regionHint && !regions.length ? `(${l.regionHint})` : undefined} required={regionRequired}>
        {regions.length ? (
          <Select value={value.region} onChange={(e) => onChange({ region: e.target.value, city: '' })} data-geo="region">
            <option value="">{t('Selecciona')}</option>
            {!known && <option value={value.region}>{value.region}</option>}
            {regions.map((r) => <option key={r.code} value={r.value}>{r.shortCode && r.shortCode !== r.name ? `${r.name} (${r.shortCode})` : r.name}</option>)}
          </Select>
        ) : (
          <Input rule="placeName" value={value.region} onChange={(e) => onChange({ region: e.target.value })} disabled={!value.countryCode} data-geo="region" />
        )}
      </Field>
      <Field label={t('Ciudad')} required>
        <Input rule="placeName" list={listId} autoComplete="off" value={value.city} onChange={(e) => changeCity(e.target.value)} disabled={!value.countryCode}
          placeholder={value.countryCode ? t('Escribe y elige de la lista') : t('Primero elige el país')} data-geo="city" />
        <datalist id={listId}>
          {(cities.data ?? []).map((c) => <option key={`${c.name}|${c.region}`} value={c.name}>{c.regionName ?? ''}</option>)}
        </datalist>
      </Field>
      <Field label={l.postal}>
        <Input rule="postalCode" value={value.postalCode} disabled={!value.countryCode} data-geo="postal"
          onChange={(e) => { onChange({ postalCode: e.target.value }); if (postalBad) setPostalBad(false); }}
          onBlur={(e) => checkPostal(e.target.value)}
          placeholder={geo?.postalExample ? t('Ej. {v}', { v: geo.postalExample }) : l.postalPlaceholder} />
        {postalBad && <p className="mt-1 text-xs text-red-600" role="alert">{t('Formato del país: {f}', { f: geo?.postalFormat?.split('|')[0].replace(/#/g, '9').replace(/@/g, 'A') ?? '' })}</p>}
        {postalHit && (
          <button type="button" onClick={applyPostal} className="mt-1 text-left text-xs font-semibold text-brand-700 hover:underline" data-geo="postal-hint">
            {t('¿Es {p}? Usar', { p: [postalHit.city, postalHit.regionName].filter(Boolean).join(', ') })}
          </button>
        )}
      </Field>
    </>
  );
}

/**
 * Phone that follows the country: shows its calling code ("+1", "+55") when the
 * number is typed without one; the API stores it as "+<code> <number>".
 */
export function PhoneInput({ countryCode, value, onChange, required }: { countryCode?: string | null; value: string; onChange: (v: string) => void; required?: boolean }) {
  const geo = useCountryGeo(countryCode).data;
  const prefix = geo?.code === countryCode ? geo!.phonePrefix : null;
  const intl = value.trim().startsWith('+');
  const nanp = prefix === '1';
  return (
    <div>
      <div className="flex items-stretch">
        {prefix && !intl && (
          <span className="flex items-center rounded-l-lg border border-r-0 border-line bg-surface px-3 text-sm font-semibold text-muted" data-geo="phone-prefix">+{prefix}</span>
        )}
        <div className="flex-1">
          <Input rule="phone" value={value} onChange={(e) => onChange(e.target.value)} required={required} data-geo="phone"
            className={prefix && !intl ? 'rounded-l-none' : undefined}
            placeholder={nanp ? t('Ej. {v}', { v: countryCode === 'US' ? '305 555 1234' : countryCode === 'CA' ? '416 555 1234' : '809 555 1234' }) : t('Número local')} />
        </div>
      </div>
      {prefix && !intl && value.replace(/\D/g, '').length >= 6 && (
        <p className="mt-1 text-xs text-muted">{t('Se guardará como +{p} {n}', { p: prefix, n: value.trim() })}</p>
      )}
    </div>
  );
}

/** One-line city/region/postal + country. */
export function cityLine(a: { city?: string | null; region?: string | null; postalCode?: string | null; countryCode?: string | null }) {
  return [[a.city, a.region].filter(Boolean).join(', ') + (a.postalCode ? ` ${a.postalCode}` : ''), countryName(a.countryCode)].filter((x) => x && x.trim()).join(' · ');
}
