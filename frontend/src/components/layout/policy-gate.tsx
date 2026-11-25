'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/misc';

type Pending = { code: string; slug: string; versionId: string; version: number; title: string; text: string; sellerId?: string; store?: string };

/**
 * Accounts that haven't accepted the current Terms / Privacy policy (a new version was published,
 * or the account was created without the sign-up form) accept them here before going on.
 */
export function PolicyGate() {
  const { session, me } = useAuth();
  const path = usePathname();
  const qc = useQueryClient();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['policies-pending', me?.id], queryFn: () => get<Pending[]>('/me/policies/pending'), enabled: !!session && !!me, staleTime: 5 * 60_000 });
  const pending = q.data ?? [];
  if (!pending.length || path?.startsWith('/auth/') || path?.startsWith('/ayuda')) return null;
  const accept = async () => {
    setBusy(true);
    try {
      await post('/me/policies/accept', { versionIds: pending.map((p) => p.versionId) });
      await qc.invalidateQueries({ queryKey: ['policies-pending'] });
      toast.success(t('Gracias. Aceptaste las políticas vigentes.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={() => undefined} size="lg" title={t('Actualizamos nuestras políticas')} description={t('Para seguir usando NEXOVAX, revisa y acepta las versiones vigentes.')}
      footer={<Button loading={busy} disabled={!checked} onClick={accept} data-policy-accept><ShieldCheck /> {t('Aceptar y continuar')}</Button>}>
      <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1" data-policy-gate>
        {pending.map((p) => (
          <section key={`${p.versionId}:${p.sellerId ?? ''}`} className="rounded-xl border border-line p-4">
            <p className="font-bold">{p.title}{p.store ? ` · ${p.store}` : ''} <span className="text-xs font-normal text-muted">· {t('versión {n}', { n: p.version })}</span></p>
            <p className="mt-2 whitespace-pre-line text-sm text-muted">{p.text}</p>
            <Link href={`/${p.slug}`} className="mt-2 inline-block text-xs font-semibold text-brand-700 hover:underline">{t('Leer el documento completo')}</Link>
          </section>
        ))}
      </div>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" data-policy-check />
        <span>{t('He leído y acepto estas políticas.')}</span>
      </label>
    </Dialog>
  );
}
