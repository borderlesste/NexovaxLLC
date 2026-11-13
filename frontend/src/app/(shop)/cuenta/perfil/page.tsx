'use client';
import { useEffect, useState } from 'react';
import { Check, Shield, ShoppingBag, Store } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, put } from '@/lib/api';
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
  const roleLabels: Record<string, string> = { CUSTOMER: t('Comprador'), SELLER: t('Vendedor'), MODERATOR: t('Moderador'), SUPPORT: t('Soporte'), ADMIN: t('Administrador'), SUPER_ADMIN: t('Super administrador') };
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t('Mi perfil')}</h1>
      <p className="text-muted">{t('Gestiona tu información personal y la configuración de tu cuenta.')}</p>
      <div className="mt-6 grid gap-6 xl:grid-cols-[280px_1fr]">
        <div className="card flex flex-col items-center p-6 text-center">
          <Avatar name={me.displayName} src={me.avatarUrl} size={112} />
          <p className="mt-4 text-xl font-extrabold">{me.displayName}</p>
          <p className="text-sm text-muted">{me.email}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {me.roles.map((r) => <Badge key={r} tone="violet">{r === 'SELLER' ? <Store className="size-3" /> : r === 'CUSTOMER' ? <ShoppingBag className="size-3" /> : <Shield className="size-3" />} {roleLabels[r] ?? r}</Badge>)}
          </div>
          <p className="mt-4 text-sm text-muted">{t('Miembro desde:')}{' '}{fmtDate(me.memberSince)}</p>
          {seller && <p className="mt-1 text-xs text-muted">{t('Tienda:')}{' '}<b>{seller.slug}</b></p>}
        </div>
        <div className="card p-6">
          <h2 className="text-lg font-bold">{t('Información personal')}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={t('Nombre')} required><Input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></Field>
            <Field label={t('Apellido')} required><Input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></Field>
            <Field label={t('Correo electrónico')} hint={t('(no editable)')}><Input value={me.email} disabled /></Field>
            <Field label={t('Teléfono')}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+1 (809) 555-1234" /></Field>
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
