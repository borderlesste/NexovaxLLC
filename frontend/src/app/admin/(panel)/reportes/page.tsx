'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Check, CheckCircle2, Clock, FileText, RotateCcw, Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { cn, fmtDateTime, relative } from '@/lib/utils';
import { PRIORITY } from '@/lib/status';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Avatar, Empty, Pagination, Segmented, Spinner } from '@/components/ui/misc';

export default function ReportsAdminPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const cats = useQuery({ queryKey: ['support-catalogs'], queryFn: () => get('/support/catalogs'), staleTime: Infinity });
  const list = useQuery({ queryKey: ['tickets', status, priority, category, search, page], queryFn: () => get(`/support/admin/tickets?status=${status}&priority=${priority}&category=${category}&search=${encodeURIComponent(search)}&page=${page}`), refetchInterval: 30_000 });
  useEffect(() => { if (!sel && list.data?.items[0]) setSel(list.data.items[0].id); }, [list.data, sel]);
  const t = useQuery({ queryKey: ['ticket', sel], queryFn: () => get(`/support/admin/tickets/${sel}`), enabled: !!sel });
  const c = list.data?.counts;
  const apply = (data: any) => { qc.setQueryData(['ticket', sel], data); qc.invalidateQueries({ queryKey: ['tickets'] }); qc.invalidateQueries({ queryKey: ['admin-attention'] }); };
  const run = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try { apply(await fn()); toast.success(ok); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  const d = t.data;
  return (
    <>
      <PageHeader crumbs={[{ label: 'Panel' }, { label: 'Soporte' }, { label: 'Reportes y problemas' }]} title="Seguimiento de problemas reportados" description="Revisa, asigna y resuelve las incidencias notificadas por usuarios de la plataforma." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total de reportes" value={c?.total ?? '—'} icon={<FileText />} hint="Reportes registrados" />
        <StatCard label="Pendientes" value={c?.pending ?? '—'} icon={<Clock />} tone="amber" hint={`${c?.critical ?? 0} de prioridad crítica`} />
        <StatCard label="En proceso" value={c?.in_progress ?? '—'} icon={<RotateCcw />} hint="Asignados al equipo" />
        <StatCard label="Resueltos" value={c?.resolved ?? '—'} icon={<Check />} tone="green" hint="Casos finalizados" />
      </div>
      <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <div className="px-5 pt-4"><p className="text-lg font-bold">Bandeja de reportes</p></div>
          <Segmented className="px-3" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: '', label: 'Todos', count: c?.total }, { value: 'OPEN', label: 'Pendientes', count: c?.pending }, { value: 'IN_PROGRESS_ALL', label: 'En proceso', count: c?.in_progress }, { value: 'DONE', label: 'Resueltos', count: c?.resolved }]} />
          <div className="flex flex-wrap gap-3 p-4">
            <Input icon={<Search />} placeholder="Buscar por ID, asunto o usuario..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
            <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-40"><option value="">Prioridad: Todas</option><option value="CRITICAL">Crítica</option><option value="HIGH">Alta</option><option value="NORMAL">Media</option><option value="LOW">Baja</option></Select>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-48"><option value="">Tipo: Todos</option>{cats.data?.categories.map((x: any) => <option key={x.code} value={x.code}>{x.name}</option>)}</Select>
          </div>
          {list.isLoading ? <div className="grid place-items-center py-10"><Spinner /></div> : !list.data?.items.length ? <Empty title="No hay reportes" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">ID</th><th>Asunto</th><th>Usuario</th><th>Prioridad</th><th>Estado</th><th>Responsable</th><th>Última act.</th></tr></thead>
                <tbody className="divide-y divide-line">{list.data.items.map((r: any) => {
                  const [pl, pt] = PRIORITY[r.priority] ?? [r.priority, 'gray'];
                  return (
                    <tr key={r.id} onClick={() => setSel(r.id)} className={cn('cursor-pointer hover:bg-surface/70', sel === r.id && 'bg-brand-50/70')}>
                      <td className="px-5 py-3 font-bold">{r.code}</td><td><b className="line-clamp-1">{r.subject}</b><span className="text-xs text-muted">{r.category}</span></td>
                      <td><b>{r.requester}</b><span className="block text-xs text-muted">{r.requesterType}</span></td><td><Badge tone={pt}>{pl}</Badge></td>
                      <td><StatusBadge status={r.status} label={r.statusLabel} /></td><td className="text-muted">{r.assignee ?? 'Sin asignar'}</td><td className="text-muted">{relative(r.updatedAt)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              <Pagination page={page} pageSize={20} total={list.data.total} onPage={setPage} label="reportes" />
            </div>
          )}
        </Card>
        <Card className="h-fit 2xl:sticky 2xl:top-24">
          {!sel ? <Empty title="Selecciona un reporte" /> : !d ? <div className="grid place-items-center py-16"><Spinner /></div> : (
            <div>
              <div className="border-b border-line p-5">
                <div className="flex items-center justify-between"><p className="text-sm font-bold text-brand-700">REPORTE #{d.code}</p><StatusBadge status={d.status} label={d.statusLabel} /></div>
                <p className="mt-1 text-xl font-extrabold">{d.subject}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><Badge tone={(PRIORITY[d.priority] ?? ['', 'gray'])[1]}>Prioridad {(PRIORITY[d.priority] ?? [d.priority])[0].toLowerCase()}</Badge><Badge>{d.category}</Badge><span className="text-muted">{fmtDateTime(d.createdAt)}</span></div>
              </div>
              <div className="border-b border-line p-5 text-sm">
                <p className="font-bold">Reportado por</p>
                <div className="mt-2 flex items-center gap-3"><Avatar name={d.requester.name} /><span className="flex-1"><b>{d.requester.name}</b><span className="block text-xs text-muted">{d.requester.email} · {d.requester.type}</span></span>{d.requester.verified && <span className="text-xs text-muted">Correo verificado</span>}</div>
                {d.orderNumber && <p className="mt-2 text-xs">Pedido relacionado: <b>{d.orderNumber}</b></p>}
                {d.sla?.firstResponseDueAt && <p className="mt-1 text-xs text-muted">Primera respuesta antes de: {fmtDateTime(d.sla.firstResponseDueAt)}</p>}
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto border-b border-line p-5 scrollbar-thin">
                <p className="font-bold">Descripción y conversación</p>
                {d.messages.map((m: any) => (
                  <div key={m.id} className={cn('rounded-xl p-3 text-sm', m.staff ? 'bg-brand-50' : 'border border-line bg-surface/60')}>
                    <p className="text-xs font-bold">{m.staff ? `${m.author} (soporte)` : m.author} · {fmtDateTime(m.at)}</p><p className="mt-1 whitespace-pre-line">{m.body}</p>
                  </div>
                ))}
                {d.notes.map((n: any) => <div key={n.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><p className="text-xs font-bold">Nota interna · {n.author} · {fmtDateTime(n.created_at)}</p><p className="mt-1">{n.body}</p></div>)}
              </div>
              <div className="grid gap-3 border-b border-line p-5 sm:grid-cols-2">
                <Field label="Asignar a">
                  <Select value={d.team?.code ?? ''} onChange={(e) => run('assign', () => post(`/support/admin/tickets/${d.id}/assign`, { teamCode: e.target.value, assignToMe: true }), 'Reporte asignado.')}>
                    <option value="" disabled>Selecciona equipo</option>{cats.data?.teams.map((x: any) => <option key={x.code} value={x.code}>{x.name}</option>)}
                  </Select>
                </Field>
                <Field label="Cambiar estado">
                  <Select value={d.status} onChange={(e) => run('status', () => post(`/support/admin/tickets/${d.id}/status`, { status: e.target.value }), 'Estado actualizado.')}>
                    {['OPEN', 'IN_PROGRESS', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED', 'CANCELLED'].map((s) => <option key={s} value={s}>{({ OPEN: 'Pendiente', IN_PROGRESS: 'En proceso', PENDING_CUSTOMER: 'Esperando usuario', PENDING_INTERNAL: 'Revisión interna', RESOLVED: 'Resuelto', CLOSED: 'Cerrado', CANCELLED: 'Cancelado' } as any)[s]}</option>)}
                  </Select>
                </Field>
              </div>
              {d.history.length > 0 && (
                <div className="border-b border-line p-5 text-sm"><p className="font-bold">Historial de seguimiento</p>
                  <ul className="mt-2 space-y-2">{d.history.map((h: any, i: number) => <li key={i} className="flex gap-2"><span className="mt-1.5 size-2 rounded-full bg-brand-600" /><span><b>{h.toLabel}</b> <span className="text-xs text-muted">{fmtDateTime(h.at)} · {h.actor ?? 'Sistema'}</span>{h.reason && <span className="block text-xs text-muted">{h.reason}</span>}</span></li>)}</ul>
                </div>
              )}
              <div className="p-5">
                <div className="flex gap-4 border-b border-line text-sm">
                  {[['reply', 'Responder al usuario'], ['note', 'Nota interna']].map(([v, l]) => <button key={v} onClick={() => setMode(v as any)} className={cn('-mb-px border-b-2 pb-2 font-semibold', mode === v ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted')}>{l}</button>)}
                </div>
                <Textarea rows={3} className="mt-3" value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'reply' ? `Escribe una respuesta para ${d.requester.name}…` : 'Nota visible solo para el equipo…'} />
                <div className="mt-3 flex justify-end"><Button onClick={() => run('reply', async () => { const r = await post(`/support/admin/tickets/${d.id}/reply`, { body: text, internal: mode === 'note' }); setText(''); return r; }, mode === 'reply' ? 'Respuesta enviada.' : 'Nota guardada.')} loading={busy === 'reply'} disabled={!text.trim()}><Send /> {mode === 'reply' ? 'Enviar respuesta' : 'Guardar nota'}</Button></div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <Button variant="danger" onClick={() => run('esc', () => post(`/support/admin/tickets/${d.id}/assign`, { teamCode: 'MODERATION', assignToMe: false }), 'Escalado a moderación.')}><ArrowUpRight /> Escalar</Button>
                  <Button variant="outline" onClick={() => t.refetch()}><RotateCcw /> Actualizar</Button>
                  <Button onClick={() => run('resolve', () => post(`/support/admin/tickets/${d.id}/status`, { status: 'RESOLVED' }), 'Marcado como resuelto.')} disabled={['RESOLVED', 'CLOSED'].includes(d.status)}><CheckCircle2 /> Marcar resuelto</Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
