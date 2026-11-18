'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileUp, Flag, Send, Trash2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post, upload } from '@/lib/api';
import { fmtDateTime, money } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Dialog, PageLoader } from '@/components/ui/misc';

const KINDS: [string, string][] = [['SHIPPING', 'Prueba de envío o entrega'], ['RECEIPT', 'Factura o recibo'], ['COMMUNICATION', 'Conversación con el cliente'], ['OTHER', 'Otro documento']];
const MAX_TOTAL = 4.5 * 1024 * 1024;

/** Admin: answer a dispute with the order's own evidence (sent to Stripe / PayPal), or accept it. */
export function DisputeResponseDialog({ incidentId, onClose, onDone }: { incidentId: string; onClose: () => void; onDone: () => void }) {
  const q = useQuery({ queryKey: ['dispute-draft', incidentId], queryFn: () => get<any>(`/admin/payment-incidents/${incidentId}/dispute-response`) });
  const [f, setF] = useState({ note: '', productDescription: '', carrier: '', trackingNumber: '', shippingDate: '' });
  const [files, setFiles] = useState<{ file: File; kind: string }[]>([]);
  const [mode, setMode] = useState<'respond' | 'accept'>('respond');
  const [acceptNote, setAcceptNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setF((x) => ({ ...x, productDescription: q.data.suggested.productDescription, carrier: q.data.suggested.carrier, trackingNumber: q.data.suggested.trackingNumber, shippingDate: q.data.suggested.shippingDate }));
  }, [q.data]);
  const d = q.data;
  const total = files.reduce((n, x) => n + x.file.size, 0);
  const add = (list: FileList | null) => {
    const next = [...files];
    for (const file of Array.from(list ?? [])) {
      if (next.length >= 4) { toast.error(t('Adjunta como máximo 4 archivos.')); break; }
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) { toast.error(t('Solo se aceptan PDF, JPG o PNG.')); continue; }
      if (file.size > 4 * 1024 * 1024) { toast.error(t('Cada archivo puede pesar hasta 4 MB.')); continue; }
      next.push({ file, kind: d?.suggested?.delivered ? 'SHIPPING' : 'OTHER' });
    }
    setFiles(next);
  };
  const send = async () => {
    setBusy(true);
    try {
      if (mode === 'respond') {
        const fd = new FormData();
        for (const [k, v] of Object.entries(f)) if (v) fd.append(k, v);
        fd.append('kinds', files.map((x) => x.kind).join(','));
        for (const x of files) fd.append('files', x.file, x.file.name);
        await upload(`/admin/payment-incidents/${incidentId}/dispute-response`, fd);
        toast.success(t('Pruebas enviadas. El procesador revisará la disputa.'));
      } else {
        await post(`/admin/payment-incidents/${incidentId}/dispute-accept`, { note: acceptNote });
        toast.success(t('Disputa aceptada. La pérdida se contabiliza cuando el procesador la cierre.'));
      }
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const provider = d?.provider === 'PAYPAL' ? 'PayPal' : 'Stripe';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="xl" title={t('Responder disputa')}
      description={d ? `${d.order?.number ?? ''} · ${money(d.amount, d.currency)} · ${provider}${d.dueBy ? ` · ${t('Responder antes del')} ${fmtDateTime(d.dueBy)}` : ''}` : undefined}
      footer={d?.canRespond ? (
        <>
          <Button variant="secondary" onClick={onClose}>{t('Cancelar')}</Button>
          {mode === 'respond'
            ? <Button loading={busy} disabled={f.note.trim().length < 20 || total > MAX_TOTAL} onClick={send} data-dispute-send><Send /> {t('Enviar pruebas a {p}', { p: provider })}</Button>
            : <Button variant="danger" loading={busy} disabled={acceptNote.trim().length < 5} onClick={send} data-dispute-accept-send><Flag /> {t('Aceptar la disputa')}</Button>}
        </>
      ) : <Button variant="secondary" onClick={onClose}>{t('Cerrar')}</Button>}>
      {!d ? <PageLoader /> : (
        <div className="space-y-5" data-dispute-dialog>
          {!d.canRespond && <p className="rounded-xl bg-surface p-3 text-sm text-muted">{t('Esta disputa ya no espera respuesta de la tienda. Abajo está lo que se envió.')}</p>}
          {d.canRespond && (
            <div className="inline-flex gap-1 rounded-xl border border-line p-1">
              <Button size="sm" variant={mode === 'respond' ? 'primary' : 'ghost'} onClick={() => setMode('respond')}>{t('Defender la venta')}</Button>
              <Button size="sm" variant={mode === 'accept' ? 'primary' : 'ghost'} onClick={() => setMode('accept')} data-dispute-mode-accept>{t('Aceptar la disputa')}</Button>
            </div>
          )}
          <div className="grid gap-3 rounded-xl bg-surface p-4 text-sm sm:grid-cols-2" data-dispute-facts>
            <p><span className="text-muted">{t('Cliente')}:</span> <b>{d.order?.customerName}</b> · {d.order?.customerEmail}</p>
            <p><span className="text-muted">{t('Motivo')}:</span> <b>{d.reason?.replace(/_/g, ' ') ?? '—'}</b></p>
            <p className="sm:col-span-2"><span className="text-muted">{t('Dirección de envío')}:</span> {d.order?.shippingAddress || '—'}</p>
            {d.shipments.map((s: any, n: number) => (
              <p key={n} className="sm:col-span-2 flex items-start gap-2"><Truck className="mt-0.5 size-4 shrink-0 text-brand-600" />
                <span>{s.carrier ?? '—'} · {s.tracking_number ?? t('sin seguimiento')} · {t('enviado')} {s.shipped_at ? fmtDateTime(s.shipped_at) : '—'}
                  {s.delivered_at ? <b className="text-emerald-700"> · {t('entregado')} {fmtDateTime(s.delivered_at)}</b> : ''}
                  {s.events?.length ? <span className="block text-xs text-muted">{s.events.length} {t('eventos de seguimiento')}</span> : null}</span></p>
            ))}
            {!d.shipments.length && <p className="sm:col-span-2 text-amber-700">{t('El pedido no tiene envíos registrados.')}</p>}
            {d.messages > 0 && <p className="sm:col-span-2 text-muted">{t('{n} mensajes con el cliente en NEXOVAX.', { n: d.messages })}</p>}
          </div>
          {d.canRespond && mode === 'respond' && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('Transportadora')}><Input value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })} /></Field>
                <Field label={t('Número de seguimiento')}><Input value={f.trackingNumber} onChange={(e) => setF({ ...f, trackingNumber: e.target.value })} /></Field>
                <Field label={t('Fecha de envío')}><Input type="date" value={f.shippingDate} onChange={(e) => setF({ ...f, shippingDate: e.target.value })} /></Field>
              </div>
              <Field label={t('Productos')}><Input value={f.productDescription} maxLength={1000} onChange={(e) => setF({ ...f, productDescription: e.target.value })} /></Field>
              <Field label={t('Explicación para el banco o PayPal')} required hint={t('20 a 5000 caracteres')}>
                <Textarea rows={5} maxLength={5000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} data-dispute-note
                  placeholder={t('Ej.: El pedido se entregó el 12 de noviembre en la dirección del cliente, con número de seguimiento y firma. El cliente no reportó ningún problema antes de la disputa.')} />
              </Field>
              <div>
                <p className="mb-2 text-sm font-semibold">{t('Documentos')} <span className="font-normal text-muted">({t('hasta 4 archivos PDF, JPG o PNG; 4,5 MB en total')})</span></p>
                <div className="space-y-2">
                  {files.map((x, n) => (
                    <div key={n} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 text-sm">
                      <span className="flex-1 truncate">{x.file.name} <span className="text-xs text-muted">({Math.round(x.file.size / 1024)} KB)</span></span>
                      <Select value={x.kind} onChange={(e) => setFiles(files.map((y, i) => (i === n ? { ...y, kind: e.target.value } : y)))} className="w-56">
                        {KINDS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                      </Select>
                      <Button size="icon" variant="ghost" onClick={() => setFiles(files.filter((_, i) => i !== n))} aria-label={t('Quitar')}><Trash2 /></Button>
                    </div>
                  ))}
                  {files.length < 4 && (
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line p-3 text-sm text-brand-700 hover:bg-brand-50">
                      <FileUp className="size-4" /> {t('Adjuntar documento')}
                      <input type="file" accept="application/pdf,image/jpeg,image/png" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} data-dispute-file />
                    </label>
                  )}
                  {total > MAX_TOTAL && <p className="text-sm text-red-600">{t('Entre todos los archivos no pueden pasar de 4,5 MB.')}</p>}
                </div>
              </div>
              <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{t('Solo se puede responder una vez: revisa todo antes de enviar. El dato del cliente, la dirección y el seguimiento se envían automáticamente.')}</p>
            </>
          )}
          {d.canRespond && mode === 'accept' && (
            <>
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{t('Al aceptar, el cliente se queda con el dinero y la pérdida se descuenta según la política de disputas. No se puede deshacer.')}</p>
              <Field label={t('Motivo')} required><Textarea rows={3} value={acceptNote} onChange={(e) => setAcceptNote(e.target.value)} data-dispute-accept-note placeholder={t('Ej.: La tienda confirmó que el paquete se perdió.')} /></Field>
            </>
          )}
          {d.history.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold">{t('Respuestas enviadas')}</p>
              <ul className="space-y-2 text-sm" data-dispute-history>
                {d.history.map((h: any, n: number) => (
                  <li key={n} className="rounded-lg border border-line p-3">
                    <p className="flex items-center gap-2 font-semibold">{h.status === 'SUBMITTED' ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Flag className="size-4 text-red-600" />}
                      {h.action === 'ACCEPT' ? t('Disputa aceptada') : t('Pruebas enviadas')} <span className="font-normal text-muted">· {fmtDateTime(h.at)}{h.by ? ` · ${h.by}` : ''}</span></p>
                    {h.note && <p className="mt-1 whitespace-pre-line text-muted">{h.note}</p>}
                    {h.files?.length > 0 && <p className="mt-1 text-xs text-muted">{h.files.map((x: any) => x.name).join(', ')}</p>}
                    {h.error && <p className="mt-1 text-xs text-red-700">{h.error}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
