'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bell, ChevronRight, HelpCircle, Home, Menu, Search, X } from 'lucide-react';
import { LogoMark } from './logo';
import { UserMenu } from './shop-header';
import { LanguageSwitcher } from './language-switcher';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number | null;
}

export function DashboardShell({ title, subtitle, nav, children, footer }: { title: string; subtitle: string; nav: NavItem[]; children: React.ReactNode; footer?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => setOpen(false), [pathname]);
  const sidebar = (
    <div className="flex h-full flex-col">
      <Link href="/" className="flex items-center gap-2.5 border-b border-line px-5 py-4">
        <LogoMark className="size-9" />
        <span className="leading-tight"><span className="block text-base font-extrabold">{t(title)}</span><span className="block text-xs text-muted">{t(subtitle)}</span></span>
      </Link>
      <p className="px-6 pb-2 pt-6 text-[11px] font-bold uppercase tracking-wider text-muted">{t('Menú principal')}</p>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 scrollbar-thin">
        {nav.map((n) => {
          const active = pathname === n.href || (n.href !== '/' && pathname.startsWith(n.href + '/')) || pathname === n.href;
          return (
            <Link key={n.href} href={n.href} className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition', active ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-surface')}>
              <n.icon className="size-[18px]" />
              <span className="flex-1">{t(n.label)}</span>
              {n.badge ? <span className="rounded-full bg-brand-100 px-2 text-[11px] font-bold leading-5 text-brand-700">{n.badge}</span> : null}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-3 border-t border-line p-4">
        {footer}
        <Link href="/ayuda" className="flex gap-2 rounded-xl bg-brand-50 p-3 text-sm">
          <HelpCircle className="size-5 shrink-0 text-brand-600" />
          <span><b className="block text-brand-800">{t('¿Necesitas ayuda?')}</b><span className="text-xs text-muted">{t('Centro de soporte y guías del marketplace.')}</span></span>
        </Link>
        <p className="px-1 text-[11px] text-muted">{t('NEXOVAX · Marketplace v1.0')}</p>
      </div>
    </div>
  );
  return (
    <div className="min-h-dvh bg-surface">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-line bg-white lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[270px] bg-white shadow-xl">{sidebar}</aside>
        </div>
      )}
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:px-8">
          <button className="rounded-lg p-2 hover:bg-surface lg:hidden" onClick={() => setOpen(true)} aria-label={t('Menú')}>{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
          <form className="relative hidden w-full max-w-sm md:block" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`${nav[1]?.href ?? pathname}?search=${encodeURIComponent(q.trim())}`); }}>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Buscar en el panel...')} className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
          </form>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/" className="hidden items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-surface sm:flex"><Home className="size-4" /> {t('Ir a la tienda')}</Link>
            <Link href={pathname.startsWith('/admin') ? '/admin/reportes' : '/vendedor/mensajes'} className="relative rounded-lg p-2 hover:bg-surface" aria-label={t('Notificaciones')}><Bell className="size-5" /></Link>
            <LanguageSwitcher />
            <span className="mx-1 h-8 w-px bg-line" />
            <UserMenu />
          </div>
        </header>
        <main className="px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ crumbs, title, description, actions }: { crumbs?: { label: string; href?: string }[]; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {crumbs && (
          <nav className="mb-1 flex items-center gap-1.5 text-xs text-muted">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="size-3" />}
                {c.href ? <Link href={c.href} className="hover:text-ink">{t(c.label)}</Link> : <span>{t(c.label)}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">{t(title)}</h1>
        {description && <p className="mt-1 text-sm text-muted">{t(description)}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
