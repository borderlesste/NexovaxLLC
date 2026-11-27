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
import { countryName, getCurrency, t } from '@/lib/i18n';
import { money } from '@/lib/utils';

const amountPattern = /^\d{1,16}(?:\.\d{1,2})?$/;

interface FreeShippingPolicy {
  enabled: boolean;
  countries: string[];
  minimumSubtotal: string | null;
  currency: string;
  previousCurrency?: string;
  previousMinimumSubtotal?: string | null;
}
export type FreeShippingDraft = Pick<FreeShippingPolicy, 'enabled' | 'countries' | 'minimumSubtotal'>;
export const emptyFreeShipping: FreeShippingDraft = { enabled: false, countries: [], minimumSubtotal: null };

const normalizeAmount = (value: string | null | undefined) => value?.trim().replace(',', '.') ?? '';

/** Problem that prevents saving the free-shipping settings, or null. */
export function freeShippingError(draft: FreeShippingDraft) {
  if (!draft.enabled) return null;
  if (!draft.countries.length) return t('Elige al menos un país para el envío gratis.');
  const amount = normalizeAmount(draft.minimumSubtotal);
  if (amount && !amountPattern.test(amount)) return t('Indica un importe positivo o cero con hasta dos decimales.');
  return null;
}

/** Body for PUT /seller/products/:id/free-shipping. */
export function freeShippingBody(draft: FreeShippingDraft, expectedCurrency?: string) {
  return {
    enabled: draft.enabled, countries: draft.countries, minimumSubtotal: normalizeAmount(draft.minimumSubtotal) || null,
    ...(expectedCurrency ? { expectedCurrency } : {}),
  };
}

/**
 * Free shipping paid by the store for one product. With `draft` + `onDraftChange` it edits the
 * settings of a product that does not exist yet (new product form): the editor saves them after
 * creating the product. With `productId` it loads and saves them itself.
 */
export function FreeShippingCard({ productId, draft, onDraftChange }: {
  productId?: string; draft?: FreeShippingDraft; onDraftChange?: (draft: FreeShippingDraft) => void;
}) {
  const { seller } = useAuth();
  if (draft && onDraftChange) {
    return <FreeShippingForm value={draft} currency={getCurrency()} onChange={onDraftChange} />;
  }
  return seller && productId ? <ProductFreeShipping key={`${seller.id}:${productId}`} sellerId={seller.id} productId={productId} /> : null;
}

