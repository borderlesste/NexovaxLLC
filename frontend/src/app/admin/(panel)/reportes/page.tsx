'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, BarChart3, Check, CheckCircle2, ChevronDown, Clock, FileText, Hand, RotateCcw, Search, Send, Star, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post, upload } from '@/lib/api';
import { AttachmentList, FilePicker, formWith } from '@/components/attachments/attachments';
import { cn, fmtDateTime, relative } from '@/lib/utils';
import { PRIORITY } from '@/lib/status';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Avatar, Empty, Pagination, Segmented, Spinner } from '@/components/ui/misc';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Stars, fmtMinutes } from '@/components/support/support-rating';

export default function ReportsAdminPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [platform, setPlatform] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');
  const [showStats, setShowStats] = useState(false);
  const { me } = useAuth();
  const agents = useQuery({ queryKey: ['support-agents'], queryFn: () => get<{ id: string; name: string }[]>('/support/admin/agents'), staleTime: 300_000 });
  const stats = useQuery({ queryKey: ['support-stats'], queryFn: () => get('/support/admin/stats?days=30'), enabled: showStats });
  const cats = useQuery({ queryKey: ['support-catalogs'], queryFn: () => get('/support/catalogs'), staleTime: Infinity });
  const list = useQuery({ queryKey: ['tickets', status, priority, category, platform, assignee, search, page], queryFn: () => get(`/support/admin/tickets?status=${status}&priority=${priority}&category=${category}&platform=${platform}&assignee=${assignee}&search=${encodeURIComponent(search)}&page=${page}`), refetchInterval: 30_000 });
  // Deep link from the bell (/admin/reportes?ticket=…).
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('ticket'); if (id && /^[0-9a-f-]{36}$/i.test(id)) setSel(id); }, []);
  useEffect(() => { if (!sel && list.data?.items[0]) setSel(list.data.items[0].id); }, [list.data, sel]);
  const tk = useQuery({ queryKey: ['ticket', sel], queryFn: () => get(`/support/admin/tickets/${sel}`), enabled: !!sel });
  const c = list.data?.counts;
  const apply = (data: any) => { qc.setQueryData(['ticket', sel], data); qc.invalidateQueries({ queryKey: ['tickets'] }); qc.invalidateQueries({ queryKey: ['admin-attention'] }); };
  const run = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try { apply(await fn()); toast.success(ok); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  const d = tk.data;
  return (
    <>
      <PageHeader crumbs={[{ label: t('Panel') }, { label: t('Soporte') }, { label: t('Reportes y problemas') }]} title={t('Seguimiento de problemas reportados')} description={t('Revisa, asigna y resuelve las incidencias notificadas por usuarios de la plataforma.')} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Total de reportes')} value={c?.total ?? '—'} icon={<FileText />} hint={t('Reportes registrados')} />
        <StatCard label={t('Pendientes')} value={c?.pending ?? '—'} icon={<Clock />} tone="amber" hint={t('{a} de prioridad crítica', { a: c?.critical ?? 0 })} />
        <StatCard label={t('En proceso')} value={c?.in_progress ?? '—'} icon={<RotateCcw />} hint={t('Asignados al equipo')} />
        <StatCard label={t('Resueltos')} value={c?.resolved ?? '—'} icon={<Check />} tone="green" hint={t('Casos finalizados')} />
      </div>
      <Card className="mt-5" data-support-stats>
        <button type="button" onClick={() => setShowStats(!showStats)} className="flex w-full items-center justify-between px-5 py-4 text-left">
          <span className="flex items-center gap-2 text-lg font-bold"><BarChart3 className="size-5 text-brand-600" /> {t('Rendimiento del equipo (30 días)')}</span>
          <ChevronDown className={cn('size-5 text-muted transition', showStats && 'rotate-180')} />
        </button>
        {showStats && (stats.isLoading ? <div className="grid place-items-center pb-6"><Spinner /></div> : stats.data && (
          <div className="overflow-x-auto border-t border-line">
            <p className="px-5 pt-3 text-xs text-muted">{t('Los tiempos no cuentan las horas en que el reporte esperaba la respuesta del usuario.')}</p>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-2">{t('Responsable')}</th><th>{t('Reportes')}</th><th>{t('Resueltos')}</th><th>{t('Primera respuesta')}</th><th>{t('Tiempo de resolución')}</th><th>{t('Satisfacción')}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {[{ ...stats.data.overall, agent: t('Todo el equipo'), total: true }, ...stats.data.agents].map((a: any, i: number) => (
                  <tr key={a.agentId ?? (a.total ? 'all' : `none-${i}`)} className={a.total ? 'bg-surface/60 font-semibold' : undefined}>
                    <td className="px-5 py-2">{a.agent ?? t('Sin asignar')}</td><td>{a.tickets}</td><td>{a.resolved}</td>
                    <td>{fmtMinutes(a.avgFirstResponseMinutes)}</td><td>{fmtMinutes(a.avgResolutionMinutes)}</td>
                    <td>{a.avgRating != null ? <span className="flex items-center gap-1"><Star className="size-4 fill-amber-400 text-amber-400" /> {a.avgRating.toFixed(1)} <span className="text-xs text-muted">({a.ratings})</span></span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Card>
      <div className="mt-5 grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <div className="px-5 pt-4"><p className="text-lg font-bold">{t('Bandeja de reportes')}</p></div>
          <Segmented className="px-3" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: '', label: t('Todos'), count: c?.total }, { value: 'OPEN', label: t('Pendientes'), count: c?.pending }, { value: 'IN_PROGRESS_ALL', label: t('En proceso'), count: c?.in_progress }, { value: 'DONE', label: t('Resueltos'), count: c?.resolved }]} />
          <div className="flex flex-wrap gap-3 p-4">
            <Input icon={<Search />} placeholder={t('Buscar por ID, asunto o usuario...')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
            <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-40"><option value="">{t('Prioridad: Todas')}</option><option value="CRITICAL">{t('Crítica')}</option><option value="HIGH">{t('Alta')}</option><option value="NORMAL">{t('Media')}</option><option value="LOW">{t('Baja')}</option></Select>
            <Select value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }} className="w-44" data-platform-filter><option value="">{t('Plataforma: Todas')}</option><option value="WEB">{t('Computadora')}</option><option value="MOBILE">{t('Celular o tablet')}</option><option value="OTHER">{t('Otro')}</option></Select>
            <Select value={assignee} onChange={(e) => { setAssignee(e.target.value); setPage(1); }} className="w-48" data-assignee-filter>
              <option value="">{t('Responsable: Todos')}</option>
              <option value="me">{t('Mis reportes abiertos ({n})', { n: c?.mine ?? 0 })}</option>
              <option value="none">{t('Sin asignar ({n})', { n: c?.unassigned ?? 0 })}</option>
              {agents.data?.filter((a) => a.id !== me?.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-48"><option value="">{t('Tipo: Todos')}</option>{cats.data?.categories.map((x: any) => <option key={x.code} value={x.code}>{t(x.name)}</option>)}</Select>
          </div>
          {list.isLoading ? <div className="grid place-items-center py-10"><Spinner /></div> : !list.data?.items.length ? <Empty title={t('No hay reportes')} /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">{t('ID')}</th><th>{t('Asunto')}</th><th>{t('Usuario')}</th><th>{t('Prioridad')}</th><th>{t('Estado')}</th><th>{t('Responsable')}</th><th>{t('Última act.')}</th></tr></thead>
                <tbody className="divide-y divide-line">{list.data.items.map((r: any) => {
                  const [pl, pt] = PRIORITY[r.priority] ?? [r.priority, 'gray'];
                  return (
                    <tr key={r.id} onClick={() => setSel(r.id)} className={cn('cursor-pointer hover:bg-surface/70', sel === r.id && 'bg-brand-50/70')}>
                      <td className="px-5 py-3 font-bold">{r.code}</td><td><b className="line-clamp-1">{r.subject}</b><span className="text-xs text-muted">{t(r.category)}</span></td>
                      <td><b>{r.requester}</b><span className="block text-xs text-muted">{r.requesterType}</span></td><td><Badge tone={pt}>{pl}</Badge></td>
                      <td><StatusBadge status={r.status} label={t(r.statusLabel)} /></td><td className="text-muted">{r.assignee ?? t('Sin asignar')}</td><td className="text-muted">{relative(r.updatedAt)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              <Pagination page={page} pageSize={20} total={list.data.total} onPage={setPage} label={t('reportes')} />
            </div>
          )}
        </Card>
        <Card className="h-fit 2xl:sticky 2xl:top-24">
          {!sel ? <Empty title={t('Selecciona un reporte')} /> : !d ? <div className="grid place-items-center py-16"><Spinner /></div> : (
            <div>
              <div className="border-b border-line p-5">
                <div className="flex items-center justify-between"><p className="text-sm font-bold text-brand-700">{t('REPORTE #')}{d.code}</p><StatusBadge status={d.status} label={d.statusLabel} /></div>
                <p className="mt-1 text-xl font-extrabold">{d.subject}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><Badge tone={(PRIORITY[d.priority] ?? ['', 'gray'])[1]}>{t('Prioridad')}{' '}{(PRIORITY[d.priority] ?? [d.priority])[0].toLowerCase()}</Badge><Badge>{t(d.category)}</Badge>{d.platform && <Badge data-ticket-platform={d.platform}>{t(({ WEB: 'Computadora', MOBILE: 'Celular o tablet', OTHER: 'Otro' } as Record<string, string>)[d.platform] ?? d.platform)}</Badge>}<span className="text-muted">{fmtDateTime(d.createdAt)}</span></div>
              </div>
              <div className="border-b border-line p-5 text-sm">
                <p className="font-bold">{t('Reportado por')}</p>
                <div className="mt-2 flex items-center gap-3"><Avatar name={d.requester.name} /><span className="flex-1"><b>{d.requester.name}</b><span className="block text-xs text-muted">{d.requester.email} · {d.requester.type}</span></span>{d.requester.verified && <span className="text-xs text-muted">{t('Correo verificado')}</span>}</div>
                {d.orderNumber && <p className="mt-2 text-xs">{t('Pedido relacionado:')}{' '}<b>{d.orderNumber}</b></p>}
                {d.reportedUrl && <p className="mt-1 break-all text-xs">{t('Página afectada:')}{' '}<a href={d.reportedUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-700 underline">{d.reportedUrl}</a></p>}
                {d.client && <p className="mt-1 break-all text-xs text-muted" title={d.client}>{t('Navegador / dispositivo:')}{' '}{d.client.slice(0, 120)}</p>}
                {d.sla?.firstResponseDueAt && <p className="mt-1 text-xs text-muted">{t('Primera respuesta antes de:')}{' '}{fmtDateTime(d.sla.firstResponseDueAt)}</p>}
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto border-b border-line p-5 scrollbar-thin">
                <p className="font-bold">{t('Descripción y conversación')}</p>
                {d.messages.map((m: any) => (
                  <div key={m.id} className={cn('rounded-xl p-3 text-sm', m.staff ? 'bg-brand-50' : 'border border-line bg-surface/60')}>
                    <p className="text-xs font-bold">{m.staff ? `${m.author} (soporte)` : m.author} · {fmtDateTime(m.at)}</p>{!(m.attachments?.length && m.body.startsWith('📎')) && <p className="mt-1 whitespace-pre-line">{m.body}</p>}<AttachmentList base={`/support/conversations/${d.conversationId}/attachments`} items={m.attachments} />
                  </div>
                ))}
                {d.notes.map((n: any) => <div key={n.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><p className="text-xs font-bold">{t('Nota interna ·')}{' '}{n.author} · {fmtDateTime(n.created_at)}</p>{!(n.attachments?.length && n.body.startsWith('📎')) && <p className="mt-1">{n.body}</p>}<AttachmentList base={`/support/admin/notes/${n.id}/attachments`} items={n.attachments} /></div>)}
              </div>
              <div className="space-y-3 border-b border-line p-5 text-sm" data-ticket-times>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-surface p-3"><p className="flex items-center gap-1 text-xs text-muted"><Timer className="size-3.5" /> {t('Primera respuesta')}</p><p className="font-bold">{d.times?.firstResponseMinutes != null ? fmtMinutes(d.times.firstResponseMinutes) : t('Sin responder')}</p></div>
                  <div className="rounded-xl bg-surface p-3"><p className="flex items-center gap-1 text-xs text-muted"><Clock className="size-3.5" /> {d.times?.resolutionMinutes != null ? t('Tiempo de resolución') : t('Tiempo de atención')}</p><p className="font-bold">{fmtMinutes(d.times?.resolutionMinutes ?? d.times?.workingMinutes)}</p></div>
                  <div className="rounded-xl bg-surface p-3"><p className="text-xs text-muted">{t('Esperando al usuario (no cuenta)')}</p><p className="font-bold">{fmtMinutes(d.times?.waitingCustomerMinutes)}</p></div>
                </div>
                {d.rating && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3" data-ticket-rating>
                    <p className="flex items-center gap-2 font-bold">{t('Calificación del usuario')} <Stars value={d.rating.score} /></p>
                    {d.rating.comment && <p className="mt-1 whitespace-pre-line text-muted">{d.rating.comment}</p>}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 border-b border-line p-5 sm:grid-cols-3">
                <Field label={t('Responsable')}>
                  <div className="flex gap-2">
                    <Select value={d.assigneeId ?? ''} onChange={(e) => run('assign', () => post(`/support/admin/tickets/${d.id}/assign`, e.target.value ? { assigneeUserId: e.target.value } : { unassign: true }), t('Responsable actualizado.'))} data-ticket-assignee>
                      <option value="">{t('Sin asignar')}</option>
                      {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.id === me?.id ? t('Yo ({a})', { a: a.name }) : a.name}</option>)}
                    </Select>
                    {d.assigneeId !== me?.id && <Button size="sm" variant="outline" className="shrink-0" loading={busy === 'take'} onClick={() => run('take', () => post(`/support/admin/tickets/${d.id}/assign`, { assignToMe: true }), t('Ahora el reporte es tuyo.'))} data-take-ticket><Hand /> {t('Tomar')}</Button>}
                  </div>
                </Field>
                <Field label={t('Equipo')}>
                  <Select value={d.team?.code ?? ''} onChange={(e) => run('assign', () => post(`/support/admin/tickets/${d.id}/assign`, { teamCode: e.target.value, ...(d.assigneeId ? { assigneeUserId: d.assigneeId } : { unassign: true }) }), t('Reporte asignado.'))}>
                    <option value="" disabled>{t('Selecciona equipo')}</option>{cats.data?.teams.map((x: any) => <option key={x.code} value={x.code}>{x.name}</option>)}
                  </Select>
                </Field>
                <Field label={t('Cambiar estado')}>
                  <Select value={d.status} onChange={(e) => run('status', () => post(`/support/admin/tickets/${d.id}/status`, { status: e.target.value }), 'Estado actualizado.')}>
                    {['OPEN', 'IN_PROGRESS', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED', 'CANCELLED'].map((s) => <option key={s} value={s}>{({ OPEN: t('Pendiente'), IN_PROGRESS: t('En proceso'), PENDING_CUSTOMER: t('Esperando usuario'), PENDING_INTERNAL: t('Revisión interna'), RESOLVED: t('Resuelto'), CLOSED: t('Cerrado'), CANCELLED: t('Cancelado') } as any)[s]}</option>)}
                  </Select>
                </Field>
              </div>
              {d.history.length > 0 && (
                <div className="border-b border-line p-5 text-sm"><p className="font-bold">{t('Historial de seguimiento')}</p>
                  <ul className="mt-2 space-y-2">{d.history.map((h: any, i: number) => <li key={i} className="flex gap-2"><span className="mt-1.5 size-2 rounded-full bg-brand-600" /><span><b>{h.toLabel}</b> <span className="text-xs text-muted">{fmtDateTime(h.at)} · {h.actor ?? t('Sistema')}</span>{h.reason && <span className="block text-xs text-muted">{h.reason}</span>}</span></li>)}</ul>
                </div>
              )}
              <div className="p-5">
                <div className="flex gap-4 border-b border-line text-sm">
                  {[['reply', t('Responder al usuario')], ['note', t('Nota interna')]].map(([v, l]) => <button key={v} onClick={() => setMode(v as any)} className={cn('-mb-px border-b-2 pb-2 font-semibold', mode === v ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted')}>{l}</button>)}
                </div>
                <Textarea rows={3} className="mt-3" value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'reply' ? t('Escribe una respuesta para {a}…', { a: d.requester.name }) : t('Nota visible solo para el equipo…')} />
                <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                  <FilePicker files={files} onChange={setFiles} label={t('Adjuntar archivos')} />
                  <Button onClick={() => run('reply', async () => { const r = await upload(`/support/admin/tickets/${d.id}/reply`, formWith({ body: text.trim(), internal: mode === 'note' ? 'true' : 'false' }, files)); setText(''); setFiles([]); return r; }, mode === 'reply' ? 'Respuesta enviada.' : 'Nota guardada.')} loading={busy === 'reply'} disabled={!text.trim() && !files.length}><Send /> {mode === 'reply' ? t('Enviar respuesta') : t('Guardar nota')}</Button>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Button variant="danger" onClick={() => run('esc', () => post(`/support/admin/tickets/${d.id}/assign`, { teamCode: 'MODERATION', assignToMe: false }), t('Escalado a moderación.'))}><ArrowUpRight /> {t('Escalar')}</Button>
                  <Button variant="outline" onClick={() => tk.refetch()}><RotateCcw /> {t('Actualizar')}</Button>
                  <Button onClick={() => run('resolve', () => post(`/support/admin/tickets/${d.id}/status`, { status: 'RESOLVED' }), 'Marcado como resuelto.')} disabled={['RESOLVED', 'CLOSED'].includes(d.status)}><CheckCircle2 /> {t('Marcar resuelto')}</Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
