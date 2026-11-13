'use client';
import { useState } from 'react';
import { Check, Landmark, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, post } from '@/lib/api';
import { money } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/misc';
import { Field, Input } from '@/components/ui/input';

export function PayoutActions({ p, onDone }: { p: any; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (action: string, extra: any = {}) => {
    setBusy(action);
    try {
      await post(`/admin/payouts/${p.id}/action`, { action, ...extra });
      toast.success(action === 'MARK_PAID' ? 'Retiro liquidado.' : action === 'APPROVE' ? 'Retiro aprobado.' : 'Retiro actualizado.');
      setOpen(false);
      onDone();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  if (!['APPROVAL_REQUIRED', 'REQUESTED', 'APPROVED', 'PROCESSING'].includes(p.status)) return null;
  return (
    <span className="flex justify-end gap-1">
      {['APPROVAL_REQUIRED', 'REQUESTED'].includes(p.status) && <Button size="sm" variant="soft" loading={busy === 'APPROVE'} onClick={() => run('APPROVE')}><Check /> Aprobar</Button>}
      <Button size="sm" onClick={() => setOpen(true)}><Landmark /> Liquidar</Button>
      {p.status !== 'PROCESSING' && <Button size="sm" variant="ghost" loading={busy === 'CANCEL'} onClick={() => run('CANCEL', { reason: 'Cancelado por finanzas' })} aria-label="Cancelar"><X /></Button>}
      <Dialog open={open} onOpenChange={setOpen} title="Registrar transferencia" description={`${p.number} · ${p.seller.name} · ${money(p.amount)}`}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => run('MARK_PAID', { reference: ref })} loading={busy === 'MARK_PAID'} disabled={!ref.trim()}>Confirmar pago</Button></>}>
        <p className="mb-3 text-sm text-muted">Destino: <b className="text-ink">{p.account.label} **** {p.account.last4}</b>. Realiza la transferencia desde la banca de la empresa y registra la referencia.</p>
        <Field label="Referencia bancaria" required><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ej. TRF-2026-000123" /></Field>
      </Dialog>
    </span>
  );
}
