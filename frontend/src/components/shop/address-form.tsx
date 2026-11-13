'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage, get, post, put } from '@/lib/api';
import { Dialog, Checkbox } from '@/components/ui/misc';
import { Field, Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface Address {
  id: string;
  label?: string | null;
  recipientName: string;
  line1: string;
  line2?: string | null;
  city: string;
  cityId: string;
  region?: string | null;
  phone?: string | null;
  isDefaultShipping: boolean;
}

export function AddressDialog({ open, onOpenChange, address, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; address?: Address | null; onSaved: (a: Address) => void }) {
  const cities = useQuery({ queryKey: ['cities'], queryFn: () => get('/geo/cities'), staleTime: Infinity });
  const [f, setF] = useState(() => ({
    label: address?.label ?? 'Casa',
    recipientName: address?.recipientName ?? '',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    cityId: address?.cityId ?? '',
    region: address?.region ?? '',
    phone: address?.phone ?? '',
    isDefaultShipping: address?.isDefaultShipping ?? false,
  }));
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    if (!f.recipientName.trim() || !f.line1.trim() || !f.cityId) return toast.error('Completa nombre, dirección y ciudad.');
    setSaving(true);
    try {
      const body = { ...f, cityId: Number(f.cityId), phone: f.phone || undefined, line2: f.line2 || undefined, region: f.region || undefined };
      const r = address ? await put(`/me/addresses/${address.id}`, body) : await post('/me/addresses', body);
      toast.success('Dirección guardada.');
      onSaved(r);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={address ? 'Editar dirección' : 'Agregar nueva dirección'} size="lg"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={save} loading={saving}>Guardar dirección</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre de la dirección"><Select value={f.label} onChange={(e) => set('label', e.target.value)}><option>Casa</option><option>Trabajo</option><option>Otra</option></Select></Field>
        <Field label="Nombre de quien recibe" required><Input value={f.recipientName} onChange={(e) => set('recipientName', e.target.value)} placeholder="Ej. Juan Pérez" /></Field>
        <Field label="Dirección" required className="sm:col-span-2"><Input value={f.line1} onChange={(e) => set('line1', e.target.value)} placeholder="Calle, número, sector" /></Field>
        <Field label="Referencia / apartamento" className="sm:col-span-2"><Input value={f.line2} onChange={(e) => set('line2', e.target.value)} placeholder="Ej. Edificio 3, apto 2B, frente al colmado" /></Field>
        <Field label="Ciudad" required>
          <Select value={f.cityId} onChange={(e) => set('cityId', e.target.value)}>
            <option value="">Selecciona una ciudad</option>
            {(cities.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Provincia / sector"><Input value={f.region} onChange={(e) => set('region', e.target.value)} placeholder="Ej. Distrito Nacional" /></Field>
        <Field label="Teléfono"><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+1 (809) 555-1234" /></Field>
        <div className="flex items-end"><Checkbox checked={f.isDefaultShipping} onChange={(v) => set('isDefaultShipping', v)} label="Usar como predeterminada" /></div>
      </div>
    </Dialog>
  );
}
