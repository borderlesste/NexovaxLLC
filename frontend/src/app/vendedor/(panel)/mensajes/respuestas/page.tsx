'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Clock, MessageSquareText, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Checkbox, Dialog, Empty, ErrorBox, Spinner, Switch } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

type Reply = { id: string; title: string; body: string };
type Range = { day: number; open: string; close: string };
const DAYS = [1, 2, 3, 4, 5, 6, 0];
const dayName = (d: number) => [t('Domingo'), t('Lunes'), t('Martes'), t('Miércoles'), t('Jueves'), t('Viernes'), t('Sábado')][d];

function SavedReplies() {
  const { seller } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['saved-replies', seller?.id], queryFn: () => get<{ max: number; items: Reply[] }>('/seller/saved-replies'), enabled: !!seller });
  const [dlg, setDlg] = useState<Partial<Reply> | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['saved-replies'] });
  const save = async () => {
    if (!dlg?.title?.trim() || !dlg.body?.trim()) return;
    setBusy(true);
    try {
      const body = { title: dlg.title.trim(), body: dlg.body.trim() };
      dlg.id ? await put(`/seller/saved-replies/${dlg.id}`, body) : await post('/seller/saved-replies', body);
      toast.success(t('Respuesta guardada.'));
      setDlg(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (r: Reply) => {
    if (!window.confirm(t('¿Borrar la respuesta «{a}»?', { a: r.title }))) return;
    try { await del(`/seller/saved-replies/${r.id}`); toast.success(t('Respuesta borrada.')); refresh(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const move = async (i: number, dir: -1 | 1) => {
    const items = [...(q.data?.items ?? [])];
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    qc.setQueryData(['saved-replies', seller?.id], { ...q.data, items });
    try { await post('/seller/saved-replies/order', { ids: items.map((x) => x.id) }); } catch (e) { toast.error(errorMessage(e)); refresh(); }
  };
  const items = q.data?.items ?? [];
  const full = q.data ? items.length >= q.data.max : false;
  return (
    <div className="card p-6" data-saved-replies>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><MessageSquareText className="size-5 text-brand-600" /> {t('Respuestas guardadas')}</h2>
          <p className="mt-1 text-sm text-muted">{t('Textos que usas a menudo (envíos, tallas, garantía). En el chat los insertas con un clic. Escribe {cliente} para poner el nombre del cliente.')}</p>
        </div>
        <Button size="sm" onClick={() => setDlg({ title: '', body: '' })} disabled={full || !q.data} data-new-reply><Plus /> {t('Nueva respuesta')}</Button>
      </div>
      {q.isLoading ? <div className="grid place-items-center py-8"><Spinner /></div> : q.isError ? <div className="mt-4"><ErrorBox message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div> : !items.length ? (
        <div className="mt-4"><Empty icon={<MessageSquareText />} title={t('Aún no tienes respuestas guardadas')} description={t('Crea la primera para contestar más rápido.')} /></div>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {items.map((r, i) => (
            <li key={r.id} className="flex items-start gap-3 p-3 text-sm">
              <div className="flex flex-col">
                <button type="button" className="rounded p-0.5 text-muted hover:bg-surface disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Subir')}><ArrowUp className="size-4" /></button>
                <button type="button" className="rounded p-0.5 text-muted hover:bg-surface disabled:opacity-30" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={t('Bajar')}><ArrowDown className="size-4" /></button>
              </div>
              <div className="min-w-0 flex-1"><p className="font-semibold">{r.title}</p><p className="line-clamp-2 whitespace-pre-line text-muted">{r.body}</p></div>
              <Button size="sm" variant="ghost" onClick={() => setDlg(r)} aria-label={t('Editar')}><Pencil /></Button>
              <Button size="sm" variant="ghost" onClick={() => remove(r)} aria-label={t('Borrar')}><Trash2 /></Button>
            </li>
          ))}
        </ul>
      )}
      {q.data && <p className="mt-2 text-xs text-muted">{t('{a} de {b} respuestas.', { a: items.length, b: q.data.max })}</p>}
      <Dialog open={!!dlg} onOpenChange={(o) => { if (!o) setDlg(null); }} title={dlg?.id ? t('Editar respuesta') : t('Nueva respuesta')}
        footer={<><Button variant="ghost" onClick={() => setDlg(null)}>{t('Cancelar')}</Button><Button onClick={save} loading={busy} disabled={!dlg?.title?.trim() || !dlg?.body?.trim()} data-save-reply><Save /> {t('Guardar')}</Button></>}>
        <div className="space-y-4">
          <Field label={t('Nombre corto')} required hint={t('Solo lo ves tú, para encontrarla rápido.')}><Input value={dlg?.title ?? ''} maxLength={60} onChange={(e) => setDlg({ ...dlg, title: e.target.value })} placeholder={t('Ej.: Tiempos de envío')} /></Field>
          <Field label={t('Texto de la respuesta')} required><Textarea rows={5} maxLength={2000} value={dlg?.body ?? ''} onChange={(e) => setDlg({ ...dlg, body: e.target.value })} placeholder={t('Hola {cliente}, enviamos en 24 horas hábiles…')} /></Field>
        </div>
      </Dialog>
    </div>
  );
}

function AutoReply() {
  const { seller } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['auto-reply', seller?.id], queryFn: () => get('/seller/auto-reply'), enabled: !!seller });
  const [form, setForm] = useState<{ enabled: boolean; mode: 'OUTSIDE_HOURS' | 'ALWAYS'; message: string; hours: Range[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data && !form) setForm({ enabled: q.data.enabled, mode: q.data.mode, message: q.data.message, hours: q.data.hours }); }, [q.data, form]);
  if (q.isLoading || (!form && !q.isError)) return <div className="card grid place-items-center p-10"><Spinner /></div>;
  if (q.isError || !form) return <div className="card p-6"><ErrorBox message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>;
  const rangeOf = (d: number) => form.hours.find((h) => h.day === d);
  const setDay = (d: number, r: Range | null) => setForm({ ...form, hours: [...form.hours.filter((h) => h.day !== d), ...(r ? [r] : [])] });
  const save = async () => {
    setBusy(true);
    try {
      const data = await put('/seller/auto-reply', form);
      qc.setQueryData(['auto-reply', seller?.id], data);
      setForm({ enabled: data.enabled, mode: data.mode, message: data.message, hours: data.hours });
      toast.success(t('Respuesta automática guardada.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card p-6" data-auto-reply>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><Clock className="size-5 text-brand-600" /> {t('Respuesta automática')}</h2>
          <p className="mt-1 text-sm text-muted">{t('Cuando un cliente escribe y la tienda está cerrada, recibe este mensaje al instante. Se envía como máximo una vez cada {n} horas por conversación.', { n: q.data.intervalHours })}</p>
        </div>
        <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
      </div>
      <div className={cn('mt-5 space-y-5', !form.enabled && 'opacity-60')}>
        <Field label={t('Mensaje')} required={form.enabled}>
          <Textarea rows={4} maxLength={1000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder={t('¡Gracias por escribirnos! Ahora estamos fuera de horario; te respondemos en cuanto abramos.')} />
        </Field>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" checked={form.mode === 'OUTSIDE_HOURS'} onChange={() => setForm({ ...form, mode: 'OUTSIDE_HOURS' })} /> {t('Responder solo fuera del horario de atención')}</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" checked={form.mode === 'ALWAYS'} onChange={() => setForm({ ...form, mode: 'ALWAYS' })} /> {t('Responder siempre (por ejemplo, durante vacaciones)')}</label>
        </div>
        {form.mode === 'OUTSIDE_HOURS' && (
          <div>
            <p className="text-sm font-semibold">{t('Horario de atención')}</p>
            <p className="mb-2 text-xs text-muted">{t('Zona horaria de la tienda: {a}. Ahora la tienda está {b}.', { a: q.data.timezone, b: q.data.openNow ? t('abierta') : t('cerrada') })}</p>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {DAYS.map((d) => {
                const r = rangeOf(d);
                return (
                  <li key={d} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" data-day={d}>
                    <Checkbox className="w-32" checked={!!r} onChange={(v) => setDay(d, v ? { day: d, open: '09:00', close: '18:00' } : null)} label={dayName(d)} />
                    {r ? (
                      <span className="flex items-center gap-2">
                        <Input type="time" value={r.open} onChange={(e) => setDay(d, { ...r, open: e.target.value })} className="h-9 w-28" aria-label={t('Abre')} />
                        <span className="text-muted">–</span>
                        <Input type="time" value={r.close} onChange={(e) => setDay(d, { ...r, close: e.target.value })} className="h-9 w-28" aria-label={t('Cierra')} />
                      </span>
                    ) : <span className="text-muted">{t('Cerrado')}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      <Button className="mt-5" onClick={save} loading={busy} data-save-auto-reply><Save /> {t('Guardar')}</Button>
    </div>
  );
}

export default function SellerRepliesPage() {
  return (
    <>
      <PageHeader crumbs={[{ label: t('Mi tienda') }, { label: t('Mensajes'), href: '/vendedor/mensajes' }, { label: t('Respuestas') }]} title={t('Respuestas rápidas')} description={t('Respuestas guardadas para el chat y el mensaje automático cuando la tienda está cerrada.')} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SavedReplies />
        <AutoReply />
      </div>
    </>
  );
}
