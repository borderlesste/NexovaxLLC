'use client';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { ReturnsList } from '@/components/returns/returns';

export default function ReturnsPage() {
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Panel' }, { label: 'Devoluciones' }]} title="Devoluciones" description="Revisa, recibe e inspecciona las devoluciones de tus clientes." />
      <ReturnsList role="seller" />
    </div>
  );
}
