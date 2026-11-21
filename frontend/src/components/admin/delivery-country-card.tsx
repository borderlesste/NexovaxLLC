'use client';
import { MapPin, X } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { useCountries } from '@/components/shop/geo-fields';
import { countryName, t } from '@/lib/i18n';

export interface GeoDelivery {
  ipDetection: boolean;
  showSelector: boolean;
  countries: string[];
  laneHistoryDays?: number;
}

/** Admin → Configuración → General: how the delivery destination is suggested (NX-GEO-001). */
export function DeliveryCountryCard({ value, defaultCountry, onChange }: { value: GeoDelivery; defaultCountry: string; onChange: (v: GeoDelivery) => void }) {
  const all = useCountries();
  const list = value.countries ?? [];
  const missingDefault = list.length > 0 && !!defaultCountry && !list.includes(defaultCountry);
  const toggles: [keyof GeoDelivery, string, string][] = [
    ['showSelector', t('Selector «Enviar a» en el encabezado'), t('Los visitantes ven el destino usado y pueden cambiarlo sin registrarse.')],
    ['ipDetection', t('Sugerir el país según la conexión'), t('Usa el país que estima la infraestructura (Vercel o Cloudflare) a partir de la IP. No se guarda la IP; si no hay dato, se usa el país predeterminado.')],
  ];
  return (
    <Card>
      <CardHeader icon={<MapPin />} title={t('País de entrega')} subtitle={t('Orden: elección del visitante, preferencia de su cuenta, país estimado por la conexión y, por último, el país predeterminado.')} />
      <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
        {toggles.map(([k, title, desc]) => (
          <div key={k} className="flex items-start gap-3 rounded-xl border border-line p-4">
            <span className="flex-1"><b className="block text-sm">{title}</b><span className="text-xs text-muted">{desc}</span></span>
            <Switch checked={!!value[k]} onCheckedChange={(v) => onChange({ ...value, [k]: v })} />
          </div>
        ))}
        <div className="space-y-2 sm:col-span-2">
          <Field label={t('Destinos ofrecidos en el selector')} hint={t('(vacío = todos los países)')}>
            <Select value="" onChange={(e) => e.target.value && !list.includes(e.target.value) && onChange({ ...value, countries: [...list, e.target.value] })}>
              <option value="">{t('Agregar país…')}</option>
              {all.filter((c) => !list.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {list.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                {countryName(c)}
                <button type="button" onClick={() => onChange({ ...value, countries: list.filter((x) => x !== c) })} aria-label={t('Quitar {n}', { n: countryName(c) })}><X className="size-3" /></button>
              </span>
            ))}
            {!list.length && <span className="text-xs text-muted">{t('Se ofrecen todos los países del catálogo.')}</span>}
          </div>
          {missingDefault && <p className="text-xs text-red-600">{t('Agrega el país predeterminado ({c}) a la lista o cámbialo.', { c: countryName(defaultCountry) })}</p>}
        </div>
        <Field label={t('Días de historial de envíos para marcar «Disponible»')} hint={t('Si la tienda obtuvo tarifas reales hacia ese país en este plazo, el producto se muestra disponible; si no, «Por confirmar».')}>
          <Input inputMode="numeric" value={String(value.laneHistoryDays ?? 90)} onChange={(e) => onChange({ ...value, laneHistoryDays: Math.min(365, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)) })} suffix={t('días')} />
        </Field>
      </div>
    </Card>
  );
}
