'use client';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { countryName, t } from '@/lib/i18n';
import { Spinner } from '@/components/ui/misc';

export const PAYOUT_METHOD_NAMES: Record<string, string> = {
  BANK_ACCOUNT: 'Cuenta bancaria', PAYPAL: 'PayPal', WISE: 'Wise', PAYONEER: 'Payoneer', ZELLE: 'Zelle', SKRILL: 'Skrill', DIGITAL_WALLET: 'Billetera digital',
};

/** Full (decrypted) destination of a seller payout method, for finance to verify it and send the money. Admin only. */
export function PayoutDestination({ accountId }: { accountId: string }) {
  const q = useQuery({ queryKey: ['payout-account-details', accountId], queryFn: () => get<any>(`/admin/payout-accounts/${accountId}/details`), staleTime: 60_000 });
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <p className="text-sm text-red-600">{t('No se pudieron cargar los datos del método.')}</p>;
  const d = q.data;
  const rows: [string, string | null][] = [
    [t('Método'), t(PAYOUT_METHOD_NAMES[d.method] ?? d.method)],
    [t('Titular'), d.holderName],
    [t('Banco'), d.bankName],
    [t('Número de cuenta o IBAN'), d.accountNumber],
    [t('Tipo de cuenta'), d.accountType === 'SAVINGS' ? t('Ahorros') : d.accountType === 'CHECKING' ? t('Corriente') : d.accountType],
    [t('Routing / SWIFT / BIC'), d.routingOrSwift],
    [t('Identificación fiscal del titular'), d.documentId],
    [t('Correo'), d.email],
    [t('Teléfono'), d.phone],
    [t('Moneda'), d.currency],
    [t('País'), d.countryCode ? countryName(d.countryCode) : null],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg bg-surface p-3 text-sm sm:grid-cols-[auto_1fr]" data-payout-destination>
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="select-all break-all font-semibold">{v}</dd></div>
      ))}
    </dl>
  );
}
