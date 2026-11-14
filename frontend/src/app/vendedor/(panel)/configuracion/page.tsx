'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, ImageIcon, MapPin, Store, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, put, upload } from '@/lib/api';
import { fmtDate } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/misc';
import { cityLine, GeoFields, PhoneInput } from '@/components/shop/geo-fields';
import { t } from '@/lib/i18n';

function ShipFromCard({ store, onSaved }: { store: any; onSaved: () => void }) {
  const a = store.shipFrom ?? {};
  const [f, setF] = useState({ contactName: a.contactName ?? '', line1: a.line1 ?? '', line2: a.line2 ?? '', countryCode: a.countryCode ?? '', city: a.city ?? '', region: a.region ?? '', postalCode: a.postalCode ?? '', phone: a.phone ?? '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await put('/seller/store/ship-from', { ...f, line2: f.line2 || undefined, region: f.region || undefined, postalCode: f.postalCode || undefined });
      toast.success(t('Dirección de despacho actualizada.'));
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5 text-sm">
      <p className="flex items-center gap-2 text-lg font-bold"><MapPin className="size-5 text-brand-600" /> {t('Dirección de despacho')}</p>
      <p className="mt-1 text-muted">{t('Se usa para calcular tarifas de envío en vivo y generar etiquetas.')}</p>
      <div className="mt-4 grid gap-3">
        <Field label={t('Persona de contacto')} required><Input rule="personName" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
        <Field label={t('Dirección')} required><Input value={f.line1} onChange={(e) => setF({ ...f, line1: e.target.value })} /></Field>
        <Field label={t('Apartamento, suite o referencia')}><Input value={f.line2} onChange={(e) => setF({ ...f, line2: e.target.value })} /></Field>
        <GeoFields value={f} onChange={(p) => setF((s) => ({ ...s, ...p }))} />
        <Field label={t('Teléfono')} required><PhoneInput countryCode={f.countryCode} value={f.phone} onChange={(v) => setF((s) => ({ ...s, phone: v }))} required /></Field>
      </div>
      <Button className="mt-4 w-full" onClick={save} loading={busy}><Check /> {t('Guardar dirección')}</Button>
    </Card>
  );
}

export default function StoreSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['seller-store'], queryFn: () => get('/seller/store') });
  const [f, setF] = useState({ displayName: '', shortDescription: '', description: '', supportEmail: '', supportPhone: '' });
  const [busy, setBusy] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (q.data) setF({ displayName: q.data.displayName ?? '', shortDescription: q.data.shortDescription ?? '', description: q.data.description ?? '', supportEmail: q.data.supportEmail ?? '', supportPhone: q.data.supportPhone ?? '' });
  }, [q.data]);
  if (q.isLoading) return <PageLoader />;
  const s = q.data;
  const save = async () => {
    setBusy(true);
    try {
      const r = await put('/seller/store', f);
      qc.setQueryData(['seller-store'], r);
      toast.success(t('Tienda actualizada.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const uploadImg = async (kind: 'logo' | 'banner', file?: File) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      await upload(`/seller/store/${kind}`, form);
      toast.success(kind === 'logo' ? 'Logo actualizado.' : 'Portada actualizada.');
      q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader crumbs={[{ label: t('Mi tienda') }, { label: t('Configuración') }]} title={t('Configuración de la tienda')} description={t('Personaliza cómo ven tu tienda los compradores.')}
        actions={<>{s.status === 'ACTIVE' && <Button variant="secondary" asChild><Link href={`/tienda/${s.slug}`} target="_blank"><ExternalLink /> {t('Ver tienda pública')}</Link></Button>}<Button onClick={save} loading={busy}><Check /> {t('Guardar cambios')}</Button></>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={<Store />} title={t('Información de la tienda')} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label={t('Nombre visible')} required><Input rule="businessName" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
            <Field label={t('Descripción corta')}><Input value={f.shortDescription} onChange={(e) => setF({ ...f, shortDescription: e.target.value })} maxLength={200} /></Field>
            <Field label={t('Acerca de la tienda')} className="sm:col-span-2"><Textarea rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={3000} /></Field>
            <Field label={t('Correo de atención')}><Input rule="email" value={f.supportEmail} onChange={(e) => setF({ ...f, supportEmail: e.target.value })} /></Field>
            <Field label={t('Teléfono de atención')}><PhoneInput countryCode={q.data?.shipFrom?.countryCode ?? q.data?.address?.countryCode} value={f.supportPhone} onChange={(v) => setF((s) => ({ ...s, supportPhone: v }))} /></Field>
          </div>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader icon={<ImageIcon />} title={t('Identidad visual')} subtitle={t('Logo y portada de tu tienda.')} />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <input ref={logoRef} type="file" accept="image/*" hidden onChange={(e) => uploadImg('logo', e.target.files?.[0])} />
              <input ref={bannerRef} type="file" accept="image/*" hidden onChange={(e) => uploadImg('banner', e.target.files?.[0])} />
              <button onClick={() => logoRef.current?.click()} className="flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/40 text-sm">
                {s.logoUrl ? <img src={s.logoUrl} alt={t('Logo')} className="size-full object-cover" /> : <><UploadCloud className="size-8 text-brand-600" /><b className="mt-2">{t('Sube tu logo')}</b></>}
              </button>
              <button onClick={() => bannerRef.current?.click()} className="flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/40 text-sm">
                {s.bannerUrl ? <img src={s.bannerUrl} alt={t('Portada')} className="size-full object-cover" /> : <><UploadCloud className="size-8 text-brand-600" /><b className="mt-2">{t('Sube la portada')}</b></>}
              </button>
            </div>
          </Card>
          <Card className="p-5 text-sm">
            <p className="text-lg font-bold">{t('Estado de la cuenta')}</p>
            <div className="mt-3 space-y-2">
              <div className="flex justify-between"><span className="text-muted">{t('Estado')}</span><StatusBadge status={s.status} /></div>
              <div className="flex justify-between"><span className="text-muted">{t('Verificación')}</span><StatusBadge status={s.verificationStatus === 'VERIFIED' ? 'VERIFIED' : 'PENDING'} /></div>
              <div className="flex justify-between"><span className="text-muted">{t('Razón social')}</span><b>{s.legalName}</b></div>
              <div className="flex justify-between"><span className="text-muted">{t('Registrada')}</span><b>{fmtDate(s.createdAt)}</b></div>
            </div>
            {s.shipFrom && <p className="mt-4 flex gap-2 rounded-lg bg-surface p-3"><MapPin className="size-4 shrink-0 text-brand-600" /> <span><b>{t('Almacén principal:')}</b> {s.shipFrom.line1} · {cityLine(s.shipFrom)}</span></p>}
          </Card>
          <ShipFromCard store={s} onSaved={() => qc.invalidateQueries({ queryKey: ['seller-store'] })} />
        </div>
      </div>
    </>
  );
}
