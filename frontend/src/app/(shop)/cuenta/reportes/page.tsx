'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Send } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, Empty, PageLoader } from '@/components/ui/misc';
import { Textarea } from '@/components/ui/input';
import { t } from '@/lib/i18n';

export default function MyReportsPage() {
  const q = useQuery({ queryKey: ['my-reports'], queryFn: () => get('/support/reports') });
  const [open, setOpen] = useState<string | null>(null);
  const d = useQuery({ queryKey: ['my-report', open], queryFn: () => get(`/support/reports/${open}`), enabled: !!open });
  const [reply, setReply] = useState('');
  const send = async () => {
    try {
      await post(`/support/reports/${open}/messages`, { body: reply });
      setReply('');
      d.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  if (q.isLoading) return <PageLoader />;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-extrabold">{t('Mis reportes')}</h1><p className="text-muted">{t('Seguimiento de los problemas que has reportado.')}</p></div>
        <Button asChild><Link href="/ayuda/reportar"><AlertCircle /> {t('Nuevo reporte')}</Link></Button>
      </div>
      <div className="card mt-6">
        {!q.data?.length ? <Empty icon={<AlertCircle />} title={t('No has enviado reportes')} /> : (
          <ul className="divide-y divide-line">
            {q.data.map((r: any) => (
              <li key={r.id}>
                <button onClick={() => setOpen(r.id)} className="flex w-full items-center gap-4 p-5 text-left hover:bg-surface">
                  <div className="min-w-0 flex-1"><p className="font-bold">{r.subject}</p><p className="text-sm text-muted">{r.code} · {r.category} · {fmtDateTime(r.createdAt)}</p></div>
                  <StatusBadge status={r.status} label={t(r.statusLabel)} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={d.data?.subject ?? t('Reporte')} description={d.data ? `${d.data.trackingCode} · ${d.data.statusLabel}` : ''} size="lg">
        <div className="space-y-3">
          {d.data?.messages.map((m: any) => (
            <div key={m.id} className={`rounded-xl p-3 text-sm ${m.staff ? 'bg-brand-50' : 'bg-surface'}`}>
              <p className="text-xs font-bold">{m.staff ? 'Equipo NEXOVAX' : t('Tú')} · {fmtDateTime(m.at)}</p>
              <p className="mt-1 whitespace-pre-line">{m.body}</p>
            </div>
          ))}
          {d.data && !['CLOSED', 'CANCELLED'].includes(d.data.status) && (
            <div className="flex gap-2"><Textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t('Agregar información…')} /><Button onClick={send} disabled={!reply.trim()} size="icon" aria-label={t('Enviar')}><Send /></Button></div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
