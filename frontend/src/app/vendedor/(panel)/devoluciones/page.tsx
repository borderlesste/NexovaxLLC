'use client';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { ReturnsList } from '@/components/returns/returns';
import { StoreReturnPolicy } from '@/components/returns/return-policy';

export default function ReturnsPage() {
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Panel' }, { label: 'Devoluciones' }]} title="Devoluciones" description="Revisa, recibe e inspecciona las devoluciones de tus clientes." />
      <StoreReturnPolicy />
      <ReturnsList role="seller" />
    </div>
  );
}
