'use client';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { ReturnDetail, RETURN_HREF } from '@/components/returns/returns';

export default function ReturnDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Devoluciones', href: RETURN_HREF.seller }, { label: 'Detalle' }]} title="Detalle de la devolución" />
      <ReturnDetail role="seller" id={id} />
    </div>
  );
}
