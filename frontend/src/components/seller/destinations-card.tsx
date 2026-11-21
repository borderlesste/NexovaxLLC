'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe2, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, put } from '@/lib/api';
import { countryName, t } from '@/lib/i18n';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/input';
import { useCountries } from '@/components/shop/geo-fields';

export type DestinationMode = 'ALL' | 'DOMESTIC' | 'ONLY' | 'EXCEPT';
type Mode = DestinationMode;
export interface DestinationDraft { mode: DestinationMode; countries: string[] }

/**
 * Where the store (or one product) ships to (NX-GEO-001). Buyers see "No disponible" with the
 * reason for the excluded destinations, and checkout blocks them for the confirmed address.
 *
 * With `draft` + `onDraftChange` it edits the destinations of a product that does not exist yet
 * (new product form): nothing is fetched or saved here, the editor saves them after creating it.
 */
export function DestinationsCard({ productId, shipFromCountry, draft, onDraftChange }: {
  productId?: string; shipFromCountry?: string | null; draft?: DestinationDraft; onDraftChange?: (d: DestinationDraft) => void;
}) {
  const isDraft = !!draft && !!onDraftChange;
  const forProduct = !!productId || isDraft;
  const path = productId ? `/seller/products/${productId}/destinations` : '/seller/store/destinations';
  const qc = useQueryClient();
  const q = useQuery<{ mode: Mode; countries: string[]; updatedAt: string | null }>({ queryKey: ['seller-destinations', productId ?? 'store'], queryFn: () => get(path), enabled: !isDraft });
  const all = useCountries();
  const [ownMode, setOwnMode] = useState<Mode>('ALL');
  const [ownList, setOwnList] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) { setOwnMode(q.data.mode); setOwnList(q.data.countries ?? []); }
  }, [q.data]);
  const mode = isDraft ? draft.mode : ownMode;
  const list = isDraft ? draft.countries : ownList;
  const setMode = (m: Mode) => (isDraft ? onDraftChange({ ...draft, mode: m }) : setOwnMode(m));
  const setList = (l: string[]) => (isDraft ? onDraftChange({ ...draft, countries: l }) : setOwnList(l));
  const needsList = mode === 'ONLY' || mode === 'EXCEPT';
  const dirty = !!q.data && (mode !== q.data.mode || JSON.stringify(needsList ? list : []) !== JSON.stringify(q.data.countries ?? []));
  const modes: [Mode, string][] = [
    ['ALL', forProduct ? t('Igual que la tienda') : t('Todos los destinos del marketplace')],
    ...(forProduct ? [] : ([['DOMESTIC', shipFromCountry ? t('Solo dentro de {c}', { c: countryName(shipFromCountry) }) : t('Solo envíos nacionales')]] as [Mode, string][])),
    ['ONLY', t('Solo a estos países')],
    ['EXCEPT', t('A todos excepto estos países')],
  ];
  const save = async () => {
    setBusy(true);
    try {
      const r = await put(path, { mode, countries: needsList ? list : [] });
      qc.setQueryData(['seller-destinations', productId ?? 'store'], r);
      qc.invalidateQueries({ queryKey: ['availability'] });
      toast.success(t('Destinos de envío guardados.'));
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader
        icon={<Globe2 />}
        title={forProduct ? t('Destinos de este producto') : t('Destinos de envío')}
        subtitle={forProduct ? t('Limita a qué países se envía este producto, además de lo que permite tu tienda.') : t('Los compradores de los países que excluyas verán «No disponible» y no podrán pagar esos productos.')}
      />
      <div className="space-y-3 p-5">
        <Field label={t('Envíos')}>
          <Select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            {modes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        {needsList && (
          <>
            <Field label={t('Países')} required>
              <Select value="" onChange={(e) => e.target.value && !list.includes(e.target.value) && setList([...list, e.target.value])}>
                <option value="">{t('Agregar país…')}</option>
                {all.filter((c) => !list.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {list.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                  {countryName(c)}
                  <button type="button" onClick={() => setList(list.filter((x) => x !== c))} aria-label={t('Quitar {n}', { n: countryName(c) })}><X className="size-3" /></button>
                </span>
              ))}
              {!list.length && <span className="text-xs text-red-600">{t('Elige al menos un país.')}</span>}
            </div>
          </>
        )}
        <p className="text-xs text-muted">{t('La disponibilidad final se confirma con la dirección del comprador y las tarifas de envío al pagar.')}</p>
        {!isDraft && <div className="flex justify-end"><Button onClick={save} loading={busy} disabled={!dirty || (needsList && !list.length)}>{t('Guardar destinos')}</Button></div>}
      </div>
    </Card>
  );
}
