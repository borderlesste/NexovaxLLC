'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeNextPath } from '@/lib/safe-redirect';
import { Eye, EyeOff, Lock, Mail, ShieldCheck, ShoppingCart, Store } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { errorMessage, post } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { LogoMark } from '@/components/layout/logo';
import { StorefrontIllustration } from '@/components/layout/auth-illustration';
import { t } from '@/lib/i18n';

function LoginForm() {
  const { signIn, session } = useAuth();
  const router = useRouter();
  const sp = useSearchParams();
  const next = safeNextPath(sp.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState(sp.get('registered') === '1');
  const [resending, setResending] = useState(false);
  const resend = async () => {
    if (!email.trim()) return setError(t('Escribe tu correo para reenviar el enlace.'));
    setResending(true);
    try {
      await post('/auth/resend-verification', { email: email.trim() });
      toast.success(t('Si la cuenta existe y no está confirmada, te enviamos un nuevo enlace.'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setResending(false);
    }
  };
  const providers = useQuery({
    queryKey: ['auth-settings'],
    queryFn: async () => {
      const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! } });
      return (await r.json()).external as Record<string, boolean>;
    },
    staleTime: Infinity,
  });
  useEffect(() => {
    if (session) router.replace(next);
  }, [session, next, router]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn(email, password);
      router.replace(next);
    } catch (err: any) {
      setError(err.message);
      if (err?.code === 'EMAIL_NOT_CONFIRMED') setUnverified(true);
    } finally {
      setBusy(false);
    }
  };
  const oauth = (provider: 'google' | 'apple') =>
    supabase().auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}${next}` } });
  const social = providers.data ? (['google', 'apple'] as const).filter((p) => providers.data![p]) : [];
  return (
    <div className="card mx-auto grid max-w-5xl overflow-hidden rounded-3xl md:grid-cols-2">
      <div className="hidden bg-gradient-to-b from-brand-50 to-brand-100/60 p-10 md:block">
        <h1 className="text-4xl font-extrabold leading-tight">{t('Compra y vende en')}{' '}<span className="text-brand-600">{t('NEXOVAX')}</span></h1>
        <p className="mt-4 text-lg text-muted">{t('Un marketplace donde múltiples vendedores ofrecen sus productos en un solo lugar.')}</p>
        <div className="my-8"><StorefrontIllustration /></div>
        <ul className="space-y-4">
          {[[ShoppingCart, t('Amplia variedad de productos'), t('Descubre miles de opciones de diferentes vendedores.')], [Store, t('Vende tus productos'), t('Crea tu tienda y llega a más clientes.')], [ShieldCheck, t('Compras seguras'), t('Transacciones confiables y protegidas.')]].map(([I, lbl, d]: any) => (
            <li key={lbl} className="flex gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-brand-600"><I className="size-5" /></span><span><b className="block">{t(lbl)}</b><span className="text-sm text-muted">{d}</span></span></li>
          ))}
        </ul>
      </div>
      <form onSubmit={submit} className="p-8 sm:p-12">
        <div className="grid size-16 place-items-center rounded-2xl bg-brand-50"><LogoMark className="size-10" /></div>
        <h2 className="mt-6 text-4xl font-extrabold">{t('Iniciar sesión')}</h2>
        <p className="mt-1 text-lg text-muted">{t('Accede a tu cuenta')}</p>
        {sp.get('cuenta') === 'eliminada' && <p className="mt-4 rounded-xl bg-surface p-3 text-sm" data-account-deleted>{t('Tu cuenta fue eliminada. Si quieres volver, puedes crear una cuenta nueva.')}</p>}
        <div className="mt-8 space-y-5">
          <Field label={t('Correo electrónico')} required>
            <Input rule="email" type="email" autoComplete="email" required icon={<Mail />} placeholder={t('Ej. usuario@correo.com')} value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" />
          </Field>
          <Field label={t('Contraseña')} required>
            <div className="relative">
              <Input type={show ? 'text' : 'password'} autoComplete="current-password" required icon={<Lock />} placeholder={t('Ingresa tu contraseña')} value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 pr-11" />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-label={t('Mostrar contraseña')}>{show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button>
            </div>
          </Field>
          <div className="text-right"><Link href="/auth/recuperar-contrasena" className="text-sm font-semibold text-brand-700 hover:underline">{t('¿Olvidaste tu contraseña?')}</Link></div>
          {unverified && (
            <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm">
              <p>{t('Te enviamos un enlace para confirmar tu correo. Confírmalo y luego inicia sesión.')}</p>
              <button type="button" onClick={resend} disabled={resending} className="mt-1 font-semibold text-brand-700 hover:underline disabled:opacity-60">{t('Reenviar enlace de confirmación')}</button>
            </div>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>{t('Iniciar sesión')}</Button>
          {social.length > 0 && (
            <>
              <div className="flex items-center gap-3 text-sm text-muted"><span className="h-px flex-1 bg-line" /> {t('o continúa con')}{' '}<span className="h-px flex-1 bg-line" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                {social.map((p) => (
                  <Button key={p} type="button" variant="secondary" size="lg" onClick={() => oauth(p)}>{t('Continuar con')}{' '}{p === 'google' ? t('Google') : t('Apple')}</Button>
                ))}
              </div>
            </>
          )}
          <p className="pt-2 text-center text-sm text-muted">{t('¿No tienes una cuenta?')}{' '}<Link href={`/auth/registrarse${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-brand-700 underline">{t('Regístrate')}</Link></p>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
