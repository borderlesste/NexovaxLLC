'use client';
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { MFA_REQUIRED_EVENT } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/misc';

/**
 * Two-step verification with an authenticator app (Supabase MFA, TOTP). The second factor lives in
 * Supabase Auth: a verified code raises the session to aal2, which the API checks on team routes and
 * on store payouts (Admin → Configuración → Opciones).
 */
type Factor = { id: string; friendly_name?: string | null; status: string; created_at: string };

async function verifiedFactors(): Promise<Factor[]> {
  const { data, error } = await supabase().auth.mfa.listFactors();
  if (error) throw error;
  return (data?.totp ?? []) as Factor[];
}

const cleanCode = (v: string) => v.replace(/\D/g, '').slice(0, 6);

function mfaError(e: any) {
  const m = String(e?.message ?? '');
  if (/invalid|expired|code/i.test(m)) return t('El código no es correcto o ya venció. Escribe el código que muestra ahora tu app.');
  return m || t('Ocurrió un error inesperado.');
}

/** Code prompt for an enrolled account (raises the session to aal2). */
function VerifyStep({ factorId, onDone }: { factorId: string; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw error;
      onDone();
    } catch (err) {
      toast.error(mfaError(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3" data-mfa-verify>
      <Field label={t('Código de 6 dígitos')}>
        <Input inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(cleanCode(e.target.value))} placeholder="123456" />
      </Field>
      <Button type="submit" loading={busy} disabled={code.length !== 6}><KeyRound /> {t('Verificar')}</Button>
    </form>
  );
}

/** Enrollment: QR code + secret, confirmed with the first code from the app. */
function EnrollStep({ onDone }: { onDone: () => void }) {
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const mfa = supabase().auth.mfa;
      // A setup left half-way (QR shown, never confirmed) would block a new one with the same name.
      const { data: all } = await mfa.listFactors();
      for (const f of (all?.all ?? []) as Factor[]) if (f.status !== 'verified') await mfa.unenroll({ factorId: f.id });
      const { data, error } = await mfa.enroll({ factorType: 'totp', friendlyName: `NEXOVAX ${new Date().toISOString().slice(0, 10)}` });
      if (error) throw error;
      setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (err) {
      toast.error(mfaError(err));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!enroll) return;
    setBusy(true);
    try {
      const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: enroll.id, code });
      if (error) throw error;
      toast.success(t('Verificación en dos pasos activada.'));
      onDone();
    } catch (err) {
      toast.error(mfaError(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  if (!enroll)
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('Usa una app de autenticación como Google Authenticator, Microsoft Authenticator o 1Password. Cada vez que inicies sesión te pediremos el código de 6 dígitos que genera.')}</p>
        <Button onClick={start} loading={busy} data-mfa-start><Smartphone /> {t('Activar verificación en dos pasos')}</Button>
      </div>
    );
  return (
    <form onSubmit={confirm} className="space-y-3" data-mfa-enroll>
      <p className="text-sm text-muted">{t('1. Escanea este código QR con tu app de autenticación.')}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={enroll.qr} alt={t('Código QR para la app de autenticación')} className="size-44 rounded-xl border border-line bg-white p-2" />
      <p className="text-xs text-muted">{t('¿No puedes escanearlo? Escribe esta clave en la app:')} <code className="break-all font-mono text-ink">{enroll.secret}</code></p>
      <p className="text-sm text-muted">{t('2. Escribe el código de 6 dígitos que muestra la app.')}</p>
      <Field label={t('Código de 6 dígitos')}>
        <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(cleanCode(e.target.value))} placeholder="123456" />
      </Field>
      <Button type="submit" loading={busy} disabled={code.length !== 6}><ShieldCheck /> {t('Confirmar y activar')}</Button>
    </form>
  );
}

/**
 * Global gate: asks for the code right after sign-in on an account that has the second factor, and
 * opens when the API answers MFA_REQUIRED (team panel, store payouts) to verify or set it up.
 */
