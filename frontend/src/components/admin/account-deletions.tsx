'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Trash2, UserX, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { t } from '@/lib/i18n';
import { fmtDate, fmtDateTime } from '@/lib/utils';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea, Field } from '@/components/ui/input';
import { Dialog, Empty, Pills, Spinner } from '@/components/ui/misc';
import type { Tone } from '@/lib/status';

const STATUS: Record<string, [string, Tone]> = {
  REQUESTED: ['Pendiente', 'amber'], APPROVED: ['Procesando', 'blue'], COMPLETED: ['Eliminada', 'green'],
  REJECTED: ['Rechazada', 'red'], CANCELLED: ['Cancelada por el usuario', 'gray'], FAILED: ['Falló', 'red'],
};

/** Admin: account deletion requests. Approving deletes the account and everything related (or anonymizes what must be kept). */
export function AccountDeletions() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('REQUESTED');
  const q = useQuery({ queryKey: ['account-deletions', status], queryFn: () => get<any[]>(`/admin/account-deletions${status ? `?status=${status}` : ''}`) });
  const [approve, setApprove] = useState<any>(null);
  const [reject, setReject] = useState<any>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['account-deletions'] });
      toast.success(t(ok));
      setApprove(null);
      setReject(null);
      setNote('');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mt-5" data-account-deletions>
      <CardHeader icon={<UserX />} title={t('Solicitudes de eliminación de cuenta')} subtitle={t('Los usuarios piden eliminar su cuenta desde Seguridad. Al aprobar se borra todo lo relacionado.')}
        action={<Pills value={status} onChange={setStatus} options={[{ value: 'REQUESTED', label: t('Pendientes') }, { value: 'COMPLETED', label: t('Eliminadas') }, { value: 'REJECTED', label: t('Rechazadas') }, { value: '', label: t('Todas') }]} />} />
      {q.isLoading ? <div className="grid place-items-center p-8"><Spinner /></div> : !q.data?.length ? (
        <Empty icon={<UserX />} title={t('No hay solicitudes')} />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((r) => {
            const [label, tone] = STATUS[r.status] ?? [r.status, 'gray'];
            return (
              <li key={r.id} className="flex flex-wrap items-start gap-4 px-5 py-4" data-deletion-request={r.email}>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-bold">{r.name || r.email} <span className="font-normal text-muted">· {r.email}</span></p>
                  <p className="text-muted">{t('Solicitada el {d}', { d: fmtDateTime(r.requestedAt) })}{r.userSince ? ` · ${t('Cliente desde {d}', { d: fmtDate(r.userSince) })}` : ''} · {t('{n} pedidos', { n: r.orders ?? 0 })}{r.stores ? ` · ${t('Tienda')}: ${r.stores}` : ''}</p>
                  {r.reason && <p className="mt-1">“{r.reason}”</p>}
                  {r.status === 'REQUESTED' && (
                    r.blockers.length ? (
                      <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900"><p className="flex items-center gap-1 font-semibold"><AlertTriangle className="size-3.5" /> {t('Pendiente de resolver antes de eliminar:')}</p><ul className="list-disc pl-5">{r.blockers.map((b: any) => <li key={b.code}>{t(b.label)}</li>)}</ul></div>
                    ) : (
                      <p className="mt-2 text-xs text-muted">{r.keepsHistory ? t('Tiene compras o ventas: se borrarán sus datos personales y los registros contables quedarán anónimos.') : t('Sin compras ni ventas: se borrará todo lo relacionado con la cuenta.')}</p>
                    )
                  )}
                  {r.status === 'COMPLETED' && <p className="mt-1 text-xs text-muted">{r.mode === 'HARD' ? t('Borrado total') : t('Datos personales borrados; historial anónimo')} · {fmtDateTime(r.completedAt)}{r.decidedBy ? ` · ${r.decidedBy}` : ''}</p>}
                  {r.status === 'REJECTED' && r.decisionNote && <p className="mt-1 text-xs text-muted">{t('Motivo')}: {r.decisionNote}</p>}
                  {r.result?.lastError && <p className="mt-1 text-xs text-red-600">{t('Último intento fallido')}: {r.result.lastError}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={tone}>{t(label)}</Badge>
                  {r.status === 'REQUESTED' && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setReject(r)}><X /> {t('Rechazar')}</Button>
                      <Button size="sm" variant="danger" disabled={!!r.blockers.length} onClick={() => setApprove(r)} data-deletion-approve><Trash2 /> {t('Eliminar cuenta')}</Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={!!approve} onOpenChange={(o) => !o && setApprove(null)} title={t('¿Eliminar la cuenta de {n}?', { n: approve?.email ?? '' })}
        description={approve?.keepsHistory ? t('Se borrarán sus datos personales, su acceso y su tienda; los pedidos y la contabilidad quedan anónimos.') : t('Se borrará la cuenta y todo lo relacionado. Esta acción no se puede deshacer.')}
        footer={<><Button variant="outline" onClick={() => setApprove(null)}>{t('Cancelar')}</Button><Button variant="danger" loading={busy} onClick={() => run(() => post(`/admin/account-deletions/${approve.id}/approve`), 'Cuenta eliminada.')} data-deletion-confirm><Check /> {t('Sí, eliminar')}</Button></>}>
        <p className="text-sm text-muted">{t('El usuario recibirá un correo de confirmación.')}</p>
      </Dialog>
      <Dialog open={!!reject} onOpenChange={(o) => !o && setReject(null)} title={t('Rechazar solicitud')} description={t('El usuario verá el motivo.')}
        footer={<><Button variant="outline" onClick={() => setReject(null)}>{t('Cancelar')}</Button><Button variant="danger" loading={busy} disabled={note.trim().length < 5} onClick={() => run(() => post(`/admin/account-deletions/${reject.id}/reject`, { note: note.trim() }), 'Solicitud rechazada.')}>{t('Rechazar')}</Button></>}>
        <Field label={t('Motivo')} required><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
      </Dialog>
    </Card>
  );
}
