'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, Lightbulb, Lock, XCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { isAdminRole, ROLE_SCOPE } from '@/lib/permissions';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Empty, Segmented } from '@/components/ui/misc';
import { GUIDES, type GuideRole } from './content';

/**
 * Guía de uso del panel para el equipo: solo Soporte, Moderador y Administrador.
 * Cada rol ve la guía de sus funciones; el administrador ve la suya y también las de su equipo.
 */
export default function GuidePage() {
  const { me } = useAuth();
  const roles = me?.roles ?? [];
  const available = useMemo<GuideRole[]>(() => {
    if (isAdminRole(roles)) return ['ADMIN', 'SUPPORT', 'MODERATOR'];
    return (['SUPPORT', 'MODERATOR'] as const).filter((r) => roles.includes(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles.join(',')]);
  const [role, setRole] = useState<GuideRole | undefined>(available[0]);
  useEffect(() => {
    if (!role || !available.includes(role)) setRole(available[0]);
  }, [available, role]);

  if (!me) return null;
  if (!available.length || !role) {
    return (
      <div className="card">
        <Empty icon={<Lock />} title={t('No tienes acceso a esta guía')} description={t('La guía del panel es solo para el equipo de Soporte, Moderación y Administración.')}
          action={<Button asChild variant="secondary"><Link href="/cuenta/perfil">{t('Volver a mi cuenta')}</Link></Button>} />
      </div>
    );
  }
  const guide = GUIDES.find((g) => g.role === role)!;
  const scope = role !== 'ADMIN' ? ROLE_SCOPE[role] : undefined;
  const label = (r: GuideRole) => (r === 'ADMIN' ? 'Administrador' : r === 'SUPPORT' ? 'Soporte' : 'Moderador');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold"><BookOpen className="size-6 text-brand-600" /> {t('Guía del equipo')}</h1>
        <p className="mt-1 text-muted">{t('Cómo usar el panel de NEXOVAX según tu rol.')}</p>
      </div>
      {available.length > 1 && (
        <Segmented value={role} onChange={setRole} options={available.map((r) => ({ value: r, label: r === available[0] && isAdminRole(roles) ? t('{role} (tu rol)', { role: t(label(r)) }) : t(label(r)) }))} />
      )}

      <div className="card p-6">
        <h2 className="text-xl font-bold">{t(guide.title)}</h2>
        <p className="mt-2 text-ink/90">{t(guide.summary)}</p>
        {scope && (
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="mb-2 font-bold text-emerald-800">{t('Puedes')}</p>
              <ul className="space-y-1.5 text-sm">{scope.can.map((c) => <li key={c} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {t(c)}</li>)}</ul>
            </div>
            <div className="rounded-xl bg-rose-50 p-4">
              <p className="mb-2 font-bold text-rose-800">{t('No puedes')}</p>
              <ul className="space-y-1.5 text-sm">{scope.cannot.map((c) => <li key={c} className="flex gap-2"><XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" /> {t(c)}</li>)}</ul>
            </div>
          </div>
        )}
        <nav className="mt-5 flex flex-wrap gap-2 text-sm">
          {guide.sections.map((s, i) => (
            <a key={s.id} href={`#${role}-${s.id}`} className="rounded-full border border-line px-3 py-1 font-semibold hover:bg-brand-50">{i + 1}. {t(s.title)}</a>
          ))}
        </nav>
      </div>

      {guide.sections.map((s, i) => (
        <section key={s.id} id={`${role}-${s.id}`} className="card scroll-mt-24 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 className="text-lg font-bold"><span className="mr-2 text-brand-600">{i + 1}.</span>{t(s.title)}</h3>
            {s.href && <Button asChild size="sm" variant="secondary"><Link href={s.href}>{t('Abrir')} <ArrowRight /></Link></Button>}
          </div>
          {s.intro && <p className="mt-2 text-ink/90">{t(s.intro)}</p>}
          {s.steps && (
            <ol className="mt-3 space-y-2">
              {s.steps.map((step, n) => (
                <li key={n} className="flex gap-3 text-sm"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{n + 1}</span><span className="pt-0.5">{t(step)}</span></li>
              ))}
            </ol>
          )}
          {s.tips?.map((tip) => (
            <p key={tip} className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm"><Lightbulb className="size-4 shrink-0 text-amber-600" /> {t(tip)}</p>
          ))}
        </section>
      ))}
    </div>
  );
}
