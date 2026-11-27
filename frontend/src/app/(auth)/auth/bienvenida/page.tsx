'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { LogoMark } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { safeNextPath } from '@/lib/safe-redirect';

function WelcomeBadgeOffer() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const badgeHref = `/cuenta/perfil${next === '/' ? '' : `?badgeNext=${encodeURIComponent(next)}`}#welcome-badge`;

  useEffect(() => {
    if (!loading && !session) router.replace(next);
  }, [loading, session, next, router]);

  if (!session) return <PageLoader />;

  return (
    <section className="card mx-auto max-w-lg rounded-3xl px-6 py-9 text-center sm:px-10 sm:py-12" aria-labelledby="welcome-title">
      <LogoMark className="mx-auto size-16" />
      <h1 id="welcome-title" lang="en" className="mt-5 text-balance text-3xl font-black tracking-tight text-brand-950 sm:text-4xl">Welcome to NexovaX!</h1>
      <p lang="en" className="mx-auto mt-3 max-w-sm text-pretty text-base text-muted sm:text-lg">Create your personalized Welcome Badge and celebrate joining our community.</p>
      <div className="mt-7 grid gap-2 sm:flex sm:flex-wrap sm:justify-center">
        <Button asChild size="lg"><Link href={badgeHref} lang="en">Create My Badge</Link></Button>
        <Button asChild size="lg" variant="secondary"><Link href={next}>{t('Continuar sin insignia')}</Link></Button>
      </div>
    </section>
  );
}

export default function WelcomePage() {
  return <Suspense fallback={<PageLoader />}><WelcomeBadgeOffer /></Suspense>;
}
