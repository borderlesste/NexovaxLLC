'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import {
  Bell, ChevronDown, Heart, LayoutDashboard, LogOut, Menu, MessageSquare, Package, RotateCcw, Search, Settings, Shield, ShoppingCart, Store, User, X,
} from 'lucide-react';
import { Logo } from './logo';
import { LanguageSwitcher } from './language-switcher';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/misc';
import { CategoryIcon } from '@/components/shop/category-icon';
import { useAuth } from '@/lib/auth';
import { get } from '@/lib/api';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const NAV = [
  { href: '/', label: 'Inicio' },
  { href: '/catalogo?onSale=true', label: 'Ofertas' },
  { href: '/vendedores', label: 'Vendedores' },
  { href: '/ayuda', label: 'Ayuda' },
];

function SearchBox({ className }: { className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const sugg = useQuery({
    queryKey: ['suggest', q],
    queryFn: () => get(`/search/suggest?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const go = (term: string) => {
    setOpen(false);
    router.push(`/catalogo?q=${encodeURIComponent(term.trim())}`);
  };
  const s = sugg.data;
  const hasSugg = s && (s.products.length || s.stores.length || s.categories.length);
  return (
    <div className={cn('relative', className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) go(q);
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          ref={ref}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={t('Buscar productos, marcas o tiendas...')}
          aria-label={t('Buscar')}
          className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-16 text-sm placeholder:text-muted/80 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted md:block">{t('Ctrl + K')}</kbd>
      </form>
      {open && q.trim().length >= 2 && hasSugg ? (
        <div className="absolute left-0 right-0 top-12 z-40 overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          {s.products.map((p: any) => (
            <Link key={p.slug} href={`/producto/${p.slug}`} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-brand-50">
              <Package className="size-4 text-muted" /> {p.title}
            </Link>
          ))}
          {s.stores.map((st: any) => (
            <Link key={st.slug} href={`/tienda/${st.slug}`} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-brand-50">
              <Store className="size-4 text-muted" /> {st.name}
            </Link>
          ))}
          {s.categories.map((c: any) => (
            <Link key={c.slug} href={`/catalogo/categorias/${c.slug}`} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-brand-50">
              <CategoryIcon slug={c.slug} className="size-4 text-muted" /> {c.name}
            </Link>
          ))}
          <button onMouseDown={() => go(q)} className="w-full border-t border-line px-4 py-2 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50">
            {t('Ver todos los resultados para “')}{q}”
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CategoriesMenu() {
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get('/categories'), staleTime: 300_000 });
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-ink hover:bg-brand-50 data-[state=open]:bg-brand-50">
        {t('Categorías')}{' '}<ChevronDown className="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="start" sideOffset={8} className="z-50 grid w-[min(720px,95vw)] grid-cols-2 gap-1 rounded-xl border border-line bg-white p-3 shadow-xl sm:grid-cols-3">
          {(cats.data ?? []).map((c: any) => (
            <Dropdown.Item key={c.id} asChild>
              <Link href={`/catalogo/categorias/${c.slug}`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none hover:bg-brand-50 focus:bg-brand-50">
                <CategoryIcon slug={c.slug} className="size-4 text-brand-600" />
                <span className="truncate">{c.name}</span>
              </Link>
            </Dropdown.Item>
          ))}
          <Dropdown.Item asChild>
            <Link href="/catalogo" className="col-span-full mt-1 rounded-lg px-3 py-2 text-sm font-semibold text-brand-700 outline-none hover:bg-brand-50">
              {t('Ver todo el catálogo →')}
            </Link>
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

function CountBadge({ n }: { n?: number }) {
  if (!n) return null;
  return <span className="absolute -right-1.5 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold leading-[18px] text-white">{n > 99 ? '99+' : n}</span>;
}

export function UserMenu() {
  const { me, signOut, isAdmin, isStaff, seller } = useAuth();
  const router = useRouter();
  if (!me) return null;
  const item = 'flex items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none hover:bg-brand-50 focus:bg-brand-50 [&_svg]:size-4 [&_svg]:text-muted';
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-brand-50">
        <Avatar name={me.displayName} src={me.avatarUrl} size={34} />
        <span className="hidden max-w-[140px] text-left leading-tight lg:block">
          <span className="block truncate text-sm font-semibold">{me.displayName}</span>
          <span className="block text-[11px] text-muted">{isAdmin ? t('Administrador') : seller ? t('Vendedor') : t('Comprador')}</span>
        </span>
        <ChevronDown className="size-4 text-muted" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={8} className="z-50 w-60 rounded-xl border border-line bg-white p-1.5 shadow-xl">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-bold">{me.displayName}</p>
            <p className="truncate text-xs text-muted">{me.email}</p>
          </div>
          <Dropdown.Separator className="my-1 h-px bg-line" />
          <Dropdown.Item asChild><Link className={item} href="/cuenta/perfil"><User /> {t('Mi perfil')}</Link></Dropdown.Item>
          <Dropdown.Item asChild><Link className={item} href="/cuenta/pedidos"><Package /> {t('Mis pedidos')}</Link></Dropdown.Item>
          <Dropdown.Item asChild><Link className={item} href="/mensajes"><MessageSquare /> {t('Mensajes')}</Link></Dropdown.Item>
          <Dropdown.Item asChild><Link className={item} href="/cuenta/favoritos"><Heart /> {t('Favoritos')}</Link></Dropdown.Item>
          <Dropdown.Item asChild><Link className={item} href="/cuenta/devoluciones"><RotateCcw /> {t('Devoluciones')}</Link></Dropdown.Item>
          <Dropdown.Item asChild><Link className={item} href="/cuenta/notificaciones"><Bell /> {t('Notificaciones')}</Link></Dropdown.Item>
          <Dropdown.Separator className="my-1 h-px bg-line" />
          {seller ? (
            <Dropdown.Item asChild><Link className={item} href="/vendedor/dashboard"><Store /> {t('Panel de vendedor')}</Link></Dropdown.Item>
          ) : (
            <Dropdown.Item asChild><Link className={item} href="/vendedor/registro"><Store /> {t('Vender en NEXOVAX')}</Link></Dropdown.Item>
          )}
          {isStaff && <Dropdown.Item asChild><Link className={item} href="/admin/dashboard"><Shield /> {t('Panel de administración')}</Link></Dropdown.Item>}
          <Dropdown.Item asChild><Link className={item} href="/cuenta/seguridad"><Settings /> {t('Seguridad')}</Link></Dropdown.Item>
          <Dropdown.Separator className="my-1 h-px bg-line" />
          <Dropdown.Item
            className={cn(item, 'cursor-pointer text-red-600 [&_svg]:text-red-500')}
            onSelect={async () => {
              await signOut();
              router.push('/');
            }}
          >
            <LogOut /> {t('Cerrar sesión')}
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export function ShopHeader() {
  const { me, loading } = useAuth();
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false);
  useEffect(() => setMobile(false), [pathname]);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-[1400px] items-center gap-4 px-4 lg:px-8">
        <button className="rounded-lg p-2 hover:bg-brand-50 lg:hidden" onClick={() => setMobile((v) => !v)} aria-label={t('Menú')}>
          {mobile ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
        <Logo />
        <div className="ml-2 hidden h-8 w-px bg-line xl:block" />
        <nav className="hidden items-center gap-1 lg:flex">
          <Link href="/" className={cn('rounded-lg px-3 py-2 text-sm font-semibold', pathname === '/' ? 'bg-brand-50 text-brand-700' : 'hover:bg-brand-50')}>{t('Inicio')}</Link>
          <CategoriesMenu />
          {NAV.slice(1).map((n) => (
            <Link key={n.href} href={n.href} className={cn('rounded-lg px-3 py-2 text-sm font-semibold', pathname.startsWith(n.href.split('?')[0]) && n.href !== '/' ? 'bg-brand-50 text-brand-700' : 'hover:bg-brand-50')}>
              {t(n.label)}
            </Link>
          ))}
        </nav>
        <SearchBox className="ml-auto hidden w-full max-w-md md:block" />
        <div className="ml-auto flex items-center gap-1 md:ml-2">
          <LanguageSwitcher />
          <Link href="/cuenta/favoritos" className="relative rounded-lg p-2 hover:bg-brand-50" aria-label={t('Favoritos')}>
            <Heart className="size-5" />
            <CountBadge n={me?.counts.favorites} />
          </Link>
          <Link href="/carrito" className="relative rounded-lg p-2 hover:bg-brand-50" aria-label={t('Carrito')}>
            <ShoppingCart className="size-5" />
            <CountBadge n={me?.counts.cart_items} />
          </Link>
          {me && (
            <Link href="/mensajes" className="relative hidden rounded-lg p-2 hover:bg-brand-50 sm:block" aria-label={t('Mensajes')}>
              <MessageSquare className="size-5" />
              <CountBadge n={me.counts.unread_conversations} />
            </Link>
          )}
          {me && <NotificationBell />}
          {!loading && !me && (
            <div className="ml-2 hidden items-center gap-2 sm:flex">
              <Button variant="outline" asChild size="sm" className="h-9">
                <Link href={`/auth/iniciar-sesion?next=${encodeURIComponent(pathname)}`}>{t('Iniciar sesión')}</Link>
              </Button>
              <Button asChild size="sm" className="h-9">
                <Link href="/auth/registrarse">{t('Crear cuenta')}</Link>
              </Button>
            </div>
          )}
          {me && <div className="ml-1"><UserMenu /></div>}
        </div>
      </div>
      {mobile && (
        <div className="border-t border-line bg-white px-4 pb-4 lg:hidden">
          <SearchBox className="my-3 md:hidden" />
          <nav className="grid gap-1">
            {[{ href: '/', label: t('Inicio') }, { href: '/catalogo', label: t('Categorías') }, ...NAV.slice(1)].map((n) => (
              <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-brand-50">{t(n.label)}</Link>
            ))}
            {!me && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="outline" asChild><Link href="/auth/iniciar-sesion">{t('Iniciar sesión')}</Link></Button>
                <Button asChild><Link href="/auth/registrarse">{t('Crear cuenta')}</Link></Button>
              </div>
            )}
            {me && (
              <Link href="/vendedor/dashboard" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-brand-50">
                <LayoutDashboard className="size-4" /> {t('Mis paneles')}
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
