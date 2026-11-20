'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, put } from '@/lib/api';
import { cn, fmtDateTime } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageLoader } from '@/components/ui/misc';

type Payer = 'SELLER' | 'PLATFORM' | 'SHARED';
type Comp = { payer: Payer; sellerPercent: number };
const PAYERS: [Payer, string][] = [['SELLER', 'La tienda'], ['PLATFORM', 'La plataforma'], ['SHARED', 'Compartido']];
const label = (c: Comp) => (c.payer === 'SHARED' ? t('Compartido: tienda {s} % · plataforma {p} %', { s: c.sellerPercent, p: Math.round((100 - c.sellerPercent) * 100) / 100 }) : t(PAYERS.find((x) => x[0] === c.payer)![1]));

/** Admin (Configuración → Disputas): who bears a lost dispute. Applies to orders paid from now on. */
export function ChargebackPolicyCard() {
  const q = useQuery({ queryKey: ['chargeback-policy'], queryFn: () => get<any>('/admin/chargeback-policy') });
  const [f, setF] = useState<{ principal: Comp; fee: Comp } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setF({ principal: { payer: q.data.principal.current.payer, sellerPercent: q.data.principal.current.sellerPercent || 50 }, fee: { payer: q.data.fee.current.payer, sellerPercent: q.data.fee.current.sellerPercent || 50 } });
  }, [q.data]);
  if (!q.data || !f) return <PageLoader />;
  const same = (k: 'principal' | 'fee') => f[k].payer === q.data[k].current.payer && (f[k].payer !== 'SHARED' || f[k].sellerPercent === q.data[k].current.sellerPercent);
  const save = async () => {
    setBusy(true);
    try {
      await put('/admin/chargeback-policy', { principal: { payer: f.principal.payer, ...(f.principal.payer === 'SHARED' ? { sellerPercent: f.principal.sellerPercent } : {}) }, fee: { payer: f.fee.payer, ...(f.fee.payer === 'SHARED' ? { sellerPercent: f.fee.sellerPercent } : {}) } });
      toast.success(t('Política de disputas actualizada. Aplica a los pedidos pagados desde ahora.'));
      q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const Row = ({ k, title, desc }: { k: 'principal' | 'fee'; title: string; desc: string }) => (
    <div className="rounded-xl border border-line p-4" data-chargeback={k}>
      <p className="font-bold">{title}</p>
      <p className="text-xs text-muted">{desc}</p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {PAYERS.map(([v, l]) => (
          <button key={v} type="button" onClick={() => setF({ ...f, [k]: { ...f[k], payer: v } })} data-payer={v} aria-pressed={f[k].payer === v}
            className={cn('h-10 rounded-lg border text-sm font-semibold', f[k].payer === v ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-line')}>{t(l)}</button>
        ))}
      </div>
      {f[k].payer === 'SHARED' && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <span>{t('Parte de la tienda')}</span>
          <Input type="number" min={1} max={99} step="1" className="w-24" value={f[k].sellerPercent} onChange={(e) => setF({ ...f, [k]: { ...f[k], sellerPercent: Math.max(1, Math.min(99, Number(e.target.value) || 0)) } })} data-seller-percent />
          <span className="text-muted">% · {t('plataforma')} {Math.round((100 - f[k].sellerPercent) * 100) / 100} %</span>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{t('Vigente')}: <b>{label(q.data[k].current)}</b> · {t('versión {n}', { n: q.data[k].current.version })} · {fmtDateTime(q.data[k].current.effectiveFrom)}</p>
    </div>
  );
  return (
    <Card>
      <CardHeader icon={<Scale />} title={t('Disputas perdidas')} subtitle={t('Quién asume el dinero cuando el cliente gana una disputa o contracargo.')} />
      <div className="space-y-4 p-5">
        <Row k="principal" title={t('Monto de la disputa')} desc={t('El dinero que el banco o PayPal devuelve al cliente. Si lo paga la tienda, se descuenta de su saldo y se revierte la comisión.')} />
        <Row k="fee" title={t('Comisión del procesador por disputa')} desc={t('El cargo fijo que cobra Stripe o PayPal por cada disputa (por ejemplo, 15 US$).')} />
        <p className="rounded-xl bg-surface p-3 text-xs text-muted">{t('El cambio aplica a los pedidos pagados desde ahora. Los pedidos anteriores conservan la política con la que se vendieron.')}{q.data.openDisputes ? ` ${t('Hay {n} disputas abiertas: se resolverán con su política original.', { n: q.data.openDisputes })}` : ''}</p>
        <div className="flex justify-end"><Button loading={busy} disabled={same('principal') && same('fee')} onClick={save} data-chargeback-save><Check /> {t('Guardar política')}</Button></div>
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">{t('Historial de versiones')}</summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {(['principal', 'fee'] as const).flatMap((k) => q.data[k].history.map((h: any) => (
              <li key={h.versionId}>{k === 'principal' ? t('Monto de la disputa') : t('Comisión del procesador por disputa')} · {t('versión {n}', { n: h.version })} · {label(h)} · {fmtDateTime(h.effectiveFrom)}{h.by ? ` · ${h.by}` : ''}</li>
            )))}
          </ul>
        </details>
      </div>
    </Card>
  );
}
