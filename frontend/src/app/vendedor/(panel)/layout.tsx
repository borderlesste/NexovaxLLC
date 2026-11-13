'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, LayoutGrid, Layers, MessageSquare, Package, Settings, ShoppingCart, Wallet, Clock, AlertTriangle } from 'lucide-react';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { PageLoader } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';
import { get } from '@/lib/api';

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
  if (loading || !session || !seller) return <PageLoader />;
  const pending = (counts.data?.to_prepare ?? 0) + (counts.data?.preparing ?? 0);
  return (
    <DashboardShell
      title="Marketplace"
      subtitle="Panel del vendedor"
      nav={[
        { href: '/vendedor/dashboard', label: 'Dashboard', icon: LayoutGrid },
        { href: '/vendedor/productos', label: 'Productos', icon: Package },
        { href: '/vendedor/pedidos', label: 'Pedidos', icon: ShoppingCart, badge: pending || null },
        { href: '/vendedor/inventario', label: 'Inventario', icon: Layers },
        { href: '/vendedor/finanzas', label: 'Finanzas', icon: Wallet },
        { href: '/vendedor/metodos-cobro', label: 'Métodos de cobro', icon: CreditCard },
        { href: '/vendedor/mensajes', label: 'Mensajes', icon: MessageSquare },
        { href: '/vendedor/configuracion', label: 'Configuración', icon: Settings },
      ]}
      footer={
        seller.status !== 'ACTIVE' ? (
          <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
            {seller.status === 'PENDING_VERIFICATION' ? <Clock className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
            <span>{seller.status === 'PENDING_VERIFICATION' ? 'Tu tienda está en verificación. Puedes preparar tus productos mientras tanto.' : seller.status === 'SUSPENDED' ? 'Tu tienda está suspendida. Contacta a soporte.' : 'Tu tienda no está activa.'}</span>
          </div>
        ) : null
      }
    >
      {children}
    </DashboardShell>
  );
}
