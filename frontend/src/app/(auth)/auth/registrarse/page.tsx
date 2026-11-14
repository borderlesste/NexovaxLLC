'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeNextPath } from '@/lib/safe-redirect';
import { BarChart3, Check, Eye, EyeOff, Lock, Mail, Store, User, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { errorMessage, post } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { StorefrontIllustration } from '@/components/layout/auth-illustration';
import { t } from '@/lib/i18n';

function RegisterForm() {
  const { signIn } = useAuth();
  const router = useRouter();
  const sp = useSearchParams();
  const next = safeNextPath(sp.get('next'));
  const [f, setF] = useState({ fullName: '', email: '', password: '', confirm: '' });
  const [terms, setTerms] = useState(false);
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const strong = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(f.password);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!strong) return setError(t('La contraseña debe tener al menos 8 caracteres, con letras y números.'));
    if (f.password !== f.confirm) return setError(t('Las contraseñas no coinciden.'));
    if (!terms) return setError(t('Debes aceptar los términos y la política de privacidad.'));
    setBusy(true);
    try {
      const r = await post('/auth/register', { fullName: f.fullName, email: f.email, password: f.password });
      if (r.confirmed) {
        await signIn(f.email, f.password);
        router.replace(next);
      } else {
        router.replace('/auth/iniciar-sesion?registered=1');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-2">
      <div className="hidden md:block">
        <StorefrontIllustration />
        <h1 className="mt-10 text-4xl font-extrabold leading-tight">{t('Vende, compra y haz crecer tu negocio')}</h1>
        <p className="mt-3 text-lg text-muted">{t('Únete a NEXOVAX, el mercado online donde múltiples vendedores conectan con miles de clientes.')}</p>
        <div className="mt-8 grid grid-cols-3 divide-x divide-line text-center">
          {[[Store, t('Crea tu tienda')], [Users, t('Llega a más clientes')], [BarChart3, t('Haz crecer tus ventas')]].map(([I, lbl]: any) => (
            <div key={lbl} className="px-2"><span className="mx-auto grid size-12 place-items-center rounded-xl bg-brand-50 text-brand-600"><I className="size-6" /></span><p className="mt-2 text-sm font-semibold text-muted">{t(lbl)}</p></div>
          ))}
        </div>
      </div>
      <form onSubmit={submit} className="card rounded-3xl p-8 sm:p-10">
        <h2 className="text-4xl font-extrabold">{t('Crear cuenta')}</h2>
        <p className="mt-1 text-lg text-muted">{t('Únete al marketplace y comienza a comprar o vender hoy mismo.')}</p>
        <div className="mt-6 space-y-4">
          <Field label={t('Nombre completo')} required><Input required icon={<User />} placeholder={t('Ej. Juan Pérez')} value={f.fullName} onChange={set('fullName')} className="h-11" autoComplete="name" /></Field>
          <Field label={t('Correo electrónico')} required><Input required type="email" icon={<Mail />} placeholder={t('Ej. juan@ejemplo.com')} value={f.email} onChange={set('email')} className="h-11" autoComplete="email" /></Field>
          <Field label={t('Contraseña')} required>
            <div className="relative">
              <Input required type={show ? 'text' : 'password'} icon={<Lock />} placeholder={t('Crea una contraseña')} value={f.password} onChange={set('password')} className="h-11 pr-11" autoComplete="new-password" />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-label={t('Mostrar')}>{show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button>
            </div>
            <p className={`mt-1 flex items-center gap-1 text-xs ${strong ? 'text-emerald-600' : 'text-muted'}`}>{strong && <Check className="size-3" />} {t('Mínimo 8 caracteres, con letras y números.')}</p>
          </Field>
          <Field label={t('Confirmar contraseña')} required><Input required type={show ? 'text' : 'password'} icon={<Lock />} placeholder={t('Confirma tu contraseña')} value={f.confirm} onChange={set('confirm')} className="h-11" autoComplete="new-password" /></Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
            <span>{t('Acepto los')}{' '}<Link href="/ayuda#terminos" className="font-semibold text-brand-700 underline">{t('Términos y condiciones')}</Link> {t('y la')}{' '}<Link href="/ayuda#privacidad" className="font-semibold text-brand-700 underline">{t('Política de privacidad')}</Link>.</span>
          </label>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}><Check /> {t('Crear cuenta')}</Button>
          <p className="border-t border-line pt-4 text-center text-sm">{t('¿Ya tienes una cuenta?')}{' '}<Link href="/auth/iniciar-sesion" className="font-semibold text-brand-700">{t('Inicia sesión')}</Link></p>
        </div>
      </form>
    </div>
  );
}

export default function RegisterPage() {
  return <Suspense><RegisterForm /></Suspense>;
}
