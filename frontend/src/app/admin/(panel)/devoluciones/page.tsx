'use client';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { ReturnsList } from '@/components/returns/returns';

export default function ReturnsPage() {
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Administración' }, { label: 'Devoluciones' }]} title="Devoluciones" description="Todas las devoluciones del marketplace y los reembolsos pendientes." />
      <ReturnsList role="staff" />
    </div>
  );
}
