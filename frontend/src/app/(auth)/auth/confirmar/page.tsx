'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CheckCircle2, MailWarning } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

/** Landing page of the e-mailed verification link: exchanges the one-time token and signs the user in. */
export default function ConfirmEmailPage() {
  const router = useRouter();
  const [state, setState] = useState<'verifying' | 'ok' | 'error'>('verifying');
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const tokenHash = q.get('token_hash');
    window.history.replaceState(null, '', '/auth/confirmar');
    if (!tokenHash) return setState('error');
    supabase()
      .auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
      .then(({ error }) => {
        setState(error ? 'error' : 'ok');
        if (!error) setTimeout(() => router.replace('/'), 2500);
      });
  }, [router]);
  return (
    <div className="card mx-auto max-w-md rounded-3xl p-8 text-center">
      {state === 'error' ? <MailWarning className="mx-auto size-12 text-orange-500" /> : <CheckCircle2 className="mx-auto size-12 text-emerald-600" />}
      <h1 className="mt-4 text-2xl font-extrabold">
        {state === 'verifying' ? t('Confirmando tu correo…') : state === 'ok' ? t('¡Correo confirmado!') : t('No pudimos confirmar tu correo')}
      </h1>
      <p className="mt-2 text-muted">
        {state === 'ok'
          ? t('Tu cuenta está activa. Te llevamos a la tienda…')
          : state === 'error'
            ? t('El enlace expiró o ya fue usado. Inicia sesión para solicitar uno nuevo.')
            : t('Un momento, por favor.')}
      </p>
      {state === 'error' && (
        <Link href="/auth/iniciar-sesion?registered=1"><Button className="mt-6 w-full">{t('Ir a iniciar sesión')}</Button></Link>
      )}
    </div>
  );
}
