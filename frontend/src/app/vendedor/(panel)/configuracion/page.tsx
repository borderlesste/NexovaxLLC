'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, FileText, ImageIcon, MapPin, Store, UploadCloud, X } from 'lucide-react';
import { LogoMark } from '@/components/layout/logo';
import { toast } from 'sonner';
import { del, errorMessage, get, put, upload } from '@/lib/api';
import { fmtDate } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { ENTITY_TYPES, entityLabel, fiscalPayload, taxIdHint } from '@/lib/entities';
import { useAuth } from '@/lib/auth';
import { StatusBadge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/misc';
import { cityLine, CountrySelect, GeoFields, PhoneInput } from '@/components/shop/geo-fields';
import { t } from '@/lib/i18n';
import { DestinationsCard } from '@/components/seller/destinations-card';

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

/** Fiscal data: optional at sign-up, completed or corrected here by the store owner. */
function LegalCard({ store, canEdit, onSaved }: { store: any; canEdit: boolean; onSaved: (r: any) => void }) {
  const [f, setF] = useState({ legalName: store.legalName ?? '', entityType: store.entityType ?? 'COMPANY', countryCode: store.countryCode ?? '', taxId: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await put('/seller/store/legal', fiscalPayload(f));
      setF((x) => ({ ...x, taxId: '' }));
      onSaved(r);
      toast.success(r.fiscalComplete ? t('Datos fiscales guardados.') : t('Datos fiscales guardados. Completa la identificación fiscal y el país para verificar tu tienda.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5 text-sm" data-seller-legal>
      <p className="flex items-center gap-2 text-lg font-bold"><FileText className="size-5 text-brand-600" /> {t('Datos fiscales')}</p>
      <p className="mt-1 text-muted">{store.fiscalComplete ? t('Completos. Aparecen en los recibos de tus clientes.') : t('Opcionales. Con la razón social, la identificación fiscal y el país completos tu tienda aparece como verificada y tus recibos los muestran.')}</p>
      <div className="mt-4 grid gap-3">
        <Field label={t('Nombre o razón social')} required><Input rule="businessName" value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} disabled={!canEdit} /></Field>
        <Field label={t('Tipo de entidad')}><Select value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value })} disabled={!canEdit}>{ENTITY_TYPES.map((e) => <option key={e} value={e}>{entityLabel(e)}</option>)}</Select></Field>
        <CountrySelect label={t('País de registro')} value={f.countryCode} onChange={(v) => setF({ ...f, countryCode: v })} />
        <Field label={taxIdHint(f.countryCode)} hint={store.hasTaxId ? t('Guardada: termina en {a}. Déjala vacía para conservarla.', { a: store.taxIdLast4 ?? '••••' }) : t('(se guarda cifrado)')}>
          <Input rule="taxId" value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} disabled={!canEdit} />
        </Field>
      </div>
      {canEdit ? <Button className="mt-4 w-full" onClick={save} loading={busy} disabled={!f.legalName.trim()}><Check /> {t('Guardar datos fiscales')}</Button>
        : <p className="mt-3 text-xs text-muted">{t('Solo el propietario de la tienda puede cambiar los datos fiscales.')}</p>}
    </Card>
  );
}

