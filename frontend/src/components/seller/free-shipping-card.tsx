'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCountries } from '@/components/shop/geo-fields';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ErrorBox } from '@/components/ui/misc';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { countryName, t } from '@/lib/i18n';
import { money } from '@/lib/utils';

const path = '/seller/store/free-shipping';
const amountPattern = /^\d{1,16}(?:\.\d{1,2})?$/;

interface FreeShippingPolicy {
  enabled: boolean;
  countries: string[];
  minimumSubtotal: string | null;
  currency: string;
  previousCurrency?: string;
  previousMinimumSubtotal?: string | null;
}
type Draft = Pick<FreeShippingPolicy, 'enabled' | 'countries' | 'minimumSubtotal'>;

export function FreeShippingCard() {
  const { seller } = useAuth();
  return seller ? <FreeShippingSettings key={seller.id} sellerId={seller.id} /> : null;
}

function FreeShippingSettings({ sellerId }: { sellerId: string }) {
  const qc = useQueryClient();
  const queryKey = ['seller-free-shipping', sellerId];
  const headers = { 'x-seller-id': sellerId };
  const query = useQuery({ queryKey, queryFn: () => api<FreeShippingPolicy>(path, { headers }) });
  const countries = useCountries();
  const [draft, setDraft] = useState<Draft | null>(null);
  const save = useMutation({
    mutationFn: (values: Draft & { expectedCurrency: string }) => api<FreeShippingPolicy>(path, {
      headers, method: 'PUT', json: values,
    }),
    onSuccess: (policy) => {
      qc.setQueryData(queryKey, policy);
      void qc.invalidateQueries({ queryKey: ['checkout-quote'] });
      void qc.invalidateQueries({ queryKey: ['availability'] });
      setDraft(null);
      toast.success(t('Configuración de envío gratis guardada.'));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'FREE_SHIPPING_CURRENCY_CHANGED') {
        setDraft(null);
        void query.refetch();
      }
      toast.error(errorMessage(error));
    },
  });

  const policy = query.data;
  const form = draft ?? policy;
  const amount = form?.minimumSubtotal?.trim().replace(',', '.') ?? '';
  const invalidAmount = !!amount && !amountPattern.test(amount);
  const missingCountry = form?.enabled && !form.countries.length;
  const set = (patch: Partial<Draft>) => {
    if (form) setDraft({ enabled: form.enabled, countries: form.countries, minimumSubtotal: form.minimumSubtotal, ...patch });
  };

  return (
    <Card>
      <CardHeader icon={<Truck />} title={t('Envío gratis')} subtitle={t('La tienda paga el envío y registra su propia guía.')} />
      {query.isPending && <p className="px-5 pb-5 text-sm text-muted">{t('Cargando…')}</p>}
      {query.isError && <div className="px-5 pb-5"><ErrorBox message={errorMessage(query.error)} onRetry={() => void query.refetch()} /></div>}
      {policy && form && (
        <form className="space-y-4 p-5" onSubmit={(event) => {
          event.preventDefault();
          if (invalidAmount || missingCountry || !draft || save.isPending) return;
          save.mutate({
            enabled: form.enabled, countries: form.countries, minimumSubtotal: amount || null, expectedCurrency: policy.currency,
          });
        }}>
          {policy.previousCurrency && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
              {t('La moneda cambió de {old} a {current}. Revisa el mínimo y guarda la configuración para volver a ofrecer envío gratis.', {
                old: policy.previousCurrency, current: policy.currency,
              })}
              {policy.previousMinimumSubtotal != null && <p className="mt-1">{t('Mínimo anterior')} {money(policy.previousMinimumSubtotal, policy.previousCurrency)}</p>}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-4 accent-brand-600" checked={form.enabled} disabled={save.isPending}
              onChange={(event) => set({
                enabled: event.target.checked,
                minimumSubtotal: !event.target.checked && invalidAmount ? policy.minimumSubtotal : form.minimumSubtotal,
              })} />
            {t('Ofrecer envío gratis')}
          </label>
          {form.enabled && (
            <>
              <div className="space-y-2">
                <label className="block space-y-1 text-sm font-semibold">
                  <span>{t('Países')}</span>
                  <Select value="" disabled={save.isPending} onChange={(event) => {
                    if (event.target.value) set({ countries: [...form.countries, event.target.value] });
                  }}>
                    <option value="">{t('Agregar país…')}</option>
                    {countries.filter((country) => !form.countries.includes(country.code)).map((country) => (
                      <option key={country.code} value={country.code}>{country.name}</option>
                    ))}
                  </Select>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {form.countries.map((code) => (
                    <span key={code} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                      {countryName(code)}
                      <button type="button" disabled={save.isPending} aria-label={t('Quitar {n}', { n: countryName(code) })}
                        onClick={() => set({ countries: form.countries.filter((country) => country !== code) })}><X className="size-3" /></button>
                    </span>
                  ))}
                </div>
                {missingCountry && <p className="text-xs text-red-600">{t('Elige al menos un país.')}</p>}
              </div>
              <label className="block space-y-1 text-sm font-semibold">
                <span>{t('Subtotal mínimo ({currency})', { currency: policy.currency })}</span>
                <Input inputMode="decimal" maxLength={19} value={form.minimumSubtotal ?? ''} disabled={save.isPending}
                  aria-invalid={invalidAmount} onChange={(event) => set({ minimumSubtotal: event.target.value })} />
              </label>
              <p className="text-xs text-muted">{t('Se suman los productos de tu tienda antes de los cupones. Deja el campo vacío para ofrecer envío gratis sin mínimo.')}</p>
              {invalidAmount && <p className="text-xs text-red-600">{t('Indica un importe positivo o cero con hasta dos decimales.')}</p>}
            </>
          )}
          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending} disabled={!draft || invalidAmount || missingCountry}>{t('Guardar envío gratis')}</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
