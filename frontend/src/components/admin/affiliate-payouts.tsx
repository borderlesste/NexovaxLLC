'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Handshake } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { money } from '@/lib/utils';
import { countryName, t } from '@/lib/i18n';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Dialog, Empty } from '@/components/ui/misc';

/** Admin: affiliates with commissions available; pay them outside the platform and record the reference. */
export function AffiliatePayouts() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['affiliate-payables'], queryFn: () => get<any[]>('/admin/affiliates/payables') });
  const [pay, setPay] = useState<any>(null);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await post<any>(`/admin/affiliates/${pay.userId}/pay`, { reference: ref.trim() });
      toast.success(t('Pago registrado: {a}.', { a: money(r.paid) }));
      setPay(null);
      setRef('');
      qc.invalidateQueries({ queryKey: ['affiliate-payables'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const dest = (p: any) =>
    !p ? <span className="text-red-600">{t('Sin método de cobro registrado')}</span>
    : p.method === 'PAYPAL' ? <>PayPal · {p.paypalEmail}</>
    : p.method !== 'BANK' ? <>{({ WISE: 'Wise', PAYONEER: 'Payoneer', ZELLE: 'Zelle', SKRILL: 'Skrill' } as Record<string, string>)[p.method] ?? p.method} · {p.bank?.account} · {p.bank?.holderName}</>
    : <>{p.bank?.bankName} · {p.bank?.holderName} · ****{String(p.bank?.accountNumber ?? '').slice(-4)} · {countryName(p.bank?.country)}</>;
  return (
    <Card className="mt-5" data-affiliate-payouts>
      <CardHeader icon={<Handshake />} title={t('Pagos a afiliados')} subtitle={t('Comisiones disponibles (ya se descontaron a cada tienda). Envía el dinero y registra la referencia.')} />
      {q.data?.length ? (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs text-muted"><tr><th className="px-5 py-2.5">{t('Afiliado')}</th><th>{t('Cobra por')}</th><th>{t('Comisiones')}</th><th>{t('Disponible')}</th><th /></tr></thead>
          <tbody className="divide-y divide-line">
            {q.data.map((a) => (
              <tr key={a.userId} data-affiliate-payable={a.email}>
                <td className="px-5 py-3 font-semibold">{a.name}<span className="block text-xs font-normal text-muted">{a.email}</span></td>
                <td className="text-xs">{dest(a.payoutProfile)}</td>
                <td>{a.earnings}</td>
                <td className="font-bold">{money(a.available)}</td>
                <td className="pr-5 text-right"><Button size="sm" disabled={!a.payoutProfile} onClick={() => setPay(a)} data-affiliate-pay>{t('Registrar pago')}</Button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <Empty title={t('No hay comisiones de afiliados por pagar')} />}
      {pay && (
        <Dialog open onOpenChange={(o) => !o && setPay(null)} title={t('Pagar a {n}', { n: pay.name })} description={t('Envía {a} a: ', { a: money(pay.available) })}
          footer={<><Button variant="secondary" onClick={() => setPay(null)}>{t('Cancelar')}</Button><Button loading={busy} disabled={ref.trim().length < 3} onClick={submit}>{t('Confirmar pago')}</Button></>}>
          <p className="mb-3 rounded-lg bg-surface p-3 text-sm">{dest(pay.payoutProfile)}</p>
          <Field label={t('Referencia del pago')} required><Input value={ref} maxLength={80} onChange={(e) => setRef(e.target.value)} placeholder={t('Ej.: ID de la transacción de PayPal')} /></Field>
        </Dialog>
      )}
    </Card>
  );
}
