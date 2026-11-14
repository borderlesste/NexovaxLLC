'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Shield, ShoppingBag, Store, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, put, upload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { t } from '@/lib/i18n';

export default function ProfilePage() {
  const { me, refresh, seller } = useAuth();
  const [f, setF] = useState({ firstName: '', lastName: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (me) setF({ firstName: me.firstName ?? '', lastName: me.lastName ?? '', phone: me.phone ?? '' });
  }, [me]);
  if (!me) return null;
  const save = async () => {
    setBusy(true);
    try {
      await put('/me/profile', { firstName: f.firstName, lastName: f.lastName, phone: f.phone || undefined });
      toast.success(t('Perfil actualizado.'));
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const changePhoto = async (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) return toast.error(t('Formato no permitido. Usa JPG, PNG, WebP o AVIF.'));
    if (file.size > 8 * 1024 * 1024) return toast.error(t('La imagen supera 8 MB.'));
    setPhotoBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await upload('/me/avatar', form);
      toast.success(t('Foto de perfil actualizada.'));
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      await del('/me/avatar');
      toast.success(t('Foto de perfil eliminada.'));
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  };
  const roleLabels: Record<string, string> = { CUSTOMER: t('Comprador'), SELLER: t('Vendedor'), MODERATOR: t('Moderador'), SUPPORT: t('Soporte'), ADMIN: t('Administrador'), SUPER_ADMIN: t('Super administrador') };
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t('Mi perfil')}</h1>
      <p className="text-muted">{t('Gestiona tu información personal y la configuración de tu cuenta.')}</p>
      <div className="mt-6 grid gap-6 xl:grid-cols-[280px_1fr]">
        <div className="card flex flex-col items-center p-6 text-center">
          <div className="relative">
            <Avatar name={me.displayName} src={me.avatarUrl} size={112} className={photoBusy ? 'opacity-50' : undefined} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy}
              className="absolute bottom-0 right-0 grid size-9 place-items-center rounded-full border-2 border-white bg-brand-600 text-white shadow hover:bg-brand-700 disabled:opacity-60"
              aria-label={t('Cambiar foto de perfil')} title={t('Cambiar foto de perfil')}>
              <Camera className="size-4" />
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(e) => changePhoto(e.target.files?.[0])} />
          </div>
          <div className="mt-2 flex gap-3 text-xs">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy} className="font-semibold text-brand-700 hover:underline">{me.avatarUrl ? t('Cambiar foto') : t('Subir foto')}</button>
            {me.avatarUrl && <button type="button" onClick={removePhoto} disabled={photoBusy} className="inline-flex items-center gap-1 text-red-600 hover:underline"><Trash2 className="size-3" /> {t('Quitar')}</button>}
          </div>
          <p className="mt-1 text-[11px] text-muted">{t('JPG, PNG, WebP o AVIF · máx. 8 MB')}</p>
          <p className="mt-4 max-w-full break-all text-xl font-extrabold">{me.displayName}</p>
          <p className="max-w-full break-all text-sm text-muted">{me.email}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {me.roles.map((r) => <Badge key={r} tone="violet">{r === 'SELLER' ? <Store className="size-3" /> : r === 'CUSTOMER' ? <ShoppingBag className="size-3" /> : <Shield className="size-3" />} {roleLabels[r] ?? r}</Badge>)}
          </div>
          <p className="mt-4 text-sm text-muted">{t('Miembro desde:')}{' '}{fmtDate(me.memberSince)}</p>
          {seller && <p className="mt-1 text-xs text-muted">{t('Tienda:')}{' '}<b>{seller.slug}</b></p>}
        </div>
        <div className="card p-6">
          <h2 className="text-lg font-bold">{t('Información personal')}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={t('Nombre')} required><Input rule="personName" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></Field>
            <Field label={t('Apellido')} required><Input rule="personName" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></Field>
            <Field label={t('Correo electrónico')} hint={t('(no editable)')}><Input value={me.email} disabled /></Field>
            <Field label={t('Teléfono')}><Input rule="phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+1 (809) 555-1234" /></Field>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setF({ firstName: me.firstName ?? '', lastName: me.lastName ?? '', phone: me.phone ?? '' })}>{t('Cancelar')}</Button>
            <Button onClick={save} loading={busy}><Check /> {t('Guardar cambios')}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
