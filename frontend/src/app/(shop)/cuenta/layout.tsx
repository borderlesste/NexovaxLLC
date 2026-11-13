'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AlertCircle, Heart, MapPin, MessageSquare, Package, Shield, Store, User, Users, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { PageLoader } from '@/components/ui/misc';

const LINKS = [
  ['/cuenta/perfil', 'Mi perfil', User],
  ['/cuenta/pedidos', 'Mis pedidos', Package],
  ['/cuenta/favoritos', 'Mis favoritos', Heart],
  ['/cuenta/tiendas', 'Mis tiendas', Users],
  ['/mensajes', 'Mensajes', MessageSquare],
  ['/cuenta/direcciones', 'Direcciones', MapPin],
  ['/cuenta/reportes', 'Mis reportes', AlertCircle],
  ['/cuenta/seguridad', 'Seguridad', Shield],
] as const;

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { session, loading, seller, isStaff } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !session) router.replace(`/auth/iniciar-sesion?next=${encodeURIComponent(pathname)}`);
  }, [loading, session, router, pathname]);
  if (loading || !session) return <PageLoader />;
  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 lg:grid-cols-[240px_1fr] lg:px-8">
      <aside className="h-fit lg:sticky lg:top-24">
        <p className="mb-2 px-3 text-sm font-bold text-muted">Mi cuenta</p>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {LINKS.map(([href, label, Icon]) => (
            <Link key={href} href={href} className={cn('flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold', pathname.startsWith(href) ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-white')}>
              <Icon className="size-[18px]" /> {label}
            </Link>
          ))}
        </nav>
        <div className="mt-4 hidden space-y-2 lg:block">
          <Link href={seller ? '/vendedor/dashboard' : '/vendedor/registro'} className="flex items-center gap-3 rounded-xl bg-brand-50 px-4 py-3 text-sm font-bold text-brand-700"><Store className="size-5" /> {seller ? 'Panel de vendedor' : 'Vender en RD Marketplace'}</Link>
          {isStaff && <Link href="/admin/dashboard" className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-sm font-bold"><LayoutDashboard className="size-5 text-brand-600" /> Administración</Link>}
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
