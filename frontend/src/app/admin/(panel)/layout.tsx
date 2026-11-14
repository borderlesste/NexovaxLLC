'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Coins, Layers, LayoutGrid, Lock, Package, RotateCcw, Settings, Shield, ShoppingCart, Users, UserCog, DollarSign, X } from 'lucide-react';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { PageLoader, Empty } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { useAuth, type Role } from '@/lib/auth';
import { get } from '@/lib/api';
import { t } from '@/lib/i18n';
import { ROLE_SCOPE, SECTIONS, roleList, sectionFor } from '@/lib/permissions';

const ICONS: Record<string, any> = {
  '/admin/dashboard': LayoutGrid, '/admin/productos': Package, '/admin/pedidos': ShoppingCart, '/admin/categorias': Layers,
  '/admin/vendedores': Users, '/admin/moderacion': Shield, '/admin/reportes': AlertTriangle, '/admin/devoluciones': RotateCcw,
  '/admin/finanzas': DollarSign, '/admin/comisiones': Coins, '/admin/usuarios': UserCog, '/admin/configuracion': Settings,
};

/** Shown instead of a section the user's role can't open: says why and what the role can do. */
function NoPermission({ section, roles, home }: { section: string; roles: Role[]; home: string }) {
  const scopes = roles.map((r) => [r, ROLE_SCOPE[r]] as const).filter(([, s]) => s);
  return (
    <div className="mx-auto max-w-2xl py-10" data-no-permission>
      <div className="card p-6">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600"><Lock className="size-6" /></span>
          <div>
            <h1 className="text-xl font-extrabold">{t('No tienes permiso para esta sección')}</h1>
            <p className="mt-1 text-sm text-muted">{t('Tu rol ({a}) no permite abrir «{b}». Si lo necesitas, pide a un administrador que te asigne el rol correspondiente.', { a: roleList(roles), b: section })}</p>
          </div>
        </div>
        {scopes.map(([r, s]) => (
          <div key={r} className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-emerald-50/60 p-4">
              <p className="mb-2 text-sm font-bold text-emerald-800">{t('Tu rol puede')}</p>
              <ul className="space-y-1.5 text-sm">{s!.can.map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{t(x)}</li>)}</ul>
            </div>
            <div className="rounded-xl bg-red-50/60 p-4">
              <p className="mb-2 text-sm font-bold text-red-800">{t('Tu rol no puede')}</p>
              <ul className="space-y-1.5 text-sm">{s!.cannot.map((x) => <li key={x} className="flex gap-2"><X className="mt-0.5 size-4 shrink-0 text-red-600" />{t(x)}</li>)}</ul>
            </div>
          </div>
        ))}
        <Button asChild className="mt-6"><Link href={home}>{t('Ir a mi panel')}</Link></Button>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { session, loading, isStaff, isAdmin, me, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!loading && !session) router.replace(`/auth/iniciar-sesion?next=${encodeURIComponent(pathname)}`);
  }, [loading, session, router, pathname]);
  const dash = useQuery({ queryKey: ['admin-attention'], queryFn: () => get('/admin/dashboard?days=7'), enabled: isStaff, refetchInterval: 60_000 });
  const deletions = useQuery({ queryKey: ['account-deletions', 'REQUESTED'], queryFn: () => get<any[]>('/admin/account-deletions?status=REQUESTED'), enabled: isAdmin, refetchInterval: 120_000 });
  const returns = useQuery({ queryKey: ['admin-returns-count'], queryFn: () => get('/admin/returns?status=REFUND_PENDING'), enabled: isAdmin, refetchInterval: 60_000 });
  if (loading || !session || !me) return <PageLoader />;
  if (!isStaff) return <div className="mx-auto max-w-lg py-20"><Empty icon={<Shield />} title={t('Acceso restringido')} description={t('Esta sección es solo para el equipo del marketplace.')} /></div>;
  const a = dash.data?.attention;
  const badges: Record<string, number | null> = {
    '/admin/vendedores': a?.sellers_pending || null,
    '/admin/moderacion': a?.products_pending || null,
    '/admin/reportes': a?.open_tickets || null,
    // Admins act on refunds; support on the review / receive / inspect queue.
    '/admin/devoluciones': (isAdmin ? returns.data?.counts?.refund_pending : a?.returns_pending) || null,
    '/admin/finanzas': a?.transfers_pending || null,
    '/admin/comisiones': (a?.payouts_pending ?? 0) + (a?.payout_accounts_pending ?? 0) || null,
    '/admin/usuarios': deletions.data?.length || null,
  };
  const nav = SECTIONS.filter((x) => can(x.perm)).map((x) => ({ href: x.href, label: t(x.label), icon: ICONS[x.href], badge: badges[x.href] ?? null }));
  const section = sectionFor(pathname);
  const allowed = !section || can(section.perm);
  return (
    <DashboardShell title="NEXOVAX" subtitle={t('Panel de administración')} nav={nav}>
      {allowed ? children : <NoPermission section={t(section!.label)} roles={me.roles} home={nav[0]?.href ?? '/'} />}
    </DashboardShell>
  );
}
