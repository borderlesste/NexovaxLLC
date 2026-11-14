'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Coins, CreditCard, Layers, LayoutGrid, Package, RotateCcw, Settings, Shield, ShoppingCart, Users, UserCog, DollarSign } from 'lucide-react';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { PageLoader, Empty } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';
import { get } from '@/lib/api';
import { t } from '@/lib/i18n';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { session, loading, isStaff, isAdmin, me } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!loading && !session) router.replace(`/auth/iniciar-sesion?next=${encodeURIComponent(pathname)}`);
  }, [loading, session, router, pathname]);
  const dash = useQuery({ queryKey: ['admin-attention'], queryFn: () => get('/admin/dashboard?days=7'), enabled: isStaff, refetchInterval: 60_000 });
  const returns = useQuery({ queryKey: ['admin-returns-count'], queryFn: () => get('/admin/returns?status=REFUND_PENDING'), enabled: isStaff, refetchInterval: 60_000 });
  if (loading || !session || !me) return <PageLoader />;
  if (!isStaff) return <div className="mx-auto max-w-lg py-20"><Empty icon={<Shield />} title={t('Acceso restringido')} description={t('Esta sección es solo para el equipo del marketplace.')} /></div>;
  const a = dash.data?.attention;
  const nav = [
    { href: '/admin/dashboard', label: t('Dashboard'), icon: LayoutGrid },
    { href: '/admin/productos', label: t('Productos'), icon: Package },
    { href: '/admin/pedidos', label: t('Pedidos'), icon: ShoppingCart },
    { href: '/admin/categorias', label: t('Categorías'), icon: Layers },
    { href: '/admin/vendedores', label: t('Vendedores'), icon: Users, badge: a?.sellers_pending || null },
    { href: '/admin/moderacion', label: t('Moderación'), icon: Shield, badge: a?.products_pending || null },
    { href: '/admin/reportes', label: t('Reportes y soporte'), icon: AlertTriangle, badge: a?.open_tickets || null },
    { href: '/admin/devoluciones', label: t('Devoluciones'), icon: RotateCcw, badge: returns.data?.counts?.refund_pending || null },
    ...(isAdmin
      ? [
          { href: '/admin/finanzas', label: t('Finanzas'), icon: DollarSign, badge: a?.transfers_pending || null },
          { href: '/admin/comisiones', label: t('Comisiones y payouts'), icon: Coins, badge: (a?.payouts_pending ?? 0) + (a?.payout_accounts_pending ?? 0) || null },
          { href: '/admin/usuarios', label: t('Usuarios'), icon: UserCog },
          { href: '/admin/configuracion', label: t('Configuración'), icon: Settings },
        ]
      : []),
  ];
  return <DashboardShell title="NEXOVAX" subtitle={t('Panel de administración')} nav={nav}>{children}</DashboardShell>;
}
