'use client';
import { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';

export default function SecurityPage() {
  const { me, signOut } = useAuth();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (pw !== pw2) return toast.error(t('Las contraseñas no coinciden.'));
    setBusy(true);
    try {
      await put('/me/password', { password: pw });
      toast.success(t('Contraseña actualizada.'));
      setPw('');
      setPw2('');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t('Seguridad')}</h1>
      <p className="text-muted">{t('Cambia tu contraseña y refuerza la seguridad de tu cuenta.')}</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Lock className="size-5 text-brand-600" /> {t('Cambiar contraseña')}</h2>
          <Field label={t('Nueva contraseña')} className="mt-4"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
          <Field label={t('Confirmar contraseña')} className="mt-3"><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
          <p className="mt-2 text-xs text-muted">{t('Mínimo 8 caracteres, con letras y números.')}</p>
          <Button className="mt-4" onClick={save} loading={busy} disabled={!pw}>{t('Actualizar contraseña')}</Button>
        </div>
        <div className="card p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="size-5 text-brand-600" /> {t('Sesión')}</h2>
          <p className="mt-3 text-sm text-muted">{t('Sesión iniciada como')}{' '}<b className="text-ink">{me?.email}</b>.</p>
          <Button variant="danger" className="mt-4" onClick={signOut}>{t('Cerrar sesión en este dispositivo')}</Button>
        </div>
      </div>
    </div>
  );
}
