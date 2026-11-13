'use client';
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
  if (q.isLoading) return <PageLoader />;
  const d = q.data;
  const verified = (accounts.data ?? []).filter((a: any) => a.verificationStatus === 'VERIFIED' && a.status === 'ACTIVE');
  const request = async () => {
    setBusy(true);
    try {
      await post('/seller/payouts', { accountId: f.accountId, amount: Number(f.amount), idempotencyKey: idem });
      toast.success('Solicitud de retiro enviada.');
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
      toast.success('Retiro cancelado.');
      qc.invalidateQueries({ queryKey: ['seller-payouts'] });
      qc.invalidateQueries({ queryKey: ['seller-finance'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const ICON: Record<string, any> = { SALE: ShoppingCart, COMMISSION: Percent, PAYOUT: Landmark };
  return (
    <>
      <PageHeader crumbs={[{ label: 'Mi tienda' }, { label: 'Finanzas' }]} title="Finanzas de mi tienda" description="Consulta tus ventas, ganancias, comisiones y retiros."
        actions={<><Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-44"><option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option><option value={365}>Último año</option></Select>
          <Button onClick={() => { setF({ accountId: verified[0]?.id ?? '', amount: String(Number(d.balances.available)) }); setOpen(true); }} disabled={Number(d.balances.available) <= 0}><Landmark /> Solicitar retiro</Button></>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ventas (brutas)" value={money(d.period.gross)} icon={<ShoppingCart />} hint="incluye envío e ITBIS" />
        <StatCard label="Comisión de la plataforma" value={`- ${money(d.period.commission)}`} icon={<Box />} hint={d.commissionRate != null ? `(${(d.commissionRate * 100).toFixed(0)} %)` : ''} />
        <StatCard label="Ganancia neta" value={money(d.period.net)} icon={<Wallet />} tone="green" hint="productos menos comisión" />
        <StatCard label="Saldo disponible" value={money(d.balances.available)} icon={<Coins />} hint={`Pendiente por entrega: ${money(d.balances.pending)}`} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Evolución de ventas" action={<Pills value={metric} onChange={setMetric} options={[{ value: 'sales', label: 'Ventas' }, { value: 'profit', label: 'Ganancia' }]} />} />
          <div className="p-4"><AreaTrend data={d.series} yKey={metric} /></div>
        </Card>
        <Card>
          <CardHeader title="Movimientos recientes" />
          {d.movements.length ? (
            <table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="px-5 py-2">Fecha</th><th>Concepto</th><th className="pr-5 text-right">Monto</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.movements.map((m: any, i: number) => { const I = ICON[m.kind] ?? Coins; return (
                  <tr key={i}><td className="px-5 py-2.5 text-muted">{fmtDate(m.at)}</td><td><span className="flex items-center gap-2"><I className="size-4 text-brand-600" /> {m.concept}</span></td>
                    <td className={`pr-5 text-right font-semibold ${Number(m.amount) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{Number(m.amount) >= 0 ? '+ ' : '- '}{money(Math.abs(Number(m.amount)))}</td></tr>
                ); })}
              </tbody></table>
          ) : <Empty title="Sin movimientos aún" />}
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader title="Mis retiros" subtitle={d.payoutPolicy ? `Mínimo por retiro: ${money(d.payoutPolicy.minimum)} · Aprobación ${d.payoutPolicy.approvalMode === 'MANUAL' ? 'manual por finanzas' : 'automática'}` : undefined} action={<Link href="/vendedor/metodos-cobro" className="text-sm font-semibold text-brand-700">Métodos de cobro →</Link>} />
        {payouts.data?.length ? (
          <table className="w-full text-sm"><thead className="bg-surface text-left text-xs text-muted"><tr><th className="px-5 py-2">Retiro</th><th>Destino</th><th>Monto</th><th>Solicitado</th><th>Estado</th><th /></tr></thead>
            <tbody className="divide-y divide-line">
              {payouts.data.map((p: any) => (
                <tr key={p.id}><td className="px-5 py-3 font-bold">{p.number}</td><td className="text-muted"><span className="flex items-center gap-1"><Building2 className="size-4" /> {p.accountLabel} ****{p.accountLast4}</span></td>
                  <td className="font-semibold">{money(p.amount)}</td><td className="text-muted">{fmtDate(p.requestedAt)}</td><td><StatusBadge status={p.status} /></td>
                  <td className="pr-5 text-right">{['REQUESTED', 'APPROVAL_REQUIRED', 'APPROVED'].includes(p.status) && <Button size="sm" variant="ghost" onClick={() => cancel(p.id)}><X /> Cancelar</Button>}</td></tr>
              ))}
            </tbody></table>
        ) : <Empty icon={<Landmark />} title="No has solicitado retiros" />}
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title="Solicitar retiro" description={`Saldo disponible: ${money(d.balances.available)}`}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={request} loading={busy} disabled={!f.accountId || !(Number(f.amount) > 0)}>Solicitar</Button></>}>
        {verified.length ? (
          <div className="grid gap-4">
            <Field label="Cuenta de destino" required><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{verified.map((a: any) => <option key={a.id} value={a.id}>{a.label} ****{a.last4}</option>)}</Select></Field>
            <Field label="Monto (RD$)" required><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            {d.payoutPolicy && <p className="text-xs text-muted">Monto mínimo: {money(d.payoutPolicy.minimum)}. El equipo de finanzas aprobará y ejecutará la transferencia.</p>}
          </div>
        ) : (
          <Empty icon={<Landmark />} title="Necesitas un método de cobro verificado" description="Registra tu cuenta bancaria; el equipo del marketplace la verificará." action={<Button asChild><Link href="/vendedor/metodos-cobro">Agregar método de cobro</Link></Button>} />
        )}
      </Dialog>
    </>
  );
}
