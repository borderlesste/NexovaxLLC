'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, put } from '@/lib/api';
import { countryName, t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Dialog, PageLoader, Switch } from '@/components/ui/misc';

const pct = (v: any) => (v == null || v === '' ? '' : String(+(Number(v) * 100).toFixed(4)));
const rate = (p: string) => Number((Number(p || 0) / 100).toFixed(6));
const num = (v: string) => v.replace(/[^\d.]/g, '');

/**
 * Admin → Configuración → Impuestos: rates by state / province of the shipping address. An active
 * row replaces the country rate for buyers in that state (US sales tax by state).
 */
export function TaxRegionsDialog({ countryCode, open, onOpenChange, onChanged }: { countryCode: string; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const key = ['admin-tax-regions', countryCode];
  const q = useQuery({ queryKey: key, queryFn: () => get<any[]>(`/admin/tax-rates/${countryCode}/regions`), enabled: open && !!countryCode });
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState({ regionCode: '', regionName: '', taxName: '', ratePct: '' });
  useEffect(() => setRows((q.data ?? []).map((r) => ({ ...r, ratePct: pct(r.rate), reducedPct: pct(r.reducedRate) }))), [q.data]);
  const refresh = (data: any[]) => {
    qc.setQueryData(key, data);
    onChanged();
  };
  const save = async (r: any) => {
    setBusy(r.regionCode);
    try {
      const data = await put<any[]>('/admin/tax-rates/regions', {
        countryCode, regionCode: r.regionCode, regionName: r.regionName || undefined, taxName: r.taxName, rate: rate(r.ratePct),
        reducedRate: r.reducedPct !== '' && r.reducedPct != null ? rate(r.reducedPct) : null,
        appliesToShipping: !!r.appliesToShipping, isActive: !!r.isActive, notes: r.notes || undefined,
      });
      toast.success(t('Impuesto de {c} guardado.', { c: r.regionName || r.regionCode }));
      refresh(data);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const remove = async (r: any) => {
    if (!confirm(t('¿Eliminar el impuesto de {c}? Ese estado usará la tasa del país.', { c: r.regionName }))) return;
    try {
      refresh(await del<any[]>(`/admin/tax-rates/${countryCode}/regions/${r.regionCode}`));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const add = async () => {
    if (!draft.regionCode || !draft.taxName) return toast.error(t('Indica el código del estado y el nombre del impuesto.'));
    if (await save({ ...draft, regionCode: draft.regionCode.toUpperCase(), reducedPct: '', isActive: false })) setDraft({ regionCode: '', regionName: '', taxName: '', ratePct: '' });
  };
  const f = filter.trim().toLowerCase();
  const shown = rows.filter((r) => !f || r.regionName.toLowerCase().includes(f) || r.regionCode.toLowerCase() === f);
  const active = rows.filter((r) => r.isActive).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl" title={t('Impuesto por estado: {c}', { c: countryName(countryCode) })}
      description={t('Una fila activa reemplaza la tasa del país para direcciones de envío en ese estado. Activa solo los estados donde estás registrado para cobrar el impuesto. Estas tasas son estatales: no incluyen impuestos de ciudad o condado ni exenciones por tipo de producto.')}>
      {q.isLoading ? <PageLoader /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('Buscar estado…')} className="h-9 max-w-xs" />
            <span className="text-xs text-muted">{t('{a} de {n} activos', { a: active, n: rows.length })}</span>
          </div>
          <div className="max-h-[55vh] overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs text-muted"><tr><th className="px-4 py-2.5">{t('Estado')}</th><th>{t('Impuesto')}</th><th className="w-28">{t('Tasa')}</th><th className="w-28">{t('Tasa reducida')}</th><th title={t('El cargo de envío también paga impuesto.')}>{t('Grava envío')}</th><th>{t('Activo')}</th><th className="w-36" /></tr></thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => {
                  const upd = (k: string, v: any) => setRows((rs) => rs.map((x) => (x.regionCode === r.regionCode ? { ...x, [k]: v } : x)));
                  return (
                    <tr key={r.regionCode}>
                      <td className="px-4 py-2 font-semibold">{r.regionName} <span className="text-xs text-muted">{r.regionCode}</span>{r.notes && <span className="block text-xs font-normal text-muted">{r.notes}</span>}</td>
                      <td className="pr-3"><Input rule="businessName" value={r.taxName} onChange={(e) => upd('taxName', e.target.value)} className="h-9" /></td>
                      <td className="pr-3"><Input rule="percent" inputMode="decimal" value={r.ratePct} onChange={(e) => upd('ratePct', num(e.target.value))} suffix="%" className="h-9" aria-label={t('Tasa')} /></td>
                      <td className="pr-3"><Input rule="percent" inputMode="decimal" value={r.reducedPct} placeholder={r.ratePct} onChange={(e) => upd('reducedPct', num(e.target.value))} suffix="%" className="h-9" aria-label={t('Tasa reducida')} /></td>
                      <td><Switch checked={!!r.appliesToShipping} onCheckedChange={(v) => upd('appliesToShipping', v)} /></td>
                      <td><Switch checked={!!r.isActive} onCheckedChange={(v) => upd('isActive', v)} /></td>
                      <td className="pr-4 text-right">
                        <Button size="sm" variant="outline" loading={busy === r.regionCode} onClick={() => save(r)}>{t('Guardar')}</Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(r)} aria-label={t('Eliminar')}><Trash2 /></Button>
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-muted">{t('Sin estados configurados.')}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[100px_1.2fr_1fr_110px_auto]">
            <Field label={t('Código')}><Input value={draft.regionCode} maxLength={6} onChange={(e) => setDraft({ ...draft, regionCode: e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase() })} placeholder="PA" /></Field>
            <Field label={t('Estado o provincia')}><Input rule="businessName" value={draft.regionName} onChange={(e) => setDraft({ ...draft, regionName: e.target.value })} placeholder={t('(opcional)')} /></Field>
            <Field label={t('Nombre del impuesto')}><Input rule="businessName" value={draft.taxName} onChange={(e) => setDraft({ ...draft, taxName: e.target.value })} placeholder="Sales tax" /></Field>
            <Field label={t('Tasa')}><Input rule="percent" inputMode="decimal" value={draft.ratePct} onChange={(e) => setDraft({ ...draft, ratePct: num(e.target.value) })} suffix="%" /></Field>
            <Button className="self-end" onClick={add}><Plus /> {t('Agregar')}</Button>
          </div>
          <p className="text-xs text-muted">{t('Las tasas iniciales de EE. UU. son tasas estatales de referencia (noviembre de 2026); confírmalas con tu asesor fiscal. Para el impuesto exacto por dirección (ciudad y condado), usa Stripe Tax en la fila del país.')}</p>
        </div>
      )}
    </Dialog>
  );
}
