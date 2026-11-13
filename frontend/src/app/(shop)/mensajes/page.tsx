'use client';
import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { MessagesView } from '@/components/messaging/messages-view';
import { PageLoader } from '@/components/ui/misc';
import { t } from '@/lib/i18n';

export default function MessagesPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !session) router.replace('/auth/iniciar-sesion?next=/mensajes');
  }, [loading, session, router]);
  if (loading || !session) return <PageLoader />;
  return (
    <div className="mx-auto max-w-[1500px] px-4 py-5 lg:px-6">
      <Breadcrumbs items={[{ label: t('Mensajes') }]} />
      <div className="mt-3 flex items-center gap-4 rounded-2xl bg-gradient-to-r from-brand-50 to-brand-100 p-5">
        <div className="grid size-14 place-items-center rounded-xl bg-white text-brand-600 shadow-sm"><MessageSquare className="size-7" /></div>
        <div><h1 className="text-3xl font-extrabold">{t('Mensajes')}</h1><p className="text-muted">{t('Conversa con los vendedores, resuelve tus dudas y gestiona tus compras.')}</p></div>
      </div>
      <div className="mt-4"><Suspense fallback={<PageLoader />}><MessagesView as="customer" /></Suspense></div>
    </div>
  );
}
