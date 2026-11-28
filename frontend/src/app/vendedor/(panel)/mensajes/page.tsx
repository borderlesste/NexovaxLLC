'use client';
import { Suspense } from 'react';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { MessagesView } from '@/components/messaging/messages-view';
import { PageLoader } from '@/components/ui/misc';
import Link from 'next/link';
import { MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

export default function SellerMessagesPage() {
  return (
    <>
      <PageHeader crumbs={[{ label: 'Mi tienda' }, { label: 'Mensajes' }]} title="Mensajes" description="Responde las consultas de tus clientes sobre productos y pedidos."
        actions={<Button variant="outline" asChild><Link href="/vendedor/mensajes/respuestas"><MessageSquareText /> {t('Respuestas rápidas')}</Link></Button>} />
      <Suspense fallback={<PageLoader />}><MessagesView as="seller" /></Suspense>
    </>
  );
}
