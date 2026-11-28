'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Flag, Package } from 'lucide-react';
import { get } from '@/lib/api';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** Switch between the two moderation queues: products and reported chat messages. */
export function ModerationTabs({ active }: { active: 'products' | 'messages' }) {
  const count = useQuery({ queryKey: ['chat-reports-count'], queryFn: () => get<{ open: number }>('/admin/chat-reports/count'), refetchInterval: 60_000 });
  const tabs = [
    { key: 'products', href: '/admin/moderacion', label: t('Productos'), icon: Package, n: null as number | null },
    { key: 'messages', href: '/admin/moderacion/mensajes', label: t('Mensajes reportados'), icon: Flag, n: count.data?.open || null },
  ];
  return (
    <nav className="mb-5 flex gap-2" data-moderation-tabs>
      {tabs.map(({ key, href, label, icon: I, n }) => (
        <Link key={key} href={href} className={cn('flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition', active === key ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line bg-white hover:bg-surface')}>
          <I className="size-4" /> {label}
          {n ? <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white">{n}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
