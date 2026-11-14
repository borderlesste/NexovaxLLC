'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, put } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';

export interface Policy { windowDays: number; requireEvidence: boolean; inspectionRequired: boolean; shippingRefund: 'NONE' | 'FULL_IF_ALL_RETURNED' | 'FULL'; restockingFeePercent: number; labelPayer: 'CUSTOMER' | 'BY_REASON' | 'STORE' | 'MARKETPLACE' }

export const LABEL_PAYER: Record<string, string> = {
  CUSTOMER: 'El cliente envía por su cuenta',
  BY_REASON: 'Etiqueta pagada por la tienda si el problema es de la tienda',
  STORE: 'Etiqueta prepagada, la paga la tienda',
  MARKETPLACE: 'Etiqueta prepagada, la paga el marketplace',
};
export const SHIPPING_REFUND: Record<string, string> = {
  NONE: 'No se reembolsa el envío original',
  FULL_IF_ALL_RETURNED: 'Se reembolsa si se devuelve todo el pedido',
  FULL: 'Siempre se reembolsa el envío original',
};

/** One-line summary of a policy for customers. */
export function policySummary(p: { windowDays: number; labelPayer: string; shippingRefund: string; restockingFeePercent: number }) {
  return [
    t('{n} días desde la entrega', { n: p.windowDays }),
    t(LABEL_PAYER[p.labelPayer] ?? p.labelPayer),
    t(SHIPPING_REFUND[p.shippingRefund] ?? p.shippingRefund),
    p.restockingFeePercent ? t('cargo por reposición del {n} %', { n: p.restockingFeePercent }) : null,
  ].filter(Boolean).join(' · ');
}

function PolicyForm({ value, onSave, busy, store }: { value: Policy; onSave: (p: Policy) => void; busy: boolean; store?: boolean }) {
  const [f, setF] = useState<Policy>(value);
  useEffect(() => setF(value), [value]);
  const dirty = JSON.stringify(f) !== JSON.stringify(value);
  return (
    <div className="space-y-4 p-5" data-return-policy-form>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('Plazo (días desde la entrega)')}><Input rule="integer" value={String(f.windowDays)} onChange={(e) => setF({ ...f, windowDays: Math.min(Number(e.target.value.replace(/\D/g, '') || 0), 365) })} data-policy="windowDays" /></Field>
        <Field label={t('Etiqueta de devolución')}>
          <Select value={f.labelPayer} onChange={(e) => setF({ ...f, labelPayer: e.target.value as Policy['labelPayer'] })} data-policy="labelPayer">
            {Object.entries(LABEL_PAYER).filter(([k]) => !store || k !== 'MARKETPLACE').map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
          </Select>
        </Field>
        <Field label={t('Envío original')}>
          <Select value={f.shippingRefund} onChange={(e) => setF({ ...f, shippingRefund: e.target.value as Policy['shippingRefund'] })}>
            {Object.entries(SHIPPING_REFUND).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
          </Select>
        </Field>
        <Field label={t('Cargo por reposición (%)')} hint={t('0 a 50')}><Input rule="integer" value={String(f.restockingFeePercent)} onChange={(e) => setF({ ...f, restockingFeePercent: Math.min(Number(e.target.value.replace(/\D/g, '') || 0), 50) })} /></Field>
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2"><Switch checked={f.inspectionRequired} onCheckedChange={(v) => setF({ ...f, inspectionRequired: v })} /> {t('Inspeccionar antes de reembolsar')}</label>
        <label className="flex items-center gap-2"><Switch checked={f.requireEvidence} onCheckedChange={(v) => setF({ ...f, requireEvidence: v })} /> {t('Exigir fotos en toda devolución')}</label>
      </div>
      <p className="text-xs text-muted">{t('Los cambios aplican a las devoluciones nuevas; las que ya se pidieron conservan las condiciones con las que se crearon.')}</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={!dirty} onClick={() => setF(value)}>{t('Descartar cambios')}</Button>
        <Button loading={busy} disabled={!dirty} onClick={() => onSave(f)} data-policy-save>{t('Guardar política')}</Button>
      </div>
    </div>
  );
}

const pick = (p: any): Policy => ({ windowDays: p.windowDays, requireEvidence: p.requireEvidence, inspectionRequired: p.inspectionRequired, shippingRefund: p.shippingRefund, restockingFeePercent: p.restockingFeePercent, labelPayer: p.labelPayer });

/** Admin: marketplace-wide return policy. */
export function MarketplaceReturnPolicy() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['return-policy', 'admin'], queryFn: () => get('/admin/returns/policy') });
  const [busy, setBusy] = useState(false);
  if (!q.data) return null;
  const save = async (p: Policy) => {
    setBusy(true);
    try {
      qc.setQueryData(['return-policy', 'admin'], await put('/admin/returns/policy', p));
      toast.success(t('Política de devoluciones actualizada.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mb-5">
      <CardHeader icon={<RotateCcw />} title={t('Política de devoluciones del marketplace')} subtitle={t('Aplica a todas las tiendas; cada tienda puede tener una propia más favorable para el cliente.')} />
      <PolicyForm value={pick(q.data)} onSave={save} busy={busy} />
    </Card>
  );
}

/** Seller: follow the marketplace policy or publish a more generous one. */
export function StoreReturnPolicy() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['return-policy', 'seller'], queryFn: () => get('/seller/returns/policy') });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  if (!q.data) return null;
  const { own, marketplace } = q.data;
  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try {
      qc.setQueryData(['return-policy', 'seller'], await fn());
      toast.success(t(ok));
      setEditing(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mb-5" data-store-return-policy>
      <CardHeader icon={<RotateCcw />} title={t('Política de devoluciones de tu tienda')}
        subtitle={own ? t('Usas una política propia.') : t('Usas la política del marketplace. Puedes ofrecer una más favorable para tus clientes.')}
        action={own ? <Button size="sm" variant="ghost" loading={busy} onClick={() => run(() => del('/seller/returns/policy'), 'Ahora usas la política del marketplace.')}>{t('Volver a la del marketplace')}</Button>
          : !editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-store-policy-edit>{t('Crear política propia')}</Button>} />
      {own || editing ? (
        <PolicyForm store value={pick(own ?? marketplace)} busy={busy} onSave={(p) => run(() => put('/seller/returns/policy', p), 'Política de la tienda publicada.')} />
      ) : (
        <p className="p-5 text-sm text-muted">{policySummary(marketplace)}</p>
      )}
      {(own || editing) && <p className="px-5 pb-4 text-xs text-muted">{t('Mínimo del marketplace')}: {policySummary(marketplace)}</p>}
    </Card>
  );
}
