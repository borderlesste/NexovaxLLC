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
      toast.success('Tienda actualizada.');
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
      <PageHeader crumbs={[{ label: 'Mi tienda' }, { label: 'Configuración' }]} title="Configuración de la tienda" description="Personaliza cómo ven tu tienda los compradores."
        actions={<>{s.status === 'ACTIVE' && <Button variant="secondary" asChild><Link href={`/tienda/${s.slug}`} target="_blank"><ExternalLink /> Ver tienda pública</Link></Button>}<Button onClick={save} loading={busy}><Check /> Guardar cambios</Button></>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={<Store />} title="Información de la tienda" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Nombre visible" required><Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
            <Field label="Descripción corta"><Input value={f.shortDescription} onChange={(e) => setF({ ...f, shortDescription: e.target.value })} maxLength={200} /></Field>
            <Field label="Acerca de la tienda" className="sm:col-span-2"><Textarea rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={3000} /></Field>
            <Field label="Correo de atención"><Input value={f.supportEmail} onChange={(e) => setF({ ...f, supportEmail: e.target.value })} /></Field>
            <Field label="Teléfono de atención"><Input value={f.supportPhone} onChange={(e) => setF({ ...f, supportPhone: e.target.value })} /></Field>
          </div>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader icon={<ImageIcon />} title="Identidad visual" subtitle="Logo y portada de tu tienda." />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <input ref={logoRef} type="file" accept="image/*" hidden onChange={(e) => uploadImg('logo', e.target.files?.[0])} />
              <input ref={bannerRef} type="file" accept="image/*" hidden onChange={(e) => uploadImg('banner', e.target.files?.[0])} />
              <button onClick={() => logoRef.current?.click()} className="flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/40 text-sm">
                {s.logoUrl ? <img src={s.logoUrl} alt="Logo" className="size-full object-cover" /> : <><UploadCloud className="size-8 text-brand-600" /><b className="mt-2">Sube tu logo</b></>}
              </button>
              <button onClick={() => bannerRef.current?.click()} className="flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/40 text-sm">
                {s.bannerUrl ? <img src={s.bannerUrl} alt="Portada" className="size-full object-cover" /> : <><UploadCloud className="size-8 text-brand-600" /><b className="mt-2">Sube la portada</b></>}
              </button>
            </div>
          </Card>
          <Card className="p-5 text-sm">
            <p className="text-lg font-bold">Estado de la cuenta</p>
            <div className="mt-3 space-y-2">
              <div className="flex justify-between"><span className="text-muted">Estado</span><StatusBadge status={s.status} /></div>
              <div className="flex justify-between"><span className="text-muted">Verificación</span><StatusBadge status={s.verificationStatus === 'VERIFIED' ? 'VERIFIED' : 'PENDING'} /></div>
              <div className="flex justify-between"><span className="text-muted">Razón social</span><b>{s.legalName}</b></div>
              <div className="flex justify-between"><span className="text-muted">Registrada</span><b>{fmtDate(s.createdAt)}</b></div>
            </div>
            {s.shipFrom && <p className="mt-4 flex gap-2 rounded-lg bg-surface p-3"><MapPin className="size-4 shrink-0 text-brand-600" /> <span><b>Almacén principal:</b> {s.shipFrom.line1}, {s.shipFrom.city}</span></p>}
          </Card>
        </div>
      </div>
    </>
  );
}
