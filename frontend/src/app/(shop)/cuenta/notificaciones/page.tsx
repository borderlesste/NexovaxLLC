'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Mail, Smartphone, X } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, post, put } from '@/lib/api';
import { t } from '@/lib/i18n';
import { cn, fmtDateTime, relative } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Empty, PageLoader, Pills, Switch } from '@/components/ui/misc';
import { CATEGORY_ICON, CATEGORY_TONE, type Notice } from '@/components/notifications/notification-bell';

const CATEGORIES = [
  ['', 'Todas'], ['ORDERS', 'Pedidos'], ['MESSAGES', 'Mensajes'], ['RETURNS', 'Devoluciones'], ['PAYMENTS', 'Pagos'], ['SUPPORT', 'Soporte'], ['STORE', 'Mi tienda'], ['ACCOUNT', 'Cuenta'],
] as const;

function NotificationsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = sp.get('tab') === 'preferencias' ? 'prefs' : 'list';
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-extrabold">{t('Notificaciones')}</h1><p className="text-muted">{t('Avisos de tus pedidos, mensajes, devoluciones y pagos.')}</p></div>
      </div>
      <div className="mt-5 flex gap-6 border-b border-line text-sm">
        {[['list', t('Bandeja')], ['prefs', t('Preferencias')]].map(([v, l]) => (
          <button key={v} onClick={() => router.replace(v === 'prefs' ? '?tab=preferencias' : '?', { scroll: false })} className={cn('-mb-px border-b-2 pb-2 font-semibold', tab === v ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted')}>{l}</button>
        ))}
      </div>
      {tab === 'list' ? <Inbox /> : <Preferences />}
    </div>
  );
}

function Inbox() {
  const qc = useQueryClient();
  const router = useRouter();
  const [category, setCategory] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'page', category, unreadOnly],
    initialPageParam: '',
    queryFn: ({ pageParam }) => get<{ items: Notice[]; hasMore: boolean; unread: number }>(`/me/notifications?limit=20${category ? `&category=${category}` : ''}${unreadOnly ? '&unread=true' : ''}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => (last.hasMore ? last.items[last.items.length - 1]?.createdAt : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = q.data?.pages[0]?.unread ?? 0;
  const done = (r?: { unread: number }) => {
    if (r) qc.setQueryData(['notifications-count'], { unread: r.unread });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const act = async (fn: () => Promise<any>) => {
    try {
      done(await fn());
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pills value={category} onChange={setCategory} options={CATEGORIES.map(([v, l]) => ({ value: v, label: t(l) }))} />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><Switch checked={unreadOnly} onCheckedChange={setUnreadOnly} /> {t('Solo no leídas')}</label>
          <Button variant="outline" size="sm" disabled={!unread} onClick={() => act(() => post('/me/notifications/read', { all: true }))}><CheckCheck /> {t('Marcar todo como leído')}</Button>
        </div>
      </div>
      <div className="card mt-4">
        {q.isLoading ? <PageLoader /> : !items.length ? (
          <Empty icon={<Bell />} title={t('No tienes notificaciones')} description={t('Aquí verás los avisos de tus compras, ventas y mensajes.')} />
        ) : (
          <ul className="divide-y divide-line" data-notification-list>
            {items.map((n) => {
              const Icon = CATEGORY_ICON[n.category] ?? Bell;
              return (
                <li key={n.id} className={cn('group flex gap-4 p-4', !n.read && 'bg-brand-50/40')} data-notice>
                  <span className={cn('grid size-10 shrink-0 place-items-center rounded-full', CATEGORY_TONE[n.category])}><Icon className="size-5" /></span>
                  <button className="min-w-0 flex-1 text-left" onClick={() => act(async () => { const r = n.read ? undefined : await post('/me/notifications/read', { ids: [n.id] }); if (n.url) router.push(n.url); return r; })}>
                    <p className={cn('text-sm', !n.read ? 'font-bold' : 'font-semibold')}>{n.title}</p>
                    {n.body && <p className="text-sm text-muted">{n.body}</p>}
                    <p className="mt-1 text-xs text-muted" title={fmtDateTime(n.createdAt)}>{relative(n.createdAt)}</p>
                  </button>
                  <div className="flex items-start gap-1">
                    {!n.read && <button onClick={() => act(() => post('/me/notifications/read', { ids: [n.id] }))} className="rounded-md p-1.5 text-muted hover:bg-white hover:text-ink" title={t('Marcar como leída')} aria-label={t('Marcar como leída')}><CheckCheck className="size-4" /></button>}
                    <button onClick={() => act(() => del(`/me/notifications/${n.id}`))} className="rounded-md p-1.5 text-muted hover:bg-white hover:text-red-600" title={t('Descartar')} aria-label={t('Descartar')}><X className="size-4" /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {q.hasNextPage && <div className="border-t border-line p-3 text-center"><Button variant="ghost" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>{t('Cargar más')}</Button></div>}
      </div>
    </div>
  );
}

function Preferences() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notification-prefs'], queryFn: () => get<any[]>('/me/notifications/preferences') });
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setRows(q.data); }, [q.data]);
  if (q.isLoading) return <PageLoader />;
  const dirty = JSON.stringify(rows) !== JSON.stringify(q.data);
  const save = async () => {
    setBusy(true);
    try {
      const r = await put('/me/notifications/preferences', { preferences: rows.filter((x) => x.configurable).map(({ code, inApp, email }) => ({ code, inApp, email })) });
      qc.setQueryData(['notification-prefs'], r);
      toast.success(t('Preferencias guardadas.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (code: string, k: 'inApp' | 'email', v: boolean) => setRows((r) => r.map((x) => (x.code === code ? { ...x, [k]: v } : x)));
  return (
    <div className="card mt-5">
      <div className="grid grid-cols-[1fr_90px_90px] items-center gap-2 border-b border-line px-5 py-3 text-xs font-bold uppercase tracking-wide text-muted">
        <span>{t('Categoría')}</span><span className="flex items-center justify-center gap-1"><Smartphone className="size-3.5" /> {t('En la web')}</span><span className="flex items-center justify-center gap-1"><Mail className="size-3.5" /> {t('Correo')}</span>
      </div>
      <ul className="divide-y divide-line" data-prefs>
        {rows.map((r) => {
          const Icon = CATEGORY_ICON[r.code] ?? Bell;
          return (
            <li key={r.code} className="grid grid-cols-[1fr_90px_90px] items-center gap-2 px-5 py-4" data-pref={r.code}>
              <div className="flex gap-3">
                <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', CATEGORY_TONE[r.code])}><Icon className="size-4" /></span>
                <div><p className="font-semibold">{t(r.name)}</p><p className="text-sm text-muted">{t(r.description)}{!r.configurable && ` ${t('(siempre activas por seguridad)')}`}</p></div>
              </div>
              <div className="flex justify-center"><Switch checked={r.inApp} disabled={!r.configurable} onCheckedChange={(v) => set(r.code, 'inApp', v)} /></div>
              <div className="flex justify-center"><Switch checked={r.email} disabled={!r.configurable} onCheckedChange={(v) => set(r.code, 'email', v)} /></div>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2 border-t border-line p-4">
        <Button variant="outline" disabled={!dirty} onClick={() => setRows(q.data ?? [])}>{t('Descartar cambios')}</Button>
        <Button onClick={save} loading={busy} disabled={!dirty}>{t('Guardar preferencias')}</Button>
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  return <Suspense fallback={<PageLoader />}><NotificationsInner /></Suspense>;
}