export default function StoreSettingsPage() {
  const qc = useQueryClient();
  const { seller } = useAuth();
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
  const removeImg = async (kind: 'logo' | 'banner') => {
    if (!window.confirm(kind === 'logo' ? t('¿Quitar el logo? Tu tienda mostrará el logo de NEXOVAX.') : t('¿Quitar la portada? Tu tienda mostrará la portada por defecto.'))) return;
    try {
      await del(`/seller/store/${kind}`);
      toast.success(kind === 'logo' ? t('Logo eliminado.') : t('Portada eliminada.'));
      q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const uploadImg = async (kind: 'logo' | 'banner', file?: File) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      await upload(`/seller/store/${kind}`, form);
      toast.success(kind === 'logo' ? t('Logo actualizado.') : t('Portada actualizada.'));
      q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader crumbs={[{ label: t('Mi tienda') }, { label: t('Configuración') }]} title={t('Configuración de la tienda')} description={t('Personaliza cómo ven tu tienda los compradores.')}
        actions={<>{s.status === 'ACTIVE' && <Button variant="secondary" asChild><Link href={`/tienda/${s.slug}`} target="_blank"><ExternalLink /> {t('Ver tienda pública')}</Link></Button>}<Button onClick={save} loading={busy}><Check /> {t('Guardar cambios')}</Button></>} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={<Store />} title={t('Información de la tienda')} />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
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
            <div className="space-y-5 p-5">
              <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { uploadImg('logo', e.target.files?.[0]); e.target.value = ''; }} />
              <input ref={bannerRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { uploadImg('banner', e.target.files?.[0]); e.target.value = ''; }} />
              <div className="flex flex-wrap items-start gap-4">
                <div className="relative size-36 shrink-0" data-store-logo>
                  <button type="button" onClick={() => logoRef.current?.click()} aria-label={t('Cambiar logo')}
                    className="grid size-full place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-brand-300 bg-white">
                    {s.logoUrl ? <img src={s.logoUrl} alt={t('Logo')} className="size-full object-cover" /> : <LogoMark className="size-20" />}
                  </button>
                  {s.logoUrl && <RemoveImage label={t('Quitar logo')} onClick={() => removeImg('logo')} />}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">{t('Logo')}</p>
                  <p className="mt-1 text-muted">{s.logoUrl ? t('Toca la imagen para cambiarla o la X para volver al logo de NEXOVAX.') : t('Sin logo propio: tu tienda muestra el logo de NEXOVAX. Toca la imagen para subir el tuyo.')}</p>
                  <p className="mt-2 text-xs text-muted">{t('Recomendado: cuadrado de 512 × 512 px (mínimo 256 × 256), PNG o JPG, hasta 8 MB. Se muestra recortado en cuadrado.')}</p>
                </div>
              </div>
              <div data-store-banner>
                <p className="mb-2 text-sm font-semibold">{t('Portada')}</p>
                <div className="relative">
                  <button type="button" onClick={() => bannerRef.current?.click()} aria-label={t('Cambiar portada')}
                    className="relative block aspect-[4/1] w-full overflow-hidden rounded-2xl border-2 border-dashed border-brand-300 bg-gradient-to-r from-brand-100 via-brand-200 to-brand-400">
                    {s.bannerUrl ? <img src={s.bannerUrl} alt={t('Portada')} className="absolute inset-0 size-full object-cover" />
                      : <span className="absolute inset-0 grid place-items-center text-sm font-semibold text-brand-800"><span className="flex items-center gap-2"><UploadCloud className="size-5" /> {t('Portada por defecto de NEXOVAX · toca para subir la tuya')}</span></span>}
                  </button>
                  {s.bannerUrl && <RemoveImage label={t('Quitar portada')} onClick={() => removeImg('banner')} />}
                </div>
                <p className="mt-2 text-xs text-muted">{t('Recomendado: 1600 × 400 px (proporción 4:1), PNG o JPG, hasta 8 MB. Deja el centro libre de texto importante: en móvil se recortan los lados.')}</p>
              </div>
            </div>
          </Card>
          <Card className="p-5 text-sm">
            <p className="text-lg font-bold">{t('Estado de la cuenta')}</p>
            <div className="mt-3 space-y-2">
              <div className="flex justify-between"><span className="text-muted">{t('Estado')}</span><StatusBadge status={s.status} /></div>
              <div className="flex justify-between"><span className="text-muted">{t('Verificación')}</span><StatusBadge status={s.verificationStatus === 'VERIFIED' ? 'VERIFIED' : 'PENDING'} /></div>
              <div className="flex justify-between"><span className="text-muted">{t('Razón social')}</span>{s.legalName ? <b>{s.legalName}</b> : <span className="text-amber-700">{t('Pendiente')}</span>}</div>
              <div className="flex justify-between"><span className="text-muted">{t('Registrada')}</span><b>{fmtDate(s.createdAt)}</b></div>
            </div>
            {s.shipFrom && <p className="mt-4 flex gap-2 rounded-lg bg-surface p-3"><MapPin className="size-4 shrink-0 text-brand-600" /> <span><b>{t('Almacén principal:')}</b> {s.shipFrom.line1} · {cityLine(s.shipFrom)}</span></p>}
          </Card>
          <LegalCard store={s} canEdit={!!seller?.isOwner} onSaved={(r) => qc.setQueryData(['seller-store'], r)} />
          <ShipFromCard store={s} onSaved={() => qc.invalidateQueries({ queryKey: ['seller-store'] })} />
          <DestinationsCard shipFromCountry={s.shipFrom?.countryCode ?? null} />
        </div>
      </div>
    </>
  );
}

function RemoveImage({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full bg-white text-ink shadow-md ring-1 ring-line hover:bg-red-50 hover:text-red-600">
      <X className="size-4" />
    </button>
  );
}