function ProductFreeShipping({ sellerId, productId }: { sellerId: string; productId: string }) {
  const qc = useQueryClient();
  const path = `/seller/products/${productId}/free-shipping`;
  const queryKey = ['seller-free-shipping', sellerId, productId];
  const headers = { 'x-seller-id': sellerId };
  const query = useQuery({ queryKey, queryFn: () => api<FreeShippingPolicy>(path, { headers }) });
  const [draft, setDraft] = useState<FreeShippingDraft | null>(null);
  const save = useMutation({
    mutationFn: (values: ReturnType<typeof freeShippingBody>) => api<FreeShippingPolicy>(path, { headers, method: 'PUT', json: values }),
    onSuccess: (policy) => {
      qc.setQueryData(queryKey, policy);
      void qc.invalidateQueries({ queryKey: ['checkout-quote'] });
      void qc.invalidateQueries({ queryKey: ['availability'] });
      setDraft(null);
      toast.success(t('Envío gratis del producto guardado.'));
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
  const invalid = form ? freeShippingError(form) : null;
  return (
    <>
      {query.isPending && <Shell><p className="px-5 pb-5 text-sm text-muted">{t('Cargando…')}</p></Shell>}
      {query.isError && <Shell><div className="px-5 pb-5"><ErrorBox message={errorMessage(query.error)} onRetry={() => void query.refetch()} /></div></Shell>}
      {policy && form && (
        <FreeShippingForm
          value={form} currency={policy.currency} busy={save.isPending}
          onChange={(next) => setDraft(next)}
          notice={policy.previousCurrency && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
              {t('La moneda cambió de {old} a {current}. Revisa el mínimo y guarda la configuración para volver a ofrecer envío gratis.', {
                old: policy.previousCurrency, current: policy.currency,
              })}
              {policy.previousMinimumSubtotal != null && <p className="mt-1">{t('Mínimo anterior')} {money(policy.previousMinimumSubtotal, policy.previousCurrency)}</p>}
            </div>
          )}
          footer={(
            <div className="flex justify-end">
              <Button type="button" loading={save.isPending} disabled={!draft || !!invalid}
                onClick={() => { if (draft && !invalid && !save.isPending) save.mutate(freeShippingBody(draft, policy.currency)); }}>
                {t('Guardar envío gratis')}
              </Button>
            </div>
          )}
        />
      )}
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader icon={<Truck />} title={t('Envío gratis')} subtitle={t('Tu tienda paga el envío de este producto y registra su propia guía.')} />
      {children}
    </Card>
  );
}

function FreeShippingForm({ value, currency, busy, onChange, notice, footer }: {
  value: FreeShippingDraft; currency: string; busy?: boolean; onChange: (next: FreeShippingDraft) => void;
  notice?: React.ReactNode; footer?: React.ReactNode;
}) {
  const countries = useCountries();
  const amount = normalizeAmount(value.minimumSubtotal);
  const invalidAmount = !!amount && !amountPattern.test(amount);
  const set = (patch: Partial<FreeShippingDraft>) => onChange({ ...value, ...patch });
  return (
    <Shell>
      <div className="space-y-4 p-5">
        {notice}
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="size-4 accent-brand-600" checked={value.enabled} disabled={busy}
            onChange={(event) => set({ enabled: event.target.checked })} />
          {t('Ofrecer envío gratis en este producto')}
        </label>
        {value.enabled && (
          <>
            <div className="space-y-2">
              <label className="block space-y-1 text-sm font-semibold">
                <span>{t('Países')}</span>
                <Select value="" disabled={busy} onChange={(event) => {
                  if (event.target.value) set({ countries: [...value.countries, event.target.value] });
                }}>
                  <option value="">{t('Agregar país…')}</option>
                  {countries.filter((country) => !value.countries.includes(country.code)).map((country) => (
                    <option key={country.code} value={country.code}>{country.name}</option>
                  ))}
                </Select>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {value.countries.map((code) => (
                  <span key={code} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                    {countryName(code)}
                    <button type="button" disabled={busy} aria-label={t('Quitar {n}', { n: countryName(code) })}
                      onClick={() => set({ countries: value.countries.filter((country) => country !== code) })}><X className="size-3" /></button>
                  </span>
                ))}
              </div>
              {!value.countries.length && <p className="text-xs text-red-600">{t('Elige al menos un país.')}</p>}
            </div>
            <label className="block space-y-1 text-sm font-semibold">
              <span>{t('Subtotal mínimo ({currency})', { currency })}</span>
              <Input inputMode="decimal" maxLength={19} value={value.minimumSubtotal ?? ''} disabled={busy}
                aria-invalid={invalidAmount} onChange={(event) => set({ minimumSubtotal: event.target.value })} />
            </label>
            <p className="text-xs text-muted">{t('Se suman los productos de tu tienda en el carrito antes de los cupones. Deja el campo vacío para ofrecer envío gratis sin mínimo.')}</p>
            <p className="text-xs text-muted">{t('Si el comprador lleva en el mismo pedido otro producto de tu tienda sin envío gratis, paga el envío normal.')}</p>
            {invalidAmount && <p className="text-xs text-red-600">{t('Indica un importe positivo o cero con hasta dos decimales.')}</p>}
          </>
        )}
        {footer}
      </div>
    </Shell>
  );
}
