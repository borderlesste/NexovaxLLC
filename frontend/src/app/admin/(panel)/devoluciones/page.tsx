'use client';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { ReturnsList } from '@/components/returns/returns';
import { MarketplaceReturnPolicy } from '@/components/returns/return-policy';

export default function ReturnsPage() {
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Administración' }, { label: 'Devoluciones' }]} title="Devoluciones" description="Todas las devoluciones del marketplace y los reembolsos pendientes." />
      <MarketplaceReturnPolicy />
      <ReturnsList role="staff" />
    </div>
  );
}