export function MfaGate() {
  const { session, signOut } = useAuth();
  const qc = useQueryClient();
  const [state, setState] = useState<{ open: boolean; factorId: string | null; reason: 'login' | 'required' }>({ open: false, factorId: null, reason: 'login' });

  const check = useCallback(async (reason: 'login' | 'required') => {
    const { data } = await supabase().auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel === 'aal2') return false;
    // Accounts without a second factor stay at nextLevel aal1: no extra request on every page load.
    if (reason === 'login' && data?.nextLevel !== 'aal2') return false;
    const factors = await verifiedFactors().catch(() => [] as Factor[]);
    if (reason === 'login' && !(data?.nextLevel === 'aal2' && factors.length)) return false;
    setState({ open: true, factorId: factors[0]?.id ?? null, reason });
    return true;
  }, []);

  useEffect(() => {
    if (!session) { setState((s) => ({ ...s, open: false })); return; }
    check('login').catch(() => undefined);
  }, [session?.user.id, check]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onRequired = () => { check('required').catch(() => undefined); };
    window.addEventListener(MFA_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(MFA_REQUIRED_EVENT, onRequired);
  }, [check]);

  const done = async () => {
    setState((s) => ({ ...s, open: false }));
    await supabase().auth.refreshSession().catch(() => undefined);
    qc.invalidateQueries();
  };
  if (!state.open || !session) return null;
  const enrolled = !!state.factorId;
  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o && state.reason === 'required') setState((s) => ({ ...s, open: false })); }}
      title={enrolled ? t('Verificación en dos pasos') : t('Activa la verificación en dos pasos')}
      description={enrolled
        ? t('Escribe el código de 6 dígitos de tu app de autenticación para continuar.')
        : t('Esta sección protege dinero o datos de otras personas: necesita un código de tu app de autenticación además de la contraseña.')}
      footer={<Button variant="ghost" onClick={signOut}>{t('Cerrar sesión')}</Button>}
    >
      <div data-mfa-gate>{enrolled ? <VerifyStep factorId={state.factorId!} onDone={done} /> : <EnrollStep onDone={done} />}</div>
    </Dialog>
  );
}

/** Card for Cuenta → Seguridad: status, activation and removal of the authenticator app. */
export function MfaCard() {
  const qc = useQueryClient();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const load = useCallback(() => verifiedFactors().then(setFactors).catch(() => setFactors([])), []);
  useEffect(() => { load(); }, [load]);
  const remove = async (id: string) => {
    if (!window.confirm(t('¿Quitar la verificación en dos pasos? Tu cuenta quedará protegida solo con la contraseña.'))) return;
    setRemoving(id);
    try {
      const { data } = await supabase().auth.mfa.getAuthenticatorAssuranceLevel();
      // Removing a factor needs a session that already passed it.
      if (data?.currentLevel !== 'aal2') {
        window.dispatchEvent(new Event(MFA_REQUIRED_EVENT));
        return;
      }
      const { error } = await supabase().auth.mfa.unenroll({ factorId: id });
      if (error) throw error;
      await supabase().auth.refreshSession().catch(() => undefined);
      toast.success(t('Verificación en dos pasos desactivada.'));
      await load();
      qc.invalidateQueries();
    } catch (err) {
      toast.error(mfaError(err));
    } finally {
      setRemoving(null);
    }
  };
  return (
    <div className="card p-6" data-mfa-card>
      <h2 className="flex items-center gap-2 text-lg font-bold"><Smartphone className="size-5 text-brand-600" /> {t('Verificación en dos pasos')}</h2>
      {factors == null ? null : factors.length ? (
        <div className="mt-3 space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><ShieldCheck className="size-4" /> {t('Activada con una app de autenticación.')}</p>
          {factors.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm">
              <span>{f.friendly_name || t('App de autenticación')}</span>
              <Button size="sm" variant="danger" loading={removing === f.id} onClick={() => remove(f.id)}><Trash2 /> {t('Quitar')}</Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3"><EnrollStep onDone={() => { load(); qc.invalidateQueries(); }} /></div>
      )}
    </div>
  );
}
