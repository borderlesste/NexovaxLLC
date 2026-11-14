'use client';
import { Suspense } from 'react';
import { MessagesView } from '@/components/messaging/messages-view';
import { PageLoader } from '@/components/ui/misc';
import { t } from '@/lib/i18n';

export default function AccountMessagesPage() {
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t('Mensajes')}</h1>
      <p className="mb-5 text-muted">{t('Conversa con los vendedores, resuelve tus dudas y gestiona tus compras.')}</p>
      <Suspense fallback={<PageLoader />}><MessagesView as="customer" compact /></Suspense>
    </div>
  );
}
