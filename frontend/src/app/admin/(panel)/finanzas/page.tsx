'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Check, Download, Landmark, Layers, Percent, Store, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { fmtDate, fmtDateTime, money } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, Empty, PageLoader } from '@/components/ui/misc';
import { Bars, dayLabel } from '@/components/charts/charts';
import { PayoutActions } from '@/components/admin/payout-actions';
import { t } from '@/lib/i18n';

export default function AdminFinancePage() {
  const qc = useQueryClient();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['admin-finance', days], queryFn: () => get(`/admin/finance?days=${days}`) });
  const [confirmFor, setConfirmFor] = useState<any>(null);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <PageLoader />;
  const d = q.data;
  const refresh = () => { q.refetch(); qc.invalidateQueries({ queryKey: ['admin-attention'] }); };
  const confirm = async () => {
    setBusy(true);
    try { await post(`/admin/transfers/${confirmFor.id}/confirm`, { reference: ref }); toast.success(t('Pago confirmado: el pedido fue creado.')); setConfirmFor(null); setRef(''); refresh(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const reject = async (p: any) => {
    if (!window.confirm(t('¿Rechazar el pago {a}? Se liberará el inventario reservado.', { a: p.reference }))) return;
    try { await post(`/admin/transfers/${p.id}/reject`, { reason: t('Transferencia no recibida') }); toast.success(t('Pago rechazado.')); refresh(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const exportCsv = () => {
    const rows = [[t('Día'), t('Comisiones'), t('Pagos a vendedores')], ...d.series.map((s: any) => [s.day, s.commission, s.sellers])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r: any[]) => r.join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `finanzas-${days}d.csv`; a.click();
  };
  const k = d.kpis;
  return (
    <>
      <PageHeader crumbs={[{ label: t('Panel de administración') }, { label: t('Finanzas') }]} title={t('Finanzas del marketplace')} description={t('Resumen financiero general de la plataforma.')}
        actions={<><Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-44"><option value={7}>{t('Últimos 7 días')}</option><option value={30}>{t('Últimos 30 días')}</option><option value={90}>{t('Últimos 90 días')}</option><option value={365}>{t('Último año')}</option></Select><Button variant="secondary" onClick={exportCsv}><Download /> {t('Exportar')}</Button></>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label={t('Ventas totales (GMV)')} value={money(k.gmv)} icon={<Layers />} hint={t('{a} pedidos', { a: k.orders })} />
        <StatCard label={t('Comisiones de la plataforma')} value={money(k.commission)} icon={<Percent />} hint={k.avgCommissionRate ? `(${(k.avgCommissionRate * 100).toFixed(1)} % promedio)` : ''} />
        <StatCard label={t('Pagos a vendedores')} value={money(k.seller_payable)} icon={<Store />} hint={`Liquidado: ${money(k.payoutsPaid)}`} />
        <StatCard label={t('Impuestos recaudados')} value={money(k.tax)} icon={<BarChart3 />} hint={t('Envíos: {a}', { a: money(k.shipping) })} />
        <StatCard label={t('Vendedores activos')} value={k.activeSellers} icon={<User />} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card><CardHeader title={t('Ventas del marketplace')} /><div className="p-4"><Bars data={d.series} xKey="day" stacked xFormatter={dayLabel} bars={[{ key: 'commission', name: 'Comisiones (plataforma)', color: '#0a6cf5' }, { key: 'sellers', name: t('Pagos a vendedores'), color: '#f5901a' }]} /></div></Card>
        <Card>
          <CardHeader title={t('Retiros de vendedores (solicitudes)')} />
          {d.payouts.length ? (
            <table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="px-5 py-2">{t('Vendedor')}</th><th>{t('Monto')}</th><th>{t('Estado')}</th><th>{t('Fecha')}</th><th /></tr></thead>
              <tbody className="divide-y divide-line">{d.payouts.map((p: any) => (
                <tr key={p.id}><td className="px-5 py-2.5 font-semibold">{p.seller.name}</td><td>{money(p.amount)}</td><td><StatusBadge status={p.status} /></td><td className="text-muted">{fmtDate(p.requestedAt)}</td><td className="pr-4"><PayoutActions p={p} onDone={refresh} /></td></tr>
              ))}</tbody></table>
          ) : <Empty title={t('Sin solicitudes de retiro')} />}
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader icon={<Landmark />} title={t('Pagos por transferencia pendientes de validación')} subtitle={t('Confirma al recibir el dinero en la cuenta del marketplace: el pedido se crea y se notifica al vendedor.')} />
        {d.pendingTransfers.length ? (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">{t('Referencia')}</th><th>{t('Cliente')}</th><th>{t('Monto')}</th><th>{t('Creado')}</th><th>{t('Vence')}</th><th /></tr></thead>
            <tbody className="divide-y divide-line">{d.pendingTransfers.map((p: any) => (
              <tr key={p.id}><td className="px-5 py-3 font-bold">{p.reference}</td><td>{p.customer}<span className="block text-xs text-muted">{p.email}</span></td><td className="font-semibold">{money(p.amount)}</td><td className="text-muted">{fmtDateTime(p.createdAt)}</td><td className="text-muted">{fmtDateTime(p.expiresAt)}</td>
                <td className="pr-5 text-right"><span className="flex justify-end gap-1"><Button size="sm" onClick={() => { setConfirmFor(p); setRef(''); }}><Check /> {t('Confirmar')}</Button><Button size="sm" variant="danger" onClick={() => reject(p)}><X /></Button></span></td></tr>
            ))}</tbody></table></div>
        ) : <Empty title={t('No hay transferencias pendientes')} />}
      </Card>
      <Dialog open={!!confirmFor} onOpenChange={(o) => !o && setConfirmFor(null)} title={t('Confirmar transferencia recibida')} description={confirmFor ? `${confirmFor.reference} · ${money(confirmFor.amount)}` : ''}
        footer={<><Button variant="secondary" onClick={() => setConfirmFor(null)}>{t('Cancelar')}</Button><Button onClick={confirm} loading={busy} disabled={!ref.trim()}>{t('Confirmar pago')}</Button></>}>
        <Field label={t('Referencia del banco')} required><Input rule="reference" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('Número de comprobante')} /></Field>
      </Dialog>
    </>
  );
}
