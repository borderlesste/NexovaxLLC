'use client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
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

/** Country + city + region + postal code, with country-specific labels. */
export function GeoFields({ value, onChange }: { value: GeoValue; onChange: (patch: Partial<GeoValue>) => void }) {
  const l = geoLabels(value.countryCode);
  return (
    <>
      <CountrySelect value={value.countryCode} onChange={(v) => onChange({ countryCode: v })} required />
      <Field label={t('Ciudad')} required><Input value={value.city} onChange={(e) => onChange({ city: e.target.value })} placeholder={t('Ej. Miami, Madrid, Santo Domingo')} /></Field>
      <Field label={l.region} hint={l.regionHint ? `(${l.regionHint})` : undefined} required={['US', 'CA', 'MX'].includes(value.countryCode)}>
        <Input value={value.region} onChange={(e) => onChange({ region: e.target.value })} />
      </Field>
      <Field label={l.postal}><Input value={value.postalCode} onChange={(e) => onChange({ postalCode: e.target.value })} placeholder={l.postalPlaceholder} /></Field>
    </>
  );
}

/** One-line city/region/postal + country. */
export function cityLine(a: { city?: string | null; region?: string | null; postalCode?: string | null; countryCode?: string | null }) {
  return [[a.city, a.region].filter(Boolean).join(', ') + (a.postalCode ? ` ${a.postalCode}` : ''), countryName(a.countryCode)].filter((x) => x && x.trim()).join(' · ');
}
