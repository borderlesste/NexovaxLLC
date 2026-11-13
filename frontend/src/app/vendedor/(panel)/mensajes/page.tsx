import { Suspense } from 'react';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { MessagesView } from '@/components/messaging/messages-view';
import { PageLoader } from '@/components/ui/misc';

export default function SellerMessagesPage() {
  return (
    <>
      <PageHeader crumbs={[{ label: 'Mi tienda' }, { label: 'Mensajes' }]} title="Mensajes" description="Responde las consultas de tus clientes sobre productos y pedidos." />
      <Suspense fallback={<PageLoader />}><MessagesView as="seller" /></Suspense>
    </>
  );
}
