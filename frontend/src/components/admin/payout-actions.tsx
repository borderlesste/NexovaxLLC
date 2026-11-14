'use client';
import { useState } from 'react';
import { Check, Landmark, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, post } from '@/lib/api';
import { money } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/misc';
import { Field, Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';

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
      {['APPROVAL_REQUIRED', 'REQUESTED'].includes(p.status) && <Button size="sm" variant="soft" loading={busy === 'APPROVE'} onClick={() => run('APPROVE')}><Check /> {t('Aprobar')}</Button>}
      <Button size="sm" onClick={() => setOpen(true)}><Landmark /> {t('Liquidar')}</Button>
      {p.status !== 'PROCESSING' && <Button size="sm" variant="ghost" loading={busy === 'CANCEL'} onClick={() => run('CANCEL', { reason: t('Cancelado por finanzas') })} aria-label={t('Cancelar')}><X /></Button>}
      <Dialog open={open} onOpenChange={setOpen} title={t('Registrar transferencia')} description={`${p.number} · ${p.seller.name} · ${money(p.amount)}`}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>{t('Cancelar')}</Button><Button onClick={() => run('MARK_PAID', { reference: ref })} loading={busy === 'MARK_PAID'} disabled={!ref.trim()}>{t('Confirmar pago')}</Button></>}>
        <p className="mb-3 text-sm text-muted">{t('Destino:')}{' '}<b className="text-ink">{p.account.label} **** {p.account.last4}</b>{t('. Realiza la transferencia desde la banca de la empresa y registra la referencia.')}</p>
        <Field label={t('Referencia bancaria')} required><Input rule="reference" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('Ej. TRF-2026-000123')} /></Field>
      </Dialog>
    </span>
  );
}
