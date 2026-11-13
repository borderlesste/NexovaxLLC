'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Lock, Mail, ShieldCheck, ShoppingCart, Store } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { LogoMark } from '@/components/layout/logo';
import { StorefrontIllustration } from '@/components/layout/auth-illustration';

function LoginForm() {
  const { signIn, session } = useAuth();
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get('next') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
        <h1 className="text-4xl font-extrabold leading-tight">Compra y vende en <span className="text-brand-600">RD Marketplace Multivendedor</span></h1>
        <p className="mt-4 text-lg text-muted">Un marketplace donde múltiples vendedores ofrecen sus productos en un solo lugar.</p>
        <div className="my-8"><StorefrontIllustration /></div>
        <ul className="space-y-4">
          {[[ShoppingCart, 'Amplia variedad de productos', 'Descubre miles de opciones de diferentes vendedores.'], [Store, 'Vende tus productos', 'Crea tu tienda y llega a más clientes.'], [ShieldCheck, 'Compras seguras', 'Transacciones confiables y protegidas.']].map(([I, t, d]: any) => (
            <li key={t} className="flex gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-brand-600"><I className="size-5" /></span><span><b className="block">{t}</b><span className="text-sm text-muted">{d}</span></span></li>
          ))}
        </ul>
      </div>
      <form onSubmit={submit} className="p-8 sm:p-12">
        <div className="grid size-16 place-items-center rounded-2xl bg-brand-50"><LogoMark className="size-10" /></div>
        <h2 className="mt-6 text-4xl font-extrabold">Iniciar sesión</h2>
        <p className="mt-1 text-lg text-muted">Accede a tu cuenta</p>
        <div className="mt-8 space-y-5">
          <Field label="Correo electrónico" required>
            <Input type="email" autoComplete="email" required icon={<Mail />} placeholder="Ej. usuario@correo.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" />
          </Field>
          <Field label="Contraseña" required>
            <div className="relative">
              <Input type={show ? 'text' : 'password'} autoComplete="current-password" required icon={<Lock />} placeholder="Ingresa tu contraseña" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 pr-11" />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-label="Mostrar contraseña">{show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button>
            </div>
          </Field>
          <div className="text-right"><Link href="/auth/recuperar-contrasena" className="text-sm font-semibold text-brand-700 hover:underline">¿Olvidaste tu contraseña?</Link></div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>Iniciar sesión</Button>
          {social.length > 0 && (
            <>
              <div className="flex items-center gap-3 text-sm text-muted"><span className="h-px flex-1 bg-line" /> o continúa con <span className="h-px flex-1 bg-line" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                {social.map((p) => (
                  <Button key={p} type="button" variant="secondary" size="lg" onClick={() => oauth(p)}>Continuar con {p === 'google' ? 'Google' : 'Apple'}</Button>
                ))}
              </div>
            </>
          )}
          <p className="pt-2 text-center text-sm text-muted">¿No tienes una cuenta? <Link href={`/auth/registrarse${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-brand-700 underline">Regístrate</Link></p>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
