'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Coins, CreditCard, Layers, LayoutGrid, Package, Settings, Shield, ShoppingCart, Users, UserCog, DollarSign } from 'lucide-react';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { PageLoader, Empty } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';
import { get } from '@/lib/api';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { session, loading, isStaff, isAdmin, me } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!loading && !session) router.replace(`/auth/iniciar-sesion?next=${encodeURIComponent(pathname)}`);
  }, [loading, session, router, pathname]);
  const dash = useQuery({ queryKey: ['admin-attention'], queryFn: () => get('/admin/dashboard?days=7'), enabled: isStaff, refetchInterval: 60_000 });
  if (loading || !session || !me) return <PageLoader />;
  if (!isStaff) return <div className="mx-auto max-w-lg py-20"><Empty icon={<Shield />} title="Acceso restringido" description="Esta sección es solo para el equipo del marketplace." /></div>;
  const a = dash.data?.attention;
  const nav = [
    { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutGrid },
    { href: '/admin/productos', label: 'Productos', icon: Package },
    { href: '/admin/pedidos', label: 'Pedidos', icon: ShoppingCart },
    { href: '/admin/categorias', label: 'Categorías', icon: Layers },
    { href: '/admin/vendedores', label: 'Vendedores', icon: Users, badge: a?.sellers_pending || null },
    { href: '/admin/moderacion', label: 'Moderación', icon: Shield, badge: a?.products_pending || null },
    { href: '/admin/reportes', label: 'Reportes y soporte', icon: AlertTriangle, badge: a?.open_tickets || null },
    ...(isAdmin
      ? [
          { href: '/admin/finanzas', label: 'Finanzas', icon: DollarSign, badge: a?.transfers_pending || null },
          { href: '/admin/comisiones', label: 'Comisiones y payouts', icon: Coins, badge: (a?.payouts_pending ?? 0) + (a?.payout_accounts_pending ?? 0) || null },
          { href: '/admin/usuarios', label: 'Usuarios', icon: UserCog },
          { href: '/admin/configuracion', label: 'Configuración', icon: Settings },
        ]
      : []),
  ];
  return <DashboardShell title="Marketplace" subtitle="Panel de administración" nav={nav}>{children}</DashboardShell>;
}
