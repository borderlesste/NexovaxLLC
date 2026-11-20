'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, LayoutGrid, Layers, MessageSquare, Package, RotateCcw, Settings, ShoppingCart, Wallet, Clock, AlertTriangle , TicketPercent, Handshake , BarChart3, Users } from 'lucide-react';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { Empty, PageLoader } from '@/components/ui/misc';
import { useAuth, type SellerArea } from '@/lib/auth';
import { get } from '@/lib/api';
import { t } from '@/lib/i18n';

/** Section of the panel each page belongs to; 'OWNER' pages are only for the store owner. */
const AREA: Record<string, SellerArea | 'OWNER'> = {
  dashboard: 'STATS',
  productos: 'PRODUCTS',
  inventario: 'PRODUCTS',
  pedidos: 'ORDERS',
  devoluciones: 'ORDERS',
  estadisticas: 'STATS',
  cupones: 'MARKETING',
  afiliados: 'MARKETING',
  finanzas: 'FINANCE',
  'metodos-cobro': 'FINANCE',
  mensajes: 'MESSAGES',
  configuracion: 'SETTINGS',
  equipo: 'OWNER',
};
const areaOf = (href: string) => AREA[href.split('/')[2] ?? ''];

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const { session, loading, seller, me, sellerCan, selectSeller } = useAuth();
  const allowed = (href: string) => {
    const a = areaOf(href);
    return !a || (a === 'OWNER' ? !!seller?.isOwner : sellerCan(a));
  };
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (loading) return;
    if (!session) router.replace(`/auth/iniciar-sesion?next=${encodeURIComponent(pathname)}`);
    else if (me && !seller) router.replace('/vendedor/registro');
  }, [loading, session, seller, me, router, pathname]);
  const canOrders = !!seller && sellerCan('ORDERS');
  const counts = useQuery({ queryKey: ['seller-order-counts', seller?.id], queryFn: () => get('/seller/orders/counts'), enabled: canOrders, refetchInterval: 60_000 });
  const returns = useQuery({ queryKey: ['seller-returns-count', seller?.id], queryFn: () => get('/seller/returns?status=ACTION'), enabled: canOrders, refetchInterval: 60_000 });
  if (loading || !session || !seller) return <PageLoader />;
  const firstAllowed = Object.keys(AREA).map((k) => `/vendedor/${k}`).find(allowed);
  const rc = returns.data?.counts;
  const returnsPending = rc ? rc.to_review + rc.in_transit + rc.to_inspect : 0;
  const pending = (counts.data?.to_prepare ?? 0) + (counts.data?.preparing ?? 0);
  return (
    <DashboardShell
      title={t('Marketplace')}
      subtitle={t('Panel del vendedor')}
      nav={[
        { href: '/vendedor/dashboard', label: t('Dashboard'), icon: LayoutGrid },
        { href: '/vendedor/productos', label: t('Productos'), icon: Package },
        { href: '/vendedor/pedidos', label: t('Pedidos'), icon: ShoppingCart, badge: pending || null },
        { href: '/vendedor/estadisticas', label: t('Estadísticas'), icon: BarChart3 },
        { href: '/vendedor/devoluciones', label: t('Devoluciones'), icon: RotateCcw, badge: returnsPending || null },
        { href: '/vendedor/inventario', label: t('Inventario'), icon: Layers },
        { href: '/vendedor/cupones', label: t('Cupones'), icon: TicketPercent },
        { href: '/vendedor/afiliados', label: t('Afiliados'), icon: Handshake },
        { href: '/vendedor/finanzas', label: t('Finanzas'), icon: Wallet },
        { href: '/vendedor/metodos-cobro', label: t('Métodos de cobro'), icon: CreditCard },
        { href: '/vendedor/mensajes', label: t('Mensajes'), icon: MessageSquare },
        { href: '/vendedor/configuracion', label: t('Configuración'), icon: Settings },
        { href: '/vendedor/equipo', label: t('Equipo'), icon: Users },
      ].filter((n) => allowed(n.href))}
      footer={
        <>
        {(me?.sellers.length ?? 0) > 1 && (
          <label className="block text-xs text-muted">
            {t('Tienda')}
            <select value={seller.id} onChange={(e) => selectSeller(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-line bg-white px-2 text-sm font-semibold text-ink">
              {me!.sellers.map((s) => (
                <option key={s.id} value={s.id}>{s.slug}{s.isOwner ? '' : ` · ${t('equipo')}`}</option>
              ))}
            </select>
          </label>
        )}
        {seller.status !== 'ACTIVE' ? (
          <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
            {seller.status === 'PENDING_VERIFICATION' ? <Clock className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
            <span>{seller.status === 'PENDING_VERIFICATION' ? t('Tu tienda está en verificación. Puedes preparar tus productos mientras tanto.') : seller.status === 'SUSPENDED' ? t('Tu tienda está suspendida. Contacta a soporte.') : t('Tu tienda no está activa.')}</span>
          </div>
        ) : null}
        </>
      }
    >
      {allowed(pathname) ? children : <SectionLocked first={firstAllowed} />}
    </DashboardShell>
  );
}

/** A team member opened a section the owner didn't give them. */
function SectionLocked({ first }: { first?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    // The panel's home (dashboard) sends members straight to their first section.
    if (first && pathname === '/vendedor/dashboard') router.replace(first);
  }, [first, pathname, router]);
  if (first && pathname === '/vendedor/dashboard') return <PageLoader />;
  return (
    <Empty
      title={t('No tienes acceso a esta sección')}
      description={first ? t('El propietario de la tienda no te dio permiso para esta parte del panel.') : t('El propietario de la tienda todavía no te asignó ninguna sección.')}
      action={first ? <a href={first} className="text-sm font-semibold text-brand-700">{t('Ir a mi sección →')}</a> : undefined}
    />
  );
}
