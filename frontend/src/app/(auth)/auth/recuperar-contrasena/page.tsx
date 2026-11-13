'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Mail, MailCheck } from 'lucide-react';
import { ApiError, post } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';

export default function RecoverPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/auth/password-recovery', { email: email.trim().toLowerCase() });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Demasiados intentos. Espera unos minutos.' : t('No pudimos enviar el correo. Inténtalo más tarde.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="card mx-auto max-w-md rounded-3xl p-8">
      {sent ? (
        <div className="text-center">
          <MailCheck className="mx-auto size-14 text-brand-600" />
          <h1 className="mt-4 text-2xl font-extrabold">{t('Revisa tu correo')}</h1>
          <p className="mt-2 text-muted">{t('Si existe una cuenta con')}{' '}<b>{email}</b>{t(', recibirás un enlace para restablecer tu contraseña.')}</p>
          <Button asChild className="mt-6"><Link href="/auth/iniciar-sesion">{t('Volver a iniciar sesión')}</Link></Button>
        </div>
      ) : (
        <>
          <h1 className="text-3xl font-extrabold">{t('Recuperar contraseña')}</h1>
          <p className="mt-1 text-muted">{t('Te enviaremos un enlace para crear una nueva contraseña.')}</p>
          <Field label={t('Correo electrónico')} required className="mt-6"><Input type="email" required icon={<Mail />} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('usuario@correo.com')} className="h-11" /></Field>
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" size="lg" className="mt-6 w-full" loading={busy}>{t('Enviar enlace')}</Button>
          <p className="mt-4 text-center text-sm"><Link href="/auth/iniciar-sesion" className="font-semibold text-brand-700">{t('Volver a iniciar sesión')}</Link></p>
        </>
      )}
    </form>
  );
}
