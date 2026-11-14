'use client';
import { t } from '@/lib/i18n';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Building2, Coins, Landmark, Percent, ShoppingCart, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { fmtDate, money, uid } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, Empty, PageLoader, Pills } from '@/components/ui/misc';
import { AreaTrend } from '@/components/charts/charts';
import { AutoPayoutCard } from '@/components/seller/auto-payout';

export default function SellerFinancePage() {
  const qc = useQueryClient();
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<'sales' | 'profit'>('sales');
  const q = useQuery({ queryKey: ['seller-finance', days], queryFn: () => get(`/seller/finance?days=${days}`) });
  const payouts = useQuery({ queryKey: ['seller-payouts'], queryFn: () => get('/seller/payouts') });
  const accounts = useQuery({ queryKey: ['payout-accounts'], queryFn: () => get('/seller/payout-accounts') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ accountId: '', amount: '' });
  const [idem, setIdem] = useState(uid());
  const [busy, setBusy] = useState(false);
  const [payCurrency, setPayCurrency] = useState<string | null>(null);
  if (q.isLoading) return <PageLoader />;
  const d = q.data;
  const cur = payCurrency ?? d.currency;
  const available = cur === d.currency ? d.balances.available : (d.otherBalances ?? []).find((b: any) => b.currency === cur)?.available ?? '0';
  const verified = (accounts.data ?? []).filter((a: any) => a.verificationStatus === 'VERIFIED' && a.status === 'ACTIVE' && (a.metadata?.currency ?? cur) === cur);
  const request = async () => {
    setBusy(true);
    try {
      await post('/seller/payouts', { accountId: f.accountId || verified[0]?.id, amount: Number(f.amount), currency: cur, idempotencyKey: idem });
      toast.success(t('Solicitud de retiro enviada.'));
      setOpen(false);
      setIdem(uid());
      qc.invalidateQueries({ queryKey: ['seller-finance'] });
      qc.invalidateQueries({ queryKey: ['seller-payouts'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (id: string) => {
    try {
      await post(`/seller/payouts/${id}/cancel`);
      toast.success(t('Retiro cancelado.'));
      qc.invalidateQueries({ queryKey: ['seller-payouts'] });
      qc.invalidateQueries({ queryKey: ['seller-finance'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const ICON: Record<string, any> = { SALE: ShoppingCart, COMMISSION: Percent, PAYOUT: Landmark };
  return (
    <>
      <PageHeader crumbs={[{ label: t('Mi tienda') }, { label: t('Finanzas') }]} title={t('Finanzas de mi tienda')} description={t('Consulta tus ventas, ganancias, comisiones y retiros.')}
        actions={<><Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-44"><option value={7}>{t('Últimos 7 días')}</option><option value={30}>{t('Últimos 30 días')}</option><option value={90}>{t('Últimos 90 días')}</option><option value={365}>{t('Último año')}</option></Select>
          <Button onClick={() => { setF({ accountId: verified[0]?.id ?? '', amount: String(Number(d.balances.available)) }); setOpen(true); }} disabled={Number(d.balances.available) <= 0}><Landmark /> {t('Solicitar retiro')}</Button></>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Ventas (brutas)')} value={money(d.period.gross, d.currency)} icon={<ShoppingCart />} hint={t('incluye envío e impuestos')} />
        <StatCard label={t('Comisión de la plataforma')} value={`- ${money(d.period.commission, d.currency)}`} icon={<Box />} hint={d.commissionRate != null ? `(${(d.commissionRate * 100).toFixed(0)} %)` : ''} />
        <StatCard label={t('Ganancia neta')} value={money(d.period.net, d.currency)} icon={<Wallet />} tone="green" hint={t('productos menos comisión')} />
        <StatCard label={t('Saldo disponible')} value={money(d.balances.available, d.currency)} icon={<Coins />} hint={t('Pendiente por entrega: {a}', { a: money(d.balances.pending, d.currency) })} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t('Evolución de ventas')} action={<Pills value={metric} onChange={setMetric} options={[{ value: 'sales', label: t('Ventas') }, { value: 'profit', label: t('Ganancia') }]} />} />
          <div className="p-4"><AreaTrend data={d.series} yKey={metric} /></div>
        </Card>
        <Card>
          <CardHeader title={t('Movimientos recientes')} />
          {d.movements.length ? (
            <table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="px-5 py-2">{t('Fecha')}</th><th>{t('Concepto')}</th><th className="pr-5 text-right">{t('Monto')}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.movements.map((m: any, i: number) => { const I = ICON[m.kind] ?? Coins; return (
                  <tr key={i}><td className="px-5 py-2.5 text-muted">{fmtDate(m.at)}</td><td><span className="flex items-center gap-2"><I className="size-4 text-brand-600" /> {m.concept}</span></td>
                    <td className={`pr-5 text-right font-semibold ${Number(m.amount) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{Number(m.amount) >= 0 ? '+ ' : '- '}{money(Math.abs(Number(m.amount)), m.currency ?? d.currency)}</td></tr>
                ); })}
              </tbody></table>
          ) : <Empty title={t('Sin movimientos aún')} />}
        </Card>
      </div>
      <AutoPayoutCard accounts={accounts.data ?? []} />
      <Card className="mt-5">
        <CardHeader title={t('Mis retiros')} subtitle={d.payoutPolicy ? t('Mínimo por retiro: {a} · Aprobación {b}', { a: money(d.payoutPolicy.minimum, d.currency), b: d.payoutPolicy.approvalMode === 'MANUAL' ? t('manual por finanzas') : t('automática') }) : undefined} action={<Link href="/vendedor/metodos-cobro" className="text-sm font-semibold text-brand-700">{t('Métodos de cobro →')}</Link>} />
        {payouts.data?.length ? (
          <table className="w-full text-sm"><thead className="bg-surface text-left text-xs text-muted"><tr><th className="px-5 py-2">{t('Retiro')}</th><th>{t('Destino')}</th><th>{t('Monto')}</th><th>{t('Solicitado')}</th><th>{t('Estado')}</th><th /></tr></thead>
            <tbody className="divide-y divide-line">
              {payouts.data.map((p: any) => (
                <tr key={p.id}><td className="px-5 py-3 font-bold">{p.number}</td><td className="text-muted"><span className="flex items-center gap-1"><Building2 className="size-4" /> {p.accountLabel} ****{p.accountLast4}</span></td>
                  <td className="font-semibold">{money(p.amount, p.currency)}</td><td className="text-muted">{fmtDate(p.requestedAt)}</td><td><StatusBadge status={p.status} /></td>
                  <td className="pr-5 text-right">{['REQUESTED', 'APPROVAL_REQUIRED', 'APPROVED'].includes(p.status) && <Button size="sm" variant="ghost" onClick={() => cancel(p.id)}><X /> {t('Cancelar')}</Button>}</td></tr>
              ))}
            </tbody></table>
        ) : <Empty icon={<Landmark />} title={t('No has solicitado retiros')} />}
      </Card>
      {(d.otherBalances ?? []).length > 0 && (
        <Card className="mt-5 p-5 text-sm">
          <p className="font-bold">{t('Saldos en otras monedas')}</p>
          <p className="text-muted">{t('Ventas registradas antes de un cambio de moneda del marketplace.')}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {d.otherBalances.map((b: any) => (
              <div key={b.currency} className="rounded-xl border border-line px-4 py-3">
                <p className="text-xs text-muted">{b.currency}</p>
                <p className="font-bold">{money(b.available, b.currency)} <span className="text-xs font-normal text-muted">{t('disponible')}</span></p>
                {Number(b.pending) > 0 && <p className="text-xs text-muted">{t('Pendiente')}: {money(b.pending, b.currency)}</p>}
                {Number(b.available) > 0 && <Button size="sm" variant="outline" className="mt-2" onClick={() => { setPayCurrency(b.currency); setOpen(true); }}>{t('Retirar')}</Button>}
              </div>
            ))}
          </div>
        </Card>
      )}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPayCurrency(null); }} title={t('Solicitar retiro')} description={`${t('Saldo disponible')}: ${money(available, cur)}`}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>{t('Cancelar')}</Button><Button onClick={request} loading={busy} disabled={!f.accountId || !(Number(f.amount) > 0)}>{t('Solicitar')}</Button></>}>
        {verified.length ? (
          <div className="grid gap-4">
            <Field label={t('Cuenta de destino')} required><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{verified.map((a: any) => <option key={a.id} value={a.id}>{a.label} ****{a.last4} · {a.metadata?.currency}</option>)}</Select></Field>
            <Field label={`${t('Monto')} (${cur})`} required><Input rule="money" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            {d.payoutPolicy && <p className="text-xs text-muted">{t('Monto mínimo:')}{' '}{money(d.payoutPolicy.minimum, d.currency)}{t('. El equipo de finanzas aprobará y ejecutará la transferencia.')}</p>}
          </div>
        ) : (
          <Empty icon={<Landmark />} title={t('Necesitas un método de cobro verificado')} description={t('Registra tu cuenta bancaria; el equipo del marketplace la verificará.')} action={<Button asChild><Link href="/vendedor/metodos-cobro">{t('Agregar método de cobro')}</Link></Button>} />
        )}
      </Dialog>
    </>
  );
}
