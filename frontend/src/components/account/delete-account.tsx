'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, post } from '@/lib/api';
import { t } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Dialog } from '@/components/ui/misc';

const BLOCKER: Record<string, string> = {
  BUYER_ORDERS_IN_PROGRESS: 'Tienes pedidos en curso. Espera a recibirlos o cancélalos.',
  OPEN_RETURNS: 'Tienes devoluciones abiertas.',
  SELLER_ORDERS_IN_PROGRESS: 'Tu tienda tiene ventas por preparar o enviar.',
  SELLER_BALANCE: 'Tu tienda tiene saldo pendiente o disponible: retíralo primero.',
  PAYOUTS_IN_PROGRESS: 'Tu tienda tiene retiros en proceso.',
  STAFF_ROLES: 'Eres parte del equipo del marketplace: pide que te quiten los roles de staff.',
};

/** "Delete account" card: the request goes to the admin team, who deletes the account and everything related. */
export function DeleteAccountCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['account-deletion'], queryFn: () => get('/me/account-deletion') });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const pending = d?.request?.status === 'REQUESTED' || d?.request?.status === 'APPROVED';
  const submit = async () => {
    setBusy(true);
    try {
      qc.setQueryData(['account-deletion'], await post('/me/account-deletion', { confirm: confirm.trim().toUpperCase(), reason: reason.trim() || undefined }));
      setOpen(false);
      setConfirm('');
      setReason('');
      toast.success(t('Solicitud enviada. Te avisaremos por correo.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      qc.setQueryData(['account-deletion'], await del('/me/account-deletion'));
      toast.success(t('Cancelaste la solicitud. Tu cuenta sigue activa.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card mt-6 p-6" data-delete-account>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="text-lg font-bold">{t('Eliminar cuenta')}</h2>
          <p className="mt-1 text-sm text-muted">{t('Elimina permanentemente tu cuenta de NEXOVAX. No podrás deshacerlo.')}</p>
        </div>
        {!pending && (
          <button onClick={() => setOpen(true)} className="text-sm font-semibold text-red-600 hover:underline" data-delete-open>{t('Eliminar cuenta')}</button>
        )}
      </div>
      {pending && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900" data-delete-pending>
          <span className="flex items-center gap-2"><Clock className="size-4 shrink-0" /> {t('Solicitaste eliminar tu cuenta el {d}. El equipo la está revisando.', { d: fmtDateTime(d.request.requestedAt) })}</span>
          {d.request.status === 'REQUESTED' && <Button size="sm" variant="outline" loading={busy} onClick={cancel}>{t('Cancelar solicitud')}</Button>}
        </div>
      )}
      {d?.request?.status === 'REJECTED' && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-surface p-4 text-sm"><XCircle className="mt-0.5 size-4 shrink-0 text-red-500" /> <span>{t('Tu última solicitud fue rechazada.')}{d.request.decisionNote ? ` ${t('Motivo')}: ${d.request.decisionNote}` : ''}</span></p>
      )}
      <Dialog open={open} onOpenChange={setOpen} title={t('¿Eliminar tu cuenta?')} description={t('El equipo de NEXOVAX revisará tu solicitud y te avisará por correo.')}
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>{t('Cancelar')}</Button><Button variant="danger" loading={busy} disabled={confirm.trim().toUpperCase() !== 'ELIMINAR'} onClick={submit} data-delete-submit><Trash2 /> {t('Solicitar eliminación')}</Button></>}>
        <div className="space-y-4 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>{t('Se borran tu perfil, foto, direcciones, tarjetas guardadas, favoritos, avisos y tu acceso.')}</li>
            {d?.keepsHistory ? (
              <li>{t('Tus pedidos y pagos se conservan de forma anónima, porque la ley y la contabilidad de las tiendas los requieren.')}</li>
            ) : (
              <li>{t('Como no tienes compras ni ventas, se borra todo lo relacionado con tu cuenta.')}</li>
            )}
            <li>{t('Si tienes una tienda, se cierra y sus productos dejan de mostrarse.')}</li>
          </ul>
          {!!d?.blockers?.length && (
            <div className="rounded-xl bg-amber-50 p-3 text-amber-900" data-delete-blockers>
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" /> {t('Antes de eliminarla hay que resolver:')}</p>
              <ul className="mt-1 list-disc pl-6">{d.blockers.map((b: any) => <li key={b.code}>{t(BLOCKER[b.code] ?? b.label)}</li>)}</ul>
              <p className="mt-1 text-xs">{t('Puedes enviar la solicitud igual; el equipo la aprobará cuando esté resuelto.')}</p>
            </div>
          )}
          <Field label={t('¿Por qué te vas?')} hint={t('(opcional)')}><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
          <Field label={t('Escribe ELIMINAR para confirmar')} required><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="ELIMINAR" autoComplete="off" data-delete-confirm /></Field>
        </div>
      </Dialog>
    </div>
  );
}
