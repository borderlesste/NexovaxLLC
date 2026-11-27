'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Loader2, MailWarning } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { PENDING_EMAIL_KEY, takeBadgeSignup, welcomeBadgeIntro } from '@/lib/auth-pending';
import { safeNextPath } from '@/lib/safe-redirect';

/** Landing page of the e-mailed verification link: exchanges the one-time token and signs the user in. */
export default function ConfirmEmailPage() {
  const [failed, setFailed] = useState(false);
  const [next, setNext] = useState('/');
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    const tokenHash = q.get('token_hash');
    const returnTo = safeNextPath(q.get('next'));
    setNext(returnTo);
    window.history.replaceState(null, '', '/auth/confirmar');
    if (!tokenHash) return setFailed(true);
    void supabase()
      .auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
      .then(({ data, error }) => {
        if (error || !data.session || !data.user) return setFailed(true);
        const savedNext = takeBadgeSignup(data.user.email);
        try { sessionStorage.removeItem(PENDING_EMAIL_KEY); } catch {}
        if (window.location.pathname === '/auth/confirmar') {
          window.location.replace(welcomeBadgeIntro(returnTo === '/' ? savedNext ?? '/' : returnTo));
        }
      })
      .catch(() => setFailed(true));
  }, []);
  return (
    <div className="card mx-auto max-w-md rounded-3xl p-8 text-center">
      {failed ? <MailWarning aria-hidden className="mx-auto size-12 text-accent-700" /> : <Loader2 aria-hidden className="mx-auto size-12 text-brand-700 motion-safe:animate-spin" />}
      <h1 className="mt-4 text-2xl font-extrabold">
        {failed ? t('No pudimos confirmar tu correo') : t('Confirmando tu correo…')}
      </h1>
      <p className="mt-2 text-muted">
        {failed ? t('El enlace expiró o ya fue usado. Inicia sesión para solicitar uno nuevo.') : t('Un momento, por favor.')}
      </p>
      {failed && (
        <Button asChild className="mt-6 w-full">
          <Link href={`/auth/iniciar-sesion?registered=1${next === '/' ? '' : `&next=${encodeURIComponent(next)}`}`}>{t('Ir a iniciar sesión')}</Link>
        </Button>
      )}
    </div>
  );
}
