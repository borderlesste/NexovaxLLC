'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import { Bell, CheckCheck, CreditCard, Headphones, MessageSquare, Package, RotateCcw, Settings, Shield, Store } from 'lucide-react';
import { get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { cn, relative } from '@/lib/utils';

export const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  ORDERS: Package, MESSAGES: MessageSquare, RETURNS: RotateCcw, PAYMENTS: CreditCard, SUPPORT: Headphones, STORE: Store, ACCOUNT: Shield,
};
export const CATEGORY_TONE: Record<string, string> = {
  ORDERS: 'bg-brand-50 text-brand-600', MESSAGES: 'bg-violet-50 text-violet-600', RETURNS: 'bg-amber-50 text-amber-600', PAYMENTS: 'bg-emerald-50 text-emerald-600',
  SUPPORT: 'bg-sky-50 text-sky-600', STORE: 'bg-orange-50 text-orange-600', ACCOUNT: 'bg-slate-100 text-slate-600',
};

export interface Notice { id: string; category: string; eventType: string; title: string; body?: string | null; url?: string | null; read: boolean; createdAt: string }

/** Bell with the unread count and the latest notices (polls every 45 s). */
export function NotificationBell({ className, allHref = '/cuenta/notificaciones' }: { className?: string; allHref?: string }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const count = useQuery({ queryKey: ['notifications-count'], queryFn: () => get<{ unread: number }>('/me/notifications/unread-count'), enabled: !!me, refetchInterval: 45_000 });
  const list = useQuery({ queryKey: ['notifications', 'bell'], queryFn: () => get<{ items: Notice[]; unread: number }>('/me/notifications?limit=8'), enabled: !!me && open });
  if (!me) return null;
  const unread = list.data?.unread ?? count.data?.unread ?? 0;
  const refresh = (r?: { unread: number }) => {
    if (r) qc.setQueryData(['notifications-count'], { unread: r.unread });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const openNotice = async (n: Notice) => {
    setOpen(false);
    if (!n.read) refresh(await post('/me/notifications/read', { ids: [n.id] }).catch(() => undefined));
    if (n.url) router.push(n.url);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={cn('relative rounded-lg p-2 hover:bg-brand-50', className)} aria-label={t('Notificaciones')} data-bell>
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-white" data-bell-count>{unread > 99 ? '99+' : unread}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-xl border border-line bg-white shadow-xl" data-bell-panel>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-bold">{t('Notificaciones')}</p>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button onClick={async () => refresh(await post('/me/notifications/read', { all: true }))} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50">
                  <CheckCheck className="size-3.5" /> {t('Marcar todo como leído')}
                </button>
              )}
              <Link href={`${allHref}?tab=preferencias`} onClick={() => setOpen(false)} className="rounded-md p-1.5 text-muted hover:bg-surface" aria-label={t('Preferencias de notificación')}><Settings className="size-4" /></Link>
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
            {list.isLoading ? (
              <p className="p-6 text-center text-sm text-muted">{t('Cargando…')}</p>
            ) : !list.data?.items.length ? (
              <div className="p-8 text-center text-sm text-muted"><Bell className="mx-auto mb-2 size-8 text-line" />{t('No tienes notificaciones.')}</div>
            ) : (
              <ul className="divide-y divide-line">
                {list.data.items.map((n) => {
                  const Icon = CATEGORY_ICON[n.category] ?? Bell;
                  return (
                    <li key={n.id}>
                      <button onClick={() => openNotice(n)} className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-surface', !n.read && 'bg-brand-50/40')} data-notice>
                        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', CATEGORY_TONE[n.category])}><Icon className="size-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block text-sm', !n.read ? 'font-bold' : 'font-semibold')}>{n.title}</span>
                          {n.body && <span className="line-clamp-2 block text-xs text-muted">{n.body}</span>}
                          <span className="mt-0.5 block text-[11px] text-muted">{relative(n.createdAt)}</span>
                        </span>
                        {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-label={t('No leída')} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <Link href={allHref} onClick={() => setOpen(false)} className="block border-t border-line py-2.5 text-center text-sm font-semibold text-brand-700 hover:bg-surface">{t('Ver todas las notificaciones')}</Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
