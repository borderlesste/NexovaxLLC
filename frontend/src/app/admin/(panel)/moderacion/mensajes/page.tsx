'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Eye, EyeOff, Flag, MessageSquare, Search, ShieldAlert, Store, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { cn, fmtDate, fmtDateTime, relative } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Empty, Pagination, Segmented, Spinner } from '@/components/ui/misc';
import { reportReasonLabel } from '@/components/messaging/chat-safety';
import { ModerationTabs } from '../tabs';
import { t } from '@/lib/i18n';

const ACTION_LABEL: Record<string, string> = {
  NONE: 'Descartado',
  HIDE_MESSAGE: 'Mensaje oculto',
  RESTRICT_USER: 'Cuenta restringida',
  HIDE_AND_RESTRICT: 'Oculto y cuenta restringida',
};

function ChatReports() {
  const sp = useSearchParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState('OPEN');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(sp.get('m'));
  const [note, setNote] = useState('');
  const [days, setDays] = useState<number | ''>('');
  const [busy, setBusy] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['chat-reports', tab, search, page], queryFn: () => get(`/admin/chat-reports?status=${tab}&search=${encodeURIComponent(search)}&page=${page}`) });
  useEffect(() => {
    if (!selected && list.data?.items[0] && tab === 'OPEN') setSelected(list.data.items[0].messageId);
  }, [list.data, selected, tab]);
  const detail = useQuery({ queryKey: ['chat-report', selected], queryFn: () => get(`/admin/chat-reports/${selected}`), enabled: !!selected });
  const d = detail.data;
  useEffect(() => { setNote(''); setDays(''); }, [selected]);
  const refresh = (data?: any) => {
    if (data) qc.setQueryData(['chat-report', selected], data);
    qc.invalidateQueries({ queryKey: ['chat-reports'] });
    qc.invalidateQueries({ queryKey: ['chat-reports-count'] });
  };
  const run = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try {
      const data = await fn();
      toast.success(ok);
      refresh(data?.messageId ? data : undefined);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const resolve = (action: string) =>
    run(action, () => post(`/admin/chat-reports/${selected}/resolve`, { action, note: note.trim() || undefined, days: days || undefined }), action === 'DISMISS' ? t('Reportes descartados.') : t('Decisión guardada.'));
  const c = list.data?.counts;
  const open = d?.reports?.some((r: any) => r.status === 'OPEN');
  return (
    <>
      <PageHeader crumbs={[{ label: t('Panel') }, { label: t('Moderación') }]} title={t('Mensajes reportados')} description={t('Revisa los mensajes del chat que compradores y tiendas reportaron, y decide qué hacer con ellos.')} />
      <ModerationTabs active="messages" />
      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label={t('Por revisar')} value={c?.open ?? '—'} icon={<Flag />} />
            <StatCard label={t('Con medidas hoy')} value={c?.actioned_today ?? '—'} icon={<ShieldAlert />} tone="red" />
            <StatCard label={t('Cuentas restringidas')} value={c?.restricted ?? '—'} icon={<Ban />} tone="amber" />
          </div>
          <Card>
            <Segmented className="px-3" value={tab} onChange={(v) => { setTab(v); setPage(1); setSelected(null); }} options={[
              { value: 'OPEN', label: t('Por revisar'), count: c?.open }, { value: 'ACTION_TAKEN', label: t('Con medidas') }, { value: 'DISMISSED', label: t('Descartados') },
            ]} />
            <div className="p-4"><Input icon={<Search />} placeholder={t('Buscar por texto, persona o tienda...')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" /></div>
            {list.isLoading ? <div className="grid place-items-center py-10"><Spinner /></div> : list.isError ? <p className="p-5 text-sm text-red-600">{errorMessage(list.error)}</p> : !list.data?.items.length ? <Empty icon={<MessageSquare />} title={t('No hay mensajes en esta cola')} /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm" data-chat-reports>
                  <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">{t('Mensaje')}</th><th>{t('Enviado por')}</th><th>{t('Motivos')}</th><th>{t('Reportes')}</th><th>{t('Último reporte')}</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {list.data.items.map((r: any) => (
                      <tr key={r.messageId} onClick={() => setSelected(r.messageId)} className={cn('cursor-pointer hover:bg-surface/70', selected === r.messageId && 'bg-brand-50/70')}>
                        <td className="max-w-[280px] px-5 py-3"><p className="line-clamp-2">{r.body}</p>{r.hidden && <Badge tone="amber" className="mt-1">{t('Oculto')}</Badge>}</td>
                        <td><span className="flex items-center gap-1">{r.sender.side === 'SELLER' ? <Store className="size-4 text-muted" /> : <User className="size-4 text-muted" />} {r.sender.side === 'SELLER' ? r.store : r.sender.name}</span></td>
                        <td className="text-xs text-muted">{r.reasons.map(reportReasonLabel).join(', ')}</td>
                        <td><b>{r.reports}</b></td>
                        <td className="text-muted">{relative(r.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination page={page} pageSize={20} total={list.data.total} onPage={setPage} label={t('mensajes')} />
              </div>
            )}
          </Card>
        </div>
        <Card className="h-fit 2xl:sticky 2xl:top-24">
          {!selected ? <Empty icon={<Flag />} title={t('Selecciona un mensaje')} description={t('Elige un mensaje de la lista para revisarlo.')} /> : !d ? <div className="grid place-items-center py-16"><Spinner /></div> : (
            <div data-chat-report-detail>
              <div className="flex items-start justify-between border-b border-line px-5 py-4">
                <div><p className="text-lg font-bold">{t('Revisión del mensaje')}</p><p className="text-xs text-muted">{d.subject} · {d.store?.name} · {d.customer?.name}</p></div>
                <button onClick={() => setSelected(null)} aria-label={t('Cerrar')}><X className="size-5 text-muted" /></button>
              </div>
              <div className="space-y-5 p-5 text-sm">
                <div>
                  <p className="mb-2 font-bold">{t('Conversación')}</p>
                  <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-line bg-surface/50 p-3">
                    {d.context.map((m: any) => (
                      <div key={m.id} className={cn('flex', m.fromCustomer ? 'justify-start' : 'justify-end')}>
                        <div className={cn('max-w-[85%] rounded-xl px-3 py-2', m.reported ? 'border-2 border-red-400 bg-red-50' : 'border border-line bg-white', m.removed && 'italic text-muted')}>
                          <p className="text-[11px] font-semibold text-muted">{m.fromCustomer ? d.customer?.name : d.store?.name} · {fmtDateTime(m.sentAt)}</p>
                          <p className="whitespace-pre-line break-words">{m.body}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {d.hidden && <p className="mt-2 text-xs text-amber-700">{d.hiddenSource === 'AUTO_REPORTS' ? t('Oculto automáticamente por la cantidad de reportes, hasta que decidas.') : t('Oculto por un moderador.')}</p>}
                </div>
                <div>
                  <p className="mb-2 font-bold">{t('Reportes')} ({d.reports.length})</p>
                  <ul className="divide-y divide-line rounded-xl border border-line">
                    {d.reports.map((r: any) => (
                      <li key={r.id} className="px-3 py-2.5">
                        <p className="flex flex-wrap items-center gap-2"><b>{reportReasonLabel(r.reason)}</b> <span className="text-xs text-muted">{r.reporter} · {fmtDateTime(r.createdAt)}</span>{r.status !== 'OPEN' && <Badge tone={r.status === 'DISMISSED' ? 'gray' : 'red'}>{t(ACTION_LABEL[r.resolution] ?? r.status)}</Badge>}</p>
                        {r.details && <p className="mt-1 whitespace-pre-line text-muted">{r.details}</p>}
                        {r.note && <p className="mt-1 text-xs text-muted">{t('Decisión de {a}:', { a: r.moderator ?? '—' })} {r.note}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-line p-3">
                  <p className="font-bold">{t('Quién lo envió')}</p>
                  <p className="mt-1">{d.sender.side === 'SELLER' ? t('Tienda {a}', { a: d.store?.name }) : t('Cliente')} · {d.sender.name} <span className="text-muted">({d.sender.email})</span></p>
                  {d.sender.history && <p className="mt-1 text-xs text-muted">{t('Mensajes reportados: {a} · con medidas: {b} · restricciones anteriores: {c}', { a: d.sender.history.reported_messages, b: d.sender.history.actioned, c: d.sender.history.restrictions })}</p>}
                  {d.sender.restrictedUntil && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                      <Ban className="size-4" /> {t('No puede enviar mensajes hasta el {d}.', { d: fmtDate(d.sender.restrictedUntil) })}
                      <Button size="sm" variant="outline" className="ml-auto" loading={busy === 'lift'} onClick={() => run('lift', () => post(`/admin/messaging-restrictions/${d.sender.restrictionId}/lift`).then(() => detail.refetch().then((x) => x.data)), t('Restricción levantada.'))}>{t('Levantar restricción')}</Button>
                    </div>
                  )}
                </div>
                {open ? (
                  <div className="space-y-3">
                    <Field label={t('Motivo de la decisión')} hint={t('Obligatorio para ocultar o restringir. La persona restringida recibe un aviso sin este texto.')}>
                      <Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Ej.: pide pagar por fuera de la plataforma')} />
                    </Field>
                    <Field label={t('Días sin poder enviar mensajes')} hint={t('Por defecto {n} días (Admin → Configuración → Seguridad).', { n: d.defaultRestrictionDays })}>
                      <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value ? Math.min(365, Math.max(1, Number(e.target.value))) : '')} placeholder={String(d.defaultRestrictionDays)} className="max-w-[140px]" />
                    </Field>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Button variant="outline" onClick={() => resolve('DISMISS')} loading={busy === 'DISMISS'} data-resolve="DISMISS"><Check /> {t('Descartar (no infringe)')}</Button>
                      <Button variant="outline" onClick={() => resolve('HIDE_MESSAGE')} loading={busy === 'HIDE_MESSAGE'} data-resolve="HIDE_MESSAGE"><EyeOff /> {t('Ocultar mensaje')}</Button>
                      <Button variant="outline" onClick={() => resolve('RESTRICT_USER')} loading={busy === 'RESTRICT_USER'} data-resolve="RESTRICT_USER"><Ban /> {t('Restringir cuenta')}</Button>
                      <Button variant="danger" onClick={() => resolve('HIDE_AND_RESTRICT')} loading={busy === 'HIDE_AND_RESTRICT'} data-resolve="HIDE_AND_RESTRICT"><ShieldAlert /> {t('Ocultar y restringir')}</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" loading={busy === 'vis'} onClick={() => run('vis', () => post(`/admin/chat-messages/${d.messageId}/visibility`, { hidden: !d.hidden }), d.hidden ? t('El mensaje vuelve a ser visible.') : t('Mensaje oculto.'))}>
                    {d.hidden ? <><Eye /> {t('Mostrar mensaje')}</> : <><EyeOff /> {t('Ocultar mensaje')}</>}
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense><ChatReports /></Suspense>;
}
