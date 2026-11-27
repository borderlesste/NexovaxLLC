'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Check, ExternalLink, FileText, History, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, fetchBlobUrl, get, post } from '@/lib/api';
import { countryName, t } from '@/lib/i18n';
import { entityLabel } from '@/lib/entities';
import { fmtDate, fmtDateTime } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox, Dialog, Empty, ErrorBox, PageLoader } from '@/components/ui/misc';
import { Field, Select, Textarea } from '@/components/ui/input';
import { ID_REJECTION_REASONS, idDocTypeLabel, idLogLabel, idRejectionLabel, idRequestStatusLabel } from '@/lib/identity-verification';

/** One document: images are shown in place, PDFs open in a new tab. Loaded with the admin's session, never cached. */
function DocumentFile({ requestId, file }: { requestId: string; file: { id: string; name: string; mime: string; size: number } }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const isImage = file.mime.startsWith('image/');
  const load = async () => {
    try { const u = await fetchBlobUrl(`/admin/identity-verifications/${requestId}/files/${file.id}`); setUrl(u); return u; } catch (e) { setErr(true); toast.error(errorMessage(e)); return null; }
  };
  useEffect(() => { if (isImage) load(); return () => { if (url) URL.revokeObjectURL(url); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const openPdf = async () => { const u = url ?? (await load()); if (u) window.open(u, '_blank', 'noopener'); };
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><FileText className="size-4 text-muted" /> <span className="truncate">{file.name}</span> <span className="text-xs font-normal text-muted">{(file.size / 1024 / 1024).toFixed(1)} MB</span></p>
      {isImage ? (url ? <img src={url} alt={file.name} className="max-h-[520px] w-full rounded-lg bg-surface object-contain" /> : err ? <p className="text-sm text-red-600">{t('No se pudo abrir el archivo.')}</p> : <div className="h-40 animate-pulse rounded-lg bg-surface" />)
        : <Button variant="secondary" onClick={openPdf}><ExternalLink /> {t('Abrir PDF')}</Button>}
    </div>
  );
}

export default function IdentityRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['admin-identity-request', id], queryFn: () => get(`/admin/identity-verifications/${id}`) });
  const [dlg, setDlg] = useState<null | 'APPROVE' | 'REJECT'>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorBox message={errorMessage(q.error)} />;
  const r = q.data;
  const close = () => { setDlg(null); setReason(''); setNote(''); setChecked(false); };
  const decide = async () => {
    setBusy(true);
    try {
      await post(`/admin/identity-verifications/${id}/decision`, { approve: dlg === 'APPROVE', reason: dlg === 'REJECT' ? reason : undefined, note: note.trim() || undefined });
      toast.success(dlg === 'APPROVE' ? t('Identidad verificada.') : t('Solicitud rechazada.'));
      close();
      q.refetch();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const pending = r.status === 'PENDING';
  return (
    <>
      <PageHeader crumbs={[{ label: t('Verificación de identidad'), href: '/admin/identidad' }, { label: r.seller.store }]} title={r.seller.store}
        description={`${idDocTypeLabel(r.documentType)} · ${t('Enviada el {d}', { d: fmtDateTime(r.createdAt) })}`}
        actions={<>
          <Button variant="secondary" asChild><Link href={`/admin/vendedores/${r.seller.id}`}><ExternalLink /> {t('Ver vendedor')}</Link></Button>
          {pending && <Button variant="danger" onClick={() => setDlg('REJECT')}><X /> {t('Rechazar')}</Button>}
          {pending && <Button onClick={() => setDlg('APPROVE')} disabled={r.seller.status !== 'ACTIVE'}><Check /> {t('Aprobar')}</Button>}
        </>} />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader icon={<FileText />} title={t('Documentos')} subtitle={r.filesPurgedAt ? t('Los archivos se borraron el {d}.', { d: fmtDate(r.filesPurgedAt) }) : r.filesPurgeAfter ? t('Se borrarán el {d}.', { d: fmtDate(r.filesPurgeAfter) }) : t('Compáralos con los datos que declaró la tienda.')} />
          <div className="grid gap-3 p-5 md:grid-cols-2">
            {r.files.length ? r.files.map((f: any) => <DocumentFile key={f.id} requestId={r.id} file={f} />) : <div className="md:col-span-2"><Empty title={t('Sin archivos')} /></div>}
          </div>
          {r.sellerNote && <p className="border-t border-line px-5 py-4 text-sm"><b>{t('Nota de la tienda:')}</b> {r.sellerNote}</p>}
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader title={t('Datos declarados por la tienda')} />
            <dl className="space-y-2 p-5 text-sm">
              <div><dt className="text-muted">{t('Estado de la solicitud')}</dt><dd><Badge tone={r.status === 'APPROVED' ? 'green' : r.status === 'REJECTED' ? 'red' : r.status === 'PENDING' ? 'amber' : 'gray'}>{idRequestStatusLabel(r.status)}</Badge></dd></div>
              <div><dt className="text-muted">{t('Propietario')}</dt><dd className="font-semibold">{r.seller.ownerName} · {r.seller.ownerEmail}</dd></div>
              <div><dt className="text-muted">{t('Razón social')}</dt><dd className="font-semibold">{r.seller.legalName ?? '—'}</dd></div>
              <div><dt className="text-muted">{t('Tipo de entidad')}</dt><dd className="font-semibold">{r.seller.entityType ? entityLabel(r.seller.entityType) : '—'}{r.seller.countryCode ? ` · ${countryName(r.seller.countryCode)}` : ''}</dd></div>
              <div><dt className="text-muted">{t('Identificación fiscal')}</dt><dd className="font-semibold">{r.seller.taxIdLast4 ? `•••• ${r.seller.taxIdLast4}` : '—'}</dd></div>
              {r.reviewedAt && <div><dt className="text-muted">{t('Revisión')}</dt><dd>{t('Revisada el {d} por {who}', { d: fmtDateTime(r.reviewedAt), who: r.reviewer ?? '—' })}</dd></div>}
              {r.status === 'REJECTED' && <div><dt className="text-muted">{t('Motivo')}</dt><dd>{idRejectionLabel(r.rejectionReason)}{r.reviewNote ? ` ${r.reviewNote}` : ''}</dd></div>}
            </dl>
          </Card>
          <Card>
            <CardHeader icon={<History />} title={t('Registro')} subtitle={t('Quién abrió cada archivo y cada decisión.')} />
            <ul className="max-h-80 divide-y divide-line overflow-y-auto text-sm">
              {r.log.map((l: any, i: number) => <li key={i} className="flex justify-between gap-3 px-5 py-2"><span>{idLogLabel(l.action)}{l.actor ? <span className="text-muted"> · {l.actor}</span> : null}</span><span className="shrink-0 text-xs text-muted">{fmtDateTime(l.at)}</span></li>)}
            </ul>
          </Card>
        </div>
      </div>
      <Dialog open={!!dlg} onOpenChange={(o) => !o && close()} title={dlg === 'APPROVE' ? t('Aprobar identidad') : t('Rechazar solicitud')}
        description={dlg === 'APPROVE' ? t('La tienda mostrará la insignia pública «Identidad verificada». Apruébala solo si el documento es auténtico, está vigente y coincide con la tienda.') : t('La tienda recibe el motivo por correo y puede enviar una nueva solicitud.')}
        footer={<><Button variant="secondary" onClick={close}>{t('Cancelar')}</Button>
          {dlg === 'APPROVE'
            ? <Button onClick={decide} loading={busy} disabled={!checked}><BadgeCheck /> {t('Aprobar')}</Button>
            : <Button variant="dangerSolid" onClick={decide} loading={busy} disabled={!reason || (reason === 'OTHER' && !note.trim())}>{t('Rechazar')}</Button>}</>}>
        {dlg === 'REJECT' && (
          <Field label={t('Motivo')} required>
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">{t('Elige un motivo')}</option>
              {ID_REJECTION_REASONS.map((c) => <option key={c} value={c}>{idRejectionLabel(c)}</option>)}
            </Select>
          </Field>
        )}
        <Textarea className="mt-3" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
          placeholder={dlg === 'APPROVE' ? t('Nota interna (opcional)') : t('Detalle para la tienda (obligatorio si eliges «Otro motivo»)')} />
        {dlg === 'APPROVE' && <Checkbox className="mt-3" checked={checked} onChange={setChecked} label={t('Comprobé que el documento es auténtico, está vigente y coincide con el propietario o la empresa.')} />}
      </Dialog>
    </>
  );
}
