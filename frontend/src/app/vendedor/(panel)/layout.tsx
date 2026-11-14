'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, LayoutGrid, Layers, MessageSquare, Package, RotateCcw, Settings, ShoppingCart, Wallet, Clock, AlertTriangle } from 'lucide-react';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { PageLoader } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';
import { get } from '@/lib/api';
import { t } from '@/lib/i18n';

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const { session, loading, seller, me } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (loading) return;
    if (!session) router.replace(`/auth/iniciar-sesion?next=${encodeURIComponent(pathname)}`);
    else if (me && !seller) router.replace('/vendedor/registro');
  }, [loading, session, seller, me, router, pathname]);
  const counts = useQuery({ queryKey: ['seller-order-counts'], queryFn: () => get('/seller/orders/counts'), enabled: !!seller, refetchInterval: 60_000 });
  const returns = useQuery({ queryKey: ['seller-returns-count'], queryFn: () => get('/seller/returns?status=ACTION'), enabled: !!seller, refetchInterval: 60_000 });
  if (loading || !session || !seller) return <PageLoader />;
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
        { href: '/vendedor/devoluciones', label: t('Devoluciones'), icon: RotateCcw, badge: returnsPending || null },
        { href: '/vendedor/inventario', label: t('Inventario'), icon: Layers },
        { href: '/vendedor/finanzas', label: t('Finanzas'), icon: Wallet },
        { href: '/vendedor/metodos-cobro', label: t('Métodos de cobro'), icon: CreditCard },
        { href: '/vendedor/mensajes', label: t('Mensajes'), icon: MessageSquare },
        { href: '/vendedor/configuracion', label: t('Configuración'), icon: Settings },
      ]}
      footer={
        seller.status !== 'ACTIVE' ? (
          <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
            {seller.status === 'PENDING_VERIFICATION' ? <Clock className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
            <span>{seller.status === 'PENDING_VERIFICATION' ? t('Tu tienda está en verificación. Puedes preparar tus productos mientras tanto.') : seller.status === 'SUSPENDED' ? t('Tu tienda está suspendida. Contacta a soporte.') : t('Tu tienda no está activa.')}</span>
          </div>
        ) : null
      }
    >
      {children}
    </DashboardShell>
  );
}
