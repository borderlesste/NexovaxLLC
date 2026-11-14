'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage, post, put } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Dialog, Checkbox } from '@/components/ui/misc';
import { Field, Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { GeoFields, PhoneInput } from './geo-fields';

export interface Address {
  id: string;
  label?: string | null;
  recipientName: string;
  companyName?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode?: string | null;
  countryCode: string;
  phone?: string | null;
  isDefaultShipping: boolean;
}

export function AddressDialog({ open, onOpenChange, address, onSaved, defaultCountry }: { open: boolean; onOpenChange: (o: boolean) => void; address?: Address | null; onSaved: (a: Address) => void; defaultCountry?: string }) {
  const { me } = useAuth();
  const [f, setF] = useState(() => ({
    label: address?.label ?? t('Casa'),
    recipientName: address?.recipientName ?? me?.displayName ?? '',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    countryCode: address?.countryCode ?? defaultCountry ?? '',
    city: address?.city ?? '',
    region: address?.region ?? '',
    postalCode: address?.postalCode ?? '',
    phone: address?.phone ?? me?.phone ?? '',
    isDefaultShipping: address?.isDefaultShipping ?? false,
  }));
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    if (!f.recipientName.trim() || !f.line1.trim() || !f.countryCode || !f.city.trim()) return toast.error(t('Completa nombre, dirección, país y ciudad.'));
    setSaving(true);
    try {
      const body = { ...f, phone: f.phone || undefined, line2: f.line2 || undefined, region: f.region || undefined, postalCode: f.postalCode || undefined };
      const r = address ? await put(`/me/addresses/${address.id}`, body) : await post('/me/addresses', body);
      toast.success(t('Dirección guardada.'));
      onSaved(r);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={address ? t('Editar dirección') : t('Agregar nueva dirección')} size="lg"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>{t('Cancelar')}</Button><Button onClick={save} loading={saving}>{t('Guardar dirección')}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Nombre de la dirección')}>
          <Select value={f.label} onChange={(e) => set('label', e.target.value)}>
            {[t('Casa'), t('Trabajo'), t('Otra')].map((o) => <option key={o}>{o}</option>)}
            {f.label && ![t('Casa'), t('Trabajo'), t('Otra')].includes(f.label) && <option>{f.label}</option>}
          </Select>
        </Field>
        <Field label={t('Nombre de quien recibe')} required><Input rule="personName" value={f.recipientName} onChange={(e) => set('recipientName', e.target.value)} placeholder={t('Nombre y apellido')} /></Field>
        <Field label={t('Dirección')} required className="sm:col-span-2"><Input value={f.line1} onChange={(e) => set('line1', e.target.value)} placeholder={t('Calle y número')} /></Field>
        <Field label={t('Apartamento, suite o referencia')} className="sm:col-span-2"><Input value={f.line2} onChange={(e) => set('line2', e.target.value)} placeholder={t('Ej. Apto 2B, edificio 3')} /></Field>
        <GeoFields value={f} onChange={(p) => setF((s) => ({ ...s, ...p }))} />
        <Field label={t('Teléfono')}><PhoneInput countryCode={f.countryCode} value={f.phone} onChange={(v) => set('phone', v)} /></Field>
        <div className="flex items-end"><Checkbox checked={f.isDefaultShipping} onChange={(v) => set('isDefaultShipping', v)} label={t('Usar como predeterminada')} /></div>
      </div>
    </Dialog>
  );
}
