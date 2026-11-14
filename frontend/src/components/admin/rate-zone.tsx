'use client';
import { X } from 'lucide-react';
import { countryName, t } from '@/lib/i18n';
import { Field, Select } from '@/components/ui/input';
import { useCountries, useCountryGeo } from '@/components/shop/geo-fields';

export type Zone = 'ANY' | 'DOMESTIC' | 'INTERNATIONAL' | 'COUNTRIES';
export const ZONE_LABEL: Record<Zone, string> = {
  ANY: 'Todos los destinos',
  DOMESTIC: 'Nacional (mismo país de la tienda)',
  INTERNATIONAL: 'Internacional (otro país)',
  COUNTRIES: 'Países específicos',
};

/** Zone of a marketplace flat rate: destinations where the customer can choose it. */
export function RateZone({ rate, onChange }: { rate: any; onChange: (patch: Record<string, any>) => void }) {
  const countries = useCountries();
  const zone: Zone = rate.zone ?? 'ANY';
  const list: string[] = rate.countries ?? [];
  const single = zone === 'COUNTRIES' && list.length === 1 ? list[0] : null;
  const geo = useCountryGeo(single);
  const regions: string[] = rate.regions ?? [];
  return (
    <div className="grid gap-3 sm:col-span-full sm:grid-cols-[260px_1fr]" data-rate-zone>
      <Field label={t('Zona')}>
        <Select value={zone} onChange={(e) => onChange({ zone: e.target.value, ...(e.target.value === 'COUNTRIES' ? {} : { countries: undefined, regions: undefined }) })} data-zone>
          {(Object.keys(ZONE_LABEL) as Zone[]).map((z) => <option key={z} value={z}>{t(ZONE_LABEL[z])}</option>)}
        </Select>
      </Field>
      {zone === 'COUNTRIES' && (
        <div className="space-y-2">
          <Field label={t('Países')} required>
            <Select value="" onChange={(e) => e.target.value && !list.includes(e.target.value) && onChange({ countries: [...list, e.target.value], regions: undefined })} data-zone-country>
              <option value="">{t('Agregar país…')}</option>
              {(countries ?? []).filter((c) => !list.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {list.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                {countryName(c)}
                <button type="button" onClick={() => onChange({ countries: list.filter((x) => x !== c), regions: undefined })} aria-label={t('Quitar {n}', { n: countryName(c) })}><X className="size-3" /></button>
              </span>
            ))}
            {!list.length && <span className="text-xs text-red-600">{t('Elige al menos un país.')}</span>}
          </div>
          {single && !!geo.data?.regions.length && (
            <Field label={t('Solo estos estados o provincias')} hint={t('(opcional; vacío = todo el país)')}>
              <Select value="" onChange={(e) => e.target.value && !regions.includes(e.target.value) && onChange({ regions: [...regions, e.target.value] })} data-zone-region>
                <option value="">{t('Agregar estado o provincia…')}</option>
                {geo.data.regions.filter((r) => !regions.includes(r.value)).map((r) => <option key={r.code} value={r.value}>{r.name}</option>)}
              </Select>
              {regions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {regions.map((r) => (
                    <span key={r} className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs font-semibold">
                      {geo.data!.regions.find((x) => x.value === r)?.name ?? r}
                      <button type="button" onClick={() => onChange({ regions: regions.filter((x) => x !== r) })} aria-label={t('Quitar {n}', { n: r })}><X className="size-3" /></button>
                    </span>
                  ))}
                </div>
              )}
            </Field>
          )}
        </div>
      )}
    </div>
  );
}
