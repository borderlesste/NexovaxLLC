'use client';
import { useState } from 'react';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, post } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/input';
import { Dialog } from '@/components/ui/misc';

/** Reasons a message can be reported for (same list as the API). */
export const REPORT_REASONS = ['SPAM', 'HARASSMENT', 'FRAUD', 'OFF_PLATFORM', 'INAPPROPRIATE', 'OTHER'] as const;
export const reportReasonLabel = (r: string) =>
  ({
    SPAM: t('Spam o publicidad'),
    HARASSMENT: t('Acoso, insultos o amenazas'),
    FRAUD: t('Fraude o estafa'),
    OFF_PLATFORM: t('Pide pagar o comprar fuera de NEXOVAX'),
    INAPPROPRIATE: t('Contenido inapropiado'),
    OTHER: t('Otro motivo'),
  })[r] ?? r;

export const HIDDEN_TEXT = 'Mensaje oculto por moderación';
/** Body of a message for display: moderation placeholders are translated. */
export const messageText = (body: string | null | undefined) =>
  body === HIDDEN_TEXT || body === 'Mensaje eliminado por moderación' ? t(body) : body ?? '';

/** Dialog to report one message to the moderators. */
export function ReportMessageDialog({ conversationId, messageId, onClose, onDone }: { conversationId: string; messageId: string | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!messageId || !reason) return;
    setBusy(true);
    try {
      const r = await post<{ hidden: boolean }>(`/conversations/${conversationId}/messages/${messageId}/report`, { reason, details: details.trim() || undefined });
      toast.success(r.hidden ? t('Gracias. El mensaje quedó oculto mientras lo revisamos.') : t('Gracias. Nuestro equipo revisará el mensaje.'));
      setReason('');
      setDetails('');
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!messageId}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={t('Reportar mensaje')}
      description={t('La otra persona no sabrá quién lo reportó. Un moderador revisará la conversación.')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Cancelar')}</Button><Button variant="danger" onClick={submit} loading={busy} disabled={!reason} data-report-submit><Flag /> {t('Enviar reporte')}</Button></>}
    >
      <div className="space-y-4" data-report-dialog>
        <Field label={t('Motivo')} required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)} name="reason">
            <option value="">{t('Elige un motivo')}</option>
            {REPORT_REASONS.map((r) => <option key={r} value={r}>{reportReasonLabel(r)}</option>)}
          </Select>
        </Field>
        <Field label={t('Detalles (opcional)')}>
          <Textarea rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} placeholder={t('Cuéntanos qué pasó…')} />
        </Field>
      </div>
    </Dialog>
  );
}
