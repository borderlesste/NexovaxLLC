'use client';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { ReturnsList } from '@/components/returns/returns';
import { MarketplaceReturnPolicy } from '@/components/returns/return-policy';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';

export default function ReturnsPage() {
  const { can } = useAuth();
  return (
    <div>
      <PageHeader crumbs={[{ label: t('Administración') }, { label: t('Devoluciones') }]} title={t('Devoluciones')} description={can('returns.refund') ? t('Todas las devoluciones del marketplace y los reembolsos pendientes.') : t('Revisa, recibe e inspecciona las devoluciones. Los reembolsos los emite un administrador.')} />
      {can('returns.policy') && <MarketplaceReturnPolicy />}
      <ReturnsList role="staff" />
    </div>
  );
}
