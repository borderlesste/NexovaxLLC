'use client';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Clock, FileText, Lock, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, upload } from '@/lib/api';
import { t } from '@/lib/i18n';
import { fmtDate } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { ID_DOC_TYPES, idDocTypeHint, idDocTypeLabel, idRejectionLabel } from '@/lib/identity-verification';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
const MAX_BYTES = 10 * 1024 * 1024;

/** Vendedor → Configuración: request the «Identidad verificada» badge (store owner only). */
export function IdentityVerificationCard({ canEdit }: { canEdit: boolean }) {
  const q = useQuery({ queryKey: ['seller-identity'], queryFn: () => get('/seller/identity-verification'), enabled: canEdit });
  const [type, setType] = useState<string>('GOVERNMENT_ID');
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (!canEdit) return null;
  const d = q.data;
  const max = d?.maxFiles ?? 3;
  const last = d?.lastRequest;
  const pick = (list: FileList | null) => {
    const next = [...files];
    for (const f of Array.from(list ?? [])) {
      if (f.size > MAX_BYTES) { toast.error(t('«{n}» supera 10 MB.', { n: f.name })); continue; }
      if (next.length < max) next.push(f);
    }
    setFiles(next);
    if (input.current) input.current.value = '';
  };
  const send = async () => {
    setBusy(true);
    try {
      const form = new FormData();
      form.set('documentType', type);
      if (note.trim()) form.set('note', note.trim());
      files.forEach((f) => form.append('files', f));
      await upload('/seller/identity-verification', form);
      toast.success(t('Solicitud enviada. Te avisaremos por correo cuando la revisemos.'));
      setFiles([]); setNote('');
      q.refetch();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    try { await del('/seller/identity-verification'); toast.success(t('Solicitud cancelada. Borramos tus archivos.')); q.refetch(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Card className="p-5 text-sm">
      <p className="flex items-center gap-2 text-lg font-bold"><BadgeCheck className="size-5 text-brand-600" /> {t('Identidad verificada')}</p>
      {q.isLoading ? <div className="mt-3 h-20 animate-pulse rounded-lg bg-surface" /> : d?.verified ? (
        <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-emerald-800">{t('Tu identidad está verificada desde el {d} ({m}). Tu tienda muestra la insignia «Identidad verificada».', { d: fmtDate(d.verifiedAt), m: idDocTypeLabel(d.method) })}</p>
      ) : last?.status === 'PENDING' ? (
        <div className="mt-2 space-y-3">
          <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-amber-800"><Clock className="size-4 shrink-0" /> {t('Enviaste tu solicitud el {d} ({m}, {n} archivos). Un administrador la está revisando.', { d: fmtDate(last.createdAt), m: idDocTypeLabel(last.documentType), n: last.files })}</p>
          <Button variant="secondary" onClick={cancel} loading={busy}><X /> {t('Cancelar solicitud')}</Button>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          {last?.status === 'REJECTED' && (
            <p className="rounded-lg bg-red-50 p-3 text-red-700"><b>{t('No pudimos verificar tu identidad ({d}).', { d: fmtDate(last.reviewedAt) })}</b> {idRejectionLabel(last.rejectionReason)}{last.reviewNote ? ` ${last.reviewNote}` : ''} {t('Puedes enviar una nueva solicitud.')}</p>
          )}
          <p className="text-muted">{t('Envía un documento oficial para que un administrador verifique tu identidad. Es opcional: tu tienda puede vender sin esta insignia.')}</p>
          <div className="space-y-2">
            {ID_DOC_TYPES.map((c) => (
              <label key={c} className="flex cursor-pointer items-start gap-2 rounded-xl border border-line p-3">
                <input type="radio" name="identity-doc-type" className="mt-0.5" checked={type === c} onChange={() => setType(c)} />
                <span><b>{idDocTypeLabel(c)}</b><br /><span className="text-xs text-muted">{idDocTypeHint(c)}</span></span>
              </label>
            ))}
          </div>
          <div>
            <input ref={input} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => pick(e.target.files)} />
            <Button variant="secondary" onClick={() => input.current?.click()} disabled={files.length >= max}><Upload /> {t('Agregar archivos')}</Button>
            <p className="mt-1 text-xs text-muted">{t('Hasta {n} archivos PDF, JPG o PNG de 10 MB como máximo cada uno.', { n: max })}</p>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2"><FileText className="size-4 text-muted" /> <span className="flex-1 truncate">{f.name}</span>
                    <button type="button" aria-label={t('Quitar')} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="size-4 text-muted" /></button></li>
                ))}
              </ul>
            )}
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t('Nota para el equipo (opcional)')} />
          <p className="flex gap-2 text-xs text-muted"><Lock className="size-3.5 shrink-0" /> {t('Tus documentos se guardan en un espacio privado al que solo acceden los administradores, y se borran automáticamente después de la revisión.')}</p>
          <Button onClick={send} loading={busy} disabled={!files.length}><BadgeCheck /> {t('Solicitar identidad verificada')}</Button>
        </div>
      )}
    </Card>
  );
}
