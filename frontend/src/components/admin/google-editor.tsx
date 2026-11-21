'use client';
import { BarChart3, Copy, ExternalLink, ShoppingBag, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { useCountries } from '@/components/shop/geo-fields';
import { countryName, t } from '@/lib/i18n';

export interface GoogleIntegrations {
  ga4Enabled: boolean;
  ga4MeasurementId: string;
  merchantFeedEnabled: boolean;
  merchantShippingCountries: string[];
  merchantCondition: 'new' | 'used' | 'refurbished';
  merchantIncludeOutOfStock: boolean;
  merchantStoreAsBrand: boolean;
}

const DEFAULTS: GoogleIntegrations = {
  ga4Enabled: false, ga4MeasurementId: '', merchantFeedEnabled: false, merchantShippingCountries: [],
  merchantCondition: 'new', merchantIncludeOutOfStock: false, merchantStoreAsBrand: false,
};

function Toggle({ title, desc, checked, onChange }: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line p-4">
      <span className="flex-1"><b className="block text-sm">{title}</b><span className="text-xs text-muted">{desc}</span></span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** Admin → Configuración → Google: Google Analytics 4 and the Merchant Center product feed. */
export function GoogleEditor({ value, siteUrl, defaultCountry, onChange }: { value?: Partial<GoogleIntegrations>; siteUrl: string; defaultCountry: string; onChange: (v: GoogleIntegrations) => void }) {
  const v: GoogleIntegrations = { ...DEFAULTS, ...(value ?? {}) };
  const set = <K extends keyof GoogleIntegrations>(k: K, x: GoogleIntegrations[K]) => onChange({ ...v, [k]: x });
  const all = useCountries();
  const list = v.merchantShippingCountries ?? [];
  const base = (siteUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '');
  const feedUrl = `${base}/feeds/google-merchant.xml`;
  const copy = () => navigator.clipboard.writeText(feedUrl).then(() => toast.success(t('Copiado.')));
  return (
    <>
      <Card>
        <CardHeader icon={<BarChart3 />} title={t('Google Analytics 4')} subtitle={t('Mide visitas, productos vistos, carritos, inicios de pago y compras. Solo se carga si el visitante acepta las cookies de analítica; la publicidad personalizada queda siempre desactivada.')} />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <Toggle title={t('Activar Google Analytics')} desc={t('Envía los eventos view_item, add_to_cart, begin_checkout y purchase.')} checked={v.ga4Enabled} onChange={(x) => set('ga4Enabled', x)} />
          <Field label={t('ID de medición')} hint={t('En Google Analytics: Administrar → Flujos de datos → Web. Tiene la forma G-XXXXXXXXXX.')}>
            <Input value={v.ga4MeasurementId} placeholder="G-XXXXXXXXXX" maxLength={24} onChange={(e) => set('ga4MeasurementId', e.target.value.toUpperCase().replace(/\s/g, ''))} data-ga4-id />
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader icon={<ShoppingBag />} title={t('Google Merchant Center')} subtitle={t('Publica un feed con los productos de todas las tiendas para que aparezcan gratis en Google Shopping, Imágenes y la búsqueda. Se actualiza solo cada 15 minutos.')} />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <Toggle title={t('Publicar el feed de productos')} desc={t('Incluye los productos publicados de tiendas activas, con foto y precio, en la moneda del marketplace.')} checked={v.merchantFeedEnabled} onChange={(x) => set('merchantFeedEnabled', x)} />
          <div className="rounded-xl border border-line p-4">
            <b className="block text-sm">{t('URL del feed')}</b>
            <span className="text-xs text-muted">{t('Regístrala en Merchant Center → Productos → Fuentes de datos → Agregar fuente → Archivo en una URL.')}</span>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs" data-feed-url>{feedUrl}</code>
              <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={t('Copiar')}><Copy /></Button>
              {v.merchantFeedEnabled && <Button type="button" variant="outline" size="sm" asChild><a href="/feeds/google-merchant.xml" target="_blank" rel="noreferrer" aria-label={t('Abrir')}><ExternalLink /></a></Button>}
            </div>
          </div>
          <Field label={t('Estado de los productos')} hint={t('Se declara igual para todos los productos.')}>
            <Select value={v.merchantCondition} onChange={(e) => set('merchantCondition', e.target.value as GoogleIntegrations['merchantCondition'])}>
              <option value="new">{t('Nuevo')}</option>
              <option value="refurbished">{t('Reacondicionado')}</option>
              <option value="used">{t('Usado')}</option>
            </Select>
          </Field>
          <Toggle title={t('Incluir productos agotados')} desc={t('Se envían como «agotado» en lugar de quitarlos del feed.')} checked={v.merchantIncludeOutOfStock} onChange={(x) => set('merchantIncludeOutOfStock', x)} />
          <Toggle title={t('Usar el nombre de la tienda como marca')} desc={t('Para productos sin marca. Úsalo solo si las tiendas venden productos propios.')} checked={v.merchantStoreAsBrand} onChange={(x) => set('merchantStoreAsBrand', x)} />
          <div className="space-y-2 sm:col-span-2">
            <Field label={t('Países con precio de envío en el feed')} hint={t('Se usa la tarifa fija más barata del marketplace que cubra la ruta. Vacío: {c}. Sin tarifa fija, aplica la configuración de envío de Merchant Center.', { c: countryName(defaultCountry) })}>
              <Select value="" onChange={(e) => e.target.value && !list.includes(e.target.value) && set('merchantShippingCountries', [...list, e.target.value])}>
                <option value="">{t('Agregar país…')}</option>
                {all.filter((c) => !list.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {list.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                  {countryName(c)}
                  <button type="button" onClick={() => set('merchantShippingCountries', list.filter((x) => x !== c))} aria-label={t('Quitar {n}', { n: countryName(c) })}><X className="size-3" /></button>
                </span>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
