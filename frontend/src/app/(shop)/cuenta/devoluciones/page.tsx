'use client';
import { ReturnsList } from '@/components/returns/returns';
import { t } from '@/lib/i18n';

export default function MyReturnsPage() {
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t('Mis devoluciones')}</h1>
      <p className="mb-6 text-muted">{t('Solicitudes de devolución y reembolsos de tus compras.')}</p>
      <ReturnsList role="customer" />
    </div>
  );
}
