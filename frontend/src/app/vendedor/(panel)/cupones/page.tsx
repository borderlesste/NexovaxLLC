'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, Plus, TicketPercent, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, post, put } from '@/lib/api';
import { fmtDate, money } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/input';
import { Dialog, Empty, PageLoader, Switch } from '@/components/ui/misc';
import { ProductPicker } from '@/components/seller/product-picker';

const STATE: Record<string, [string, 'green' | 'amber' | 'gray' | 'red' | 'blue']> = {
  ACTIVE: ['Activo', 'green'], SCHEDULED: ['Programado', 'blue'], INACTIVE: ['Pausado', 'gray'], EXPIRED: ['Vencido', 'red'], EXHAUSTED: ['Agotado', 'amber'],
};
const EMPTY = { code: '', type: 'PERCENT', value: '', minSubtotal: '', maxDiscount: '', startsAt: '', endsAt: '', maxRedemptions: '', perCustomer: '1', productIds: [] as string[], active: true };
const toLocal = (iso?: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export default function CouponsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['seller-coupons'], queryFn: () => get<any[]>('/seller/coupons') });
  const [dlg, setDlg] = useState<null | { id?: string; f: typeof EMPTY }>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['seller-coupons'] });
  // Coming from Statistics → "Crear cupón": open a new coupon for that product.
  useEffect(() => {
    const pid = new URLSearchParams(window.location.search).get('producto');
    if (pid && /^[0-9a-f-]{36}$/i.test(pid)) setDlg({ f: { ...EMPTY, productIds: [pid] } });
  }, []);
  const save = async () => {
    if (!dlg) return;
    const f = dlg.f;
    setBusy(true);
    try {
      const body = {
        code: f.code.trim().toUpperCase(), type: f.type, value: Number(f.value),
        minSubtotal: f.minSubtotal === '' ? null : Number(f.minSubtotal), maxDiscount: f.type === 'PERCENT' && f.maxDiscount !== '' ? Number(f.maxDiscount) : null,
        startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null, endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
        maxRedemptions: f.maxRedemptions === '' ? null : Number(f.maxRedemptions), perCustomer: f.perCustomer === '' ? null : Number(f.perCustomer),
        productIds: f.productIds, active: f.active,
      };
      dlg.id ? await put(`/seller/coupons/${dlg.id}`, body) : await post('/seller/coupons', body);
      toast.success(dlg.id ? t('Cupón actualizado.') : t('Cupón creado.'));
      setDlg(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (c: any, active: boolean) => {
    try { await post(`/seller/coupons/${c.id}/active`, { active }); refresh(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const remove = async (c: any) => {
    if (!confirm(t('¿Eliminar el cupón {code}? Los pedidos que ya lo usaron conservan su descuento.', { code: c.code }))) return;
    try { await del(`/seller/coupons/${c.id}`); toast.success(t('Cupón eliminado.')); refresh(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const set = (patch: Partial<typeof EMPTY>) => dlg && setDlg({ ...dlg, f: { ...dlg.f, ...patch } });
  const f = dlg?.f;
  return (
    <>
      <PageHeader crumbs={[{ label: t('Inicio') }, { label: t('Cupones') }]} title={t('Cupones')}
        description={t('Crea códigos de descuento para tus productos. El descuento lo financia tu tienda: se descuenta de lo que recibes por esa venta.')}
        actions={<Button onClick={() => setDlg({ f: { ...EMPTY } })} data-coupon-new><Plus /> {t('Nuevo cupón')}</Button>} />
      <Card>
        {q.isLoading ? <PageLoader /> : !q.data?.length ? (
          <Empty icon={<TicketPercent />} title={t('Aún no tienes cupones')} description={t('Comparte un código con tus clientes para darles un descuento en tu tienda.')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-coupons-table>
              <thead className="bg-surface text-left text-xs text-muted"><tr><th className="px-5 py-2.5">{t('Código')}</th><th>{t('Descuento')}</th><th>{t('Condiciones')}</th><th>{t('Vigencia')}</th><th>{t('Usos')}</th><th>{t('Estado')}</th><th /></tr></thead>
              <tbody className="divide-y divide-line">
                {q.data.map((c) => (
                  <tr key={c.id} data-coupon-row={c.code}>
                    <td className="px-5 py-3"><button className="inline-flex items-center gap-1.5 font-mono font-bold" onClick={() => navigator.clipboard.writeText(c.code).then(() => toast.success(t('Copiado.')))}>{c.code} <Copy className="size-3.5 text-muted" /></button></td>
                    <td className="font-semibold">{c.type === 'PERCENT' ? `${c.value} %` : money(c.value)}{c.maxDiscount ? <span className="block text-xs font-normal text-muted">{t('Máx. {a}', { a: money(c.maxDiscount) })}</span> : null}</td>
                    <td className="text-xs text-muted">{c.minSubtotal ? t('Compra mínima {a}', { a: money(c.minSubtotal) }) : t('Sin compra mínima')}<br />{c.productIds.length ? t('{n} producto(s)', { n: c.productIds.length }) : t('Todos los productos')}</td>
                    <td className="text-xs text-muted">{c.startsAt ? fmtDate(c.startsAt) : t('Desde hoy')} → {c.endsAt ? fmtDate(c.endsAt) : t('Sin vencimiento')}</td>
                    <td className="text-xs">{c.uses}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}<span className="block text-muted">{t('Descontado: {a}', { a: money(c.discounted) })}</span></td>
                    <td><Badge tone={STATE[c.state]?.[1] ?? 'gray'}>{t(STATE[c.state]?.[0] ?? c.state)}</Badge></td>
                    <td className="pr-5">
                      <div className="flex items-center justify-end gap-2">
                        <Switch checked={c.status === 'ACTIVE'} onCheckedChange={(v) => toggle(c, v)} />
                        <Button size="icon" variant="ghost" aria-label={t('Editar')} onClick={() => setDlg({ id: c.id, f: { code: c.code, type: c.type, value: String(c.value), minSubtotal: c.minSubtotal != null ? String(c.minSubtotal) : '', maxDiscount: c.maxDiscount != null ? String(c.maxDiscount) : '', startsAt: toLocal(c.startsAt), endsAt: toLocal(c.endsAt), maxRedemptions: c.maxRedemptions != null ? String(c.maxRedemptions) : '', perCustomer: c.perCustomer != null ? String(c.perCustomer) : '', productIds: c.productIds, active: c.status === 'ACTIVE' } })}><Pencil /></Button>
                        <Button size="icon" variant="ghost" className="text-red-600" aria-label={t('Eliminar')} onClick={() => remove(c)}><Trash2 /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {dlg && f && (
        <Dialog open onOpenChange={(o) => !o && setDlg(null)} size="lg" title={dlg.id ? t('Editar cupón') : t('Nuevo cupón')}
          description={t('Los clientes escriben el código al pagar. Aplica solo a productos de tu tienda.')}
          footer={<><Button variant="secondary" onClick={() => setDlg(null)}>{t('Cancelar')}</Button><Button loading={busy} disabled={!f.code.trim() || !f.value} onClick={save} data-coupon-save>{dlg.id ? t('Guardar cambios') : t('Crear cupón')}</Button></>}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-coupon-form>
            <Field label={t('Código')} required hint={dlg.id ? t('El código no se puede cambiar.') : t('3 a 24 caracteres: letras, números, guion o guion bajo.')}>
              <Input value={f.code} disabled={!!dlg.id} maxLength={24} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} placeholder="VERANO10" data-coupon-code />
            </Field>
            <Field label={t('Tipo de descuento')} required>
              <Select value={f.type} onChange={(e) => set({ type: e.target.value })} data-coupon-type>
                <option value="PERCENT">{t('Porcentaje (%)')}</option>
                <option value="FIXED">{t('Monto fijo')}</option>
              </Select>
            </Field>
            <Field label={f.type === 'PERCENT' ? t('Porcentaje') : t('Monto')} required>
              <Input type="number" min={0.01} step="0.01" max={f.type === 'PERCENT' ? 90 : undefined} value={f.value} onChange={(e) => set({ value: e.target.value })} data-coupon-value />
            </Field>
            {f.type === 'PERCENT' ? (
              <Field label={t('Descuento máximo (opcional)')}><Input type="number" min={0.01} step="0.01" value={f.maxDiscount} onChange={(e) => set({ maxDiscount: e.target.value })} /></Field>
            ) : <div />}
            <Field label={t('Compra mínima en tu tienda (opcional)')}><Input type="number" min={0} step="0.01" value={f.minSubtotal} onChange={(e) => set({ minSubtotal: e.target.value })} data-coupon-min /></Field>
            <div />
            <Field label={t('Desde (opcional)')}><Input type="datetime-local" value={f.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></Field>
            <Field label={t('Hasta (opcional)')}><Input type="datetime-local" value={f.endsAt} onChange={(e) => set({ endsAt: e.target.value })} /></Field>
            <Field label={t('Usos totales (opcional)')}><Input type="number" min={1} step="1" value={f.maxRedemptions} onChange={(e) => set({ maxRedemptions: e.target.value })} /></Field>
            <Field label={t('Usos por cliente')}><Input type="number" min={1} step="1" value={f.perCustomer} onChange={(e) => set({ perCustomer: e.target.value })} /></Field>
            <div className="sm:col-span-2">
              <p className="mb-2 text-sm font-semibold">{t('Productos')}</p>
              <ProductPicker value={f.productIds} onChange={(ids) => set({ productIds: ids })} />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={f.active} onCheckedChange={(v) => set({ active: v })} /> {t('Cupón activo')}</label>
          </div>
        </Dialog>
      )}
    </>
  );
}
