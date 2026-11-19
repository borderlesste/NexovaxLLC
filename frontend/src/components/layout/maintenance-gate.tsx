'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { PublicConfig } from '@/lib/config';
import { t } from '@/lib/i18n';
import { Logo } from '@/components/layout/logo';

/** Lottie animation made in LottieFiles Creator (public/animations/mantenimiento.json). */
function GearsAnimation() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let anim: { destroy: () => void } | undefined;
    let cancelled = false;
    import('lottie-web/build/player/lottie_light').then(({ default: lottie }) => {
      if (cancelled || !box.current) return;
      anim = lottie.loadAnimation({ container: box.current, renderer: 'svg', loop: true, autoplay: true, path: '/animations/mantenimiento.json' });
    });
    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, []);
  return <div ref={box} className="mx-auto size-56 sm:size-64" aria-hidden />;
}

/**
 * Maintenance mode: everyone except administrators sees this screen instead of the site.
 * Sign-in stays reachable so an admin can log in. The API enforces the same rule (MaintenanceGuard).
 */
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const { isAdmin, loading } = useAuth();
  const cfg = useQuery({ queryKey: ['public-config'], queryFn: () => get<PublicConfig>('/config/public'), staleTime: 30_000, refetchInterval: 60_000 }).data;
  if (!cfg?.maintenance || isAdmin || pathname.startsWith('/auth')) return <>{children}</>;
  if (loading) return null;
  return (
    <main className="grid min-h-dvh place-items-center bg-gradient-to-br from-surface via-white to-brand-50 px-4 py-10" data-maintenance>
      <div className="w-full max-w-lg text-center">
        <div className="mb-2 flex justify-center"><Logo /></div>
        <GearsAnimation />
        <h1 className="text-3xl font-extrabold">{t('Estamos en mantenimiento')}</h1>
        <p className="mt-3 text-muted">{t('Estamos mejorando NEXOVAX para ti. Volveremos en breve; esta página se actualizará sola cuando terminemos.')}</p>
        {cfg.supportEmail && <p className="mt-4 text-sm text-muted">{t('¿Necesitas ayuda urgente? Escríbenos a')}{' '}<a href={`mailto:${cfg.supportEmail}`} className="font-semibold text-brand-700">{cfg.supportEmail}</a></p>}
        <Link href="/auth/iniciar-sesion" className="mt-8 inline-block text-xs text-muted underline">{t('Acceso para administradores')}</Link>
      </div>
    </main>
  );
}
