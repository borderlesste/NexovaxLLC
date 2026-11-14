'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CalendarClock, Play } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { t } from '@/lib/i18n';
import { fmtDateTime, money } from '@/lib/utils';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/misc';
import { resultLabel, scheduleLabel } from '@/components/seller/auto-payout';

/** Finance: automatic payouts configured by sellers, with the amount they would request today. */
export function ScheduledPayouts({ onRun }: { onRun?: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['scheduled-payouts'], queryFn: () => get<any[]>('/admin/payouts/scheduled') });
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (sellerId: string) => {
    setBusy(sellerId);
    try {
      const r = await post(`/admin/payouts/scheduled/${sellerId}/run`);
      qc.setQueryData(['scheduled-payouts'], r.upcoming);
      toast[r.created ? 'success' : 'info'](r.created ? t('Retiro solicitado. Apruébalo en la lista de payouts.') : resultLabel(r.upcoming.find((x: any) => x.sellerId === sellerId)?.lastResult));
      onRun?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="mt-5" data-scheduled-payouts>
      <CardHeader icon={<CalendarClock />} title={t('Retiros programados')} subtitle={t('Vendedores con retiros automáticos y el monto que se solicitaría hoy')} />
      {!q.data?.length ? (
        <Empty title={t('Ningún vendedor tiene retiros automáticos')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <tr><th className="px-5 py-3">{t('Tienda')}</th><th>{t('Frecuencia')}</th><th>{t('Próximo retiro')}</th><th>{t('Cuenta')}</th><th className="text-right">{t('Disponible hoy')}</th><th>{t('Último resultado')}</th><th className="pr-5" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.map((r) => (
                <tr key={r.sellerId + r.currency}>
                  <td className="px-5 py-3 font-semibold">{r.store}</td>
                  <td>{scheduleLabel(r)}</td>
                  <td>{fmtDateTime(r.nextRunAt)}</td>
                  <td>{r.account.label}{r.account.last4 ? ` •••• ${r.account.last4}` : ''} {!r.account.verified && <Badge tone="amber">{t('Sin verificar')}</Badge>}</td>
                  <td className="text-right font-semibold">{money(r.estimated, r.currency)}{Number(r.minimum) > 0 && <span className="block text-[11px] font-normal text-muted">{t('Mínimo')} {money(r.minimum, r.currency)}</span>}</td>
                  <td className="text-xs text-muted">{r.lastRunAt ? `${resultLabel(r.lastResult)} · ${fmtDateTime(r.lastRunAt)}` : '—'}</td>
                  <td className="pr-5 text-right"><Button size="sm" variant="outline" loading={busy === r.sellerId} onClick={() => run(r.sellerId)}><Play /> {t('Ejecutar ahora')}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
