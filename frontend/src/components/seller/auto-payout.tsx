'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, put } from '@/lib/api';
import { t } from '@/lib/i18n';
import { fmtDateTime, money } from '@/lib/utils';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';

const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const RESULT: Record<string, string> = {
  REQUESTED: 'Retiro solicitado',
  SKIPPED_BELOW_MINIMUM: 'Omitido: saldo por debajo del mínimo',
  SKIPPED_OPEN_PAYOUT: 'Omitido: ya había un retiro en curso',
  SKIPPED_ACCOUNT_NOT_VERIFIED: 'Omitido: la cuenta de cobro no está verificada',
  SKIPPED_STORE_INACTIVE: 'Omitido: la tienda no está activa',
};
export const resultLabel = (r?: string | null) => (!r ? '—' : r.startsWith('FAILED') ? t('Falló: {e}', { e: r.slice(8) }) : t(RESULT[r] ?? r));
export const scheduleLabel = (s: { frequency: string; weekday?: number | null; monthday?: number | null }) =>
  s.frequency === 'MONTHLY' ? t('Cada mes, el día {d}', { d: s.monthday ?? 1 }) : s.frequency === 'BIWEEKLY' ? t('Cada 2 semanas, los {d}', { d: t(WEEKDAYS[(s.weekday ?? 1) - 1]).toLowerCase() }) : t('Cada semana, los {d}', { d: t(WEEKDAYS[(s.weekday ?? 1) - 1]).toLowerCase() });

/** Seller: automatic payouts (weekly / every two weeks / monthly) to a verified payout account. */
export function AutoPayoutCard({ accounts }: { accounts: any[] }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payout-schedule'], queryFn: () => get('/seller/payouts/schedule') });
  const d = q.data;
  const usable = accounts.filter((a) => a.status === 'ACTIVE' && a.verificationStatus === 'VERIFIED' && (a.metadata?.currency ?? d?.currency) === d?.currency);
  const [f, setF] = useState({ enabled: false, frequency: 'WEEKLY', weekday: 5, monthday: 1, accountId: '', minimumAmount: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!d) return;
    const s = d.schedule;
    setF({
      enabled: s?.enabled ?? false,
      frequency: s?.frequency ?? 'WEEKLY',
      weekday: s?.weekday ?? 5,
      monthday: s?.monthday ?? 1,
      accountId: s?.accountId ?? usable.find((a) => a.metadata?.is_primary)?.id ?? usable[0]?.id ?? '',
      minimumAmount: s && Number(s.minimumAmount) > 0 ? s.minimumAmount : '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, accounts.length]);
  const save = async (next = f) => {
    if (!next.accountId) return toast.error(t('Agrega y verifica un método de cobro primero.'));
    setBusy(true);
    try {
      const r = await put('/seller/payouts/schedule', {
        enabled: next.enabled, frequency: next.frequency, accountId: next.accountId,
        ...(next.frequency === 'MONTHLY' ? { monthday: Number(next.monthday) } : { weekday: Number(next.weekday) }),
        ...(next.minimumAmount !== '' ? { minimumAmount: Number(next.minimumAmount) } : {}),
      });
      qc.setQueryData(['payout-schedule'], r);
      toast.success(next.enabled ? t('Retiros automáticos activados.') : t('Retiros automáticos desactivados.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!d) return null;
  const s = d.schedule;
  return (
    <Card className="mt-5" data-auto-payout>
      <CardHeader
        icon={<CalendarClock />}
        title={t('Retiros automáticos')}
        subtitle={t('Retiramos tu saldo disponible según la frecuencia que elijas. Finanzas lo aprueba como cualquier retiro.')}
        action={<label className="flex items-center gap-2 text-sm font-semibold">{f.enabled ? t('Activado') : t('Desactivado')} <Switch checked={f.enabled} disabled={busy || !usable.length} onCheckedChange={(v) => { const n = { ...f, enabled: v }; setF(n); save(n); }} /></label>}
      />
      <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('Frecuencia')}>
          <Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} data-auto="frequency">
            <option value="WEEKLY">{t('Semanal')}</option><option value="BIWEEKLY">{t('Cada 2 semanas')}</option><option value="MONTHLY">{t('Mensual')}</option>
          </Select>
        </Field>
        {f.frequency === 'MONTHLY' ? (
          <Field label={t('Día del mes')}><Select value={String(f.monthday)} onChange={(e) => setF({ ...f, monthday: Number(e.target.value) })}>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</Select></Field>
        ) : (
          <Field label={t('Día de la semana')}><Select value={String(f.weekday)} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })} data-auto="weekday">{WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{t(w)}</option>)}</Select></Field>
        )}
        <Field label={t('Cuenta de cobro')}>
          <Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })} disabled={!usable.length}>
            {!usable.length && <option value="">{t('Sin cuentas verificadas')}</option>}
            {usable.map((a) => <option key={a.id} value={a.id}>{a.label}{a.last4 ? ` •••• ${a.last4}` : ''}</option>)}
          </Select>
        </Field>
        <Field label={t('Monto mínimo')} hint={t('Política: {a}', { a: money(d.policyMinimum, d.currency) })}>
          <Input rule="money" value={f.minimumAmount} onChange={(e) => setF({ ...f, minimumAmount: e.target.value })} placeholder={money(d.policyMinimum, d.currency)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4 text-sm">
        <div className="text-muted">
          {!usable.length ? (
            <span>{t('Necesitas un método de cobro verificado.')} <Link href="/vendedor/metodos-cobro" className="font-semibold text-brand-700">{t('Configurar →')}</Link></span>
          ) : s?.enabled ? (
            <span data-auto-next>{scheduleLabel(s)} · {t('Próximo retiro')}: <b className="text-ink">{fmtDateTime(s.nextRunAt)}</b> · {t('Disponible hoy')}: <b className="text-ink">{money(d.available, d.currency)}</b>{s.lastRunAt ? ` · ${t('Último')}: ${resultLabel(s.lastResult)}` : ''}</span>
          ) : (
            <span>{t('Disponible hoy')}: <b className="text-ink">{money(d.available, d.currency)}</b></span>
          )}
        </div>
        <Button size="sm" onClick={() => save()} loading={busy} disabled={!usable.length}>{t('Guardar programación')}</Button>
      </div>
    </Card>
  );
}
