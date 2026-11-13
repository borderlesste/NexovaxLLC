'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

export default function ResetPage() {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(true);
  // E-mailed links carry a one-time recovery token: exchange it for a session.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const tokenHash = q.get('token_hash');
    if (!tokenHash) return setVerifying(false);
    supabase()
      .auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
      .then(({ error }) => {
        if (error) setError('El enlace expiró o ya fue usado. Solicita uno nuevo.');
        window.history.replaceState(null, '', '/auth/restablecer');
      })
      .finally(() => setVerifying(false));
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(pw)) return setError('Mínimo 8 caracteres, con letras y números.');
    if (pw !== pw2) return setError('Las contraseñas no coinciden.');
    setBusy(true);
    const { error } = await supabase().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setError('El enlace expiró o no es válido. Solicita uno nuevo.');
    toast.success('Contraseña actualizada.');
    router.replace('/');
  };
  return (
    <form onSubmit={submit} className="card mx-auto max-w-md rounded-3xl p-8">
      <h1 className="text-3xl font-extrabold">Nueva contraseña</h1>
      <p className="mt-1 text-muted">Crea una contraseña segura para tu cuenta.</p>
      <Field label="Contraseña" required className="mt-6"><Input type="password" icon={<Lock />} value={pw} onChange={(e) => setPw(e.target.value)} className="h-11" /></Field>
      <Field label="Confirmar contraseña" required className="mt-4"><Input type="password" icon={<Lock />} value={pw2} onChange={(e) => setPw2(e.target.value)} className="h-11" /></Field>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Button type="submit" size="lg" className="mt-6 w-full" loading={busy || verifying}>Guardar contraseña</Button>
    </form>
  );
}
