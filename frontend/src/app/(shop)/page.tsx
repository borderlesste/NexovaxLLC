import Link from 'next/link';
import { ArrowRight, BadgeCheck, CheckCircle2, Headphones, LayoutGrid, ShieldCheck, ShoppingCart, Store, Truck } from 'lucide-react';
import { serverGet } from '@/lib/server-api';
import { ProductGrid, ProductImage } from '@/components/shop/product-card';
import { CategoryIcon } from '@/components/shop/category-icon';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/misc';

export const revalidate = 30;

function Hero({ preview }: { preview: any[] }) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-white via-brand-50 to-brand-100">
      <div className="absolute -right-24 -top-24 size-[520px] rounded-full bg-brand-200/50 blur-3xl" />
      <div className="relative mx-auto grid max-w-[1400px] items-center gap-10 px-4 py-12 lg:grid-cols-2 lg:px-8 lg:py-16">
        <div>
          <span className="inline-flex items-center gap-2 rounded-lg bg-brand-100 px-3 py-1.5 text-sm font-semibold text-brand-700">
            El marketplace de RD <span aria-hidden>🇩🇴</span>
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight text-brand-950 sm:text-5xl">
            Compra en tus tiendas favoritas y apoya a vendedores dominicanos
          </h1>
          <p className="mt-4 max-w-lg text-lg text-muted">Miles de productos, múltiples tiendas y una sola plataforma segura, rápida y confiable.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href="/catalogo"><ShoppingCart /> Explorar productos <ArrowRight /></Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/vendedor/registro"><Store /> Vender en RD Marketplace</Link>
            </Button>
          </div>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink">
            {['Compras seguras', 'Vendedores verificados', 'Soporte local'].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4 text-brand-600" /> {t}</span>
            ))}
          </div>
        </div>
        <div className="relative hidden lg:block">
          <div className="relative ml-auto w-[92%] rounded-2xl border-[10px] border-ink bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 border-b border-line pb-2">
              <span className="size-2.5 rounded-full bg-red-400" /><span className="size-2.5 rounded-full bg-amber-400" /><span className="size-2.5 rounded-full bg-emerald-400" />
              <span className="ml-3 h-5 flex-1 rounded bg-surface" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(preview.length ? preview : Array.from({ length: 6 })).slice(0, 6).map((p: any, i) => (
                <div key={i} className="rounded-xl bg-surface p-2">
                  <ProductImage src={p?.imageUrl} alt={p?.title ?? ''} className="aspect-square w-full rounded-lg" />
                  <div className="mt-1.5 h-2 w-3/4 rounded bg-brand-100" />
                  <div className="mt-1 h-2 w-1/2 rounded bg-brand-200" />
                </div>
              ))}
            </div>
            <div className="mx-auto -mb-[26px] mt-4 h-3 w-[110%] -translate-x-[4.5%] rounded-b-xl bg-ink/90" />
          </div>
          <div className="absolute -bottom-6 -left-2 grid size-36 place-items-center rounded-3xl bg-brand-600 text-white shadow-2xl">
            <Store className="size-16" />
          </div>
        </div>
      </div>
    </section>
  );
}

export default async function HomePage() {
  const data = await serverGet<any>('/home', 30);
  const categories = data?.categories ?? [];
  const featured = data?.featured ?? [];
  return (
    <>
      <Hero preview={featured} />
      <div className="mx-auto max-w-[1400px] px-4 lg:px-8">
        <section className="mt-12">
          <div className="mb-5 flex items-end justify-between">
            <h2 className="text-2xl font-extrabold">Explora por categorías</h2>
            <Link href="/catalogo" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">Ver todas las categorías <ArrowRight className="size-4" /></Link>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-10">
            {categories.slice(0, 9).map((c: any) => (
              <Link key={c.id} href={`/catalogo/categorias/${c.slug}`} className="card flex flex-col items-center gap-2 px-2 py-4 text-center transition hover:-translate-y-0.5 hover:border-brand-200">
                <CategoryIcon slug={c.slug} className="size-8 text-brand-600" strokeWidth={1.6} />
                <span className="line-clamp-1 text-sm font-semibold">{c.name}</span>
              </Link>
            ))}
            <Link href="/catalogo" className="card flex flex-col items-center gap-2 px-2 py-4 text-center transition hover:-translate-y-0.5">
              <LayoutGrid className="size-8 text-brand-600" strokeWidth={1.6} />
              <span className="text-sm font-semibold">Más</span>
            </Link>
          </div>
        </section>

        <section className="mt-12">
          <div className="mb-5 flex items-end justify-between">
            <h2 className="text-2xl font-extrabold">Productos destacados</h2>
            <Link href="/catalogo" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">Ver más productos <ArrowRight className="size-4" /></Link>
          </div>
          {featured.length ? (
            <ProductGrid items={featured.slice(0, 12)} />
          ) : (
            <div className="card"><Empty title="Pronto verás productos aquí" description="Los vendedores están preparando su catálogo." /></div>
          )}
        </section>

        {data?.deals?.length ? (
          <section className="mt-12">
            <div className="mb-5 flex items-end justify-between">
              <h2 className="text-2xl font-extrabold">Ofertas de la semana</h2>
              <Link href="/catalogo?onSale=true" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">Ver ofertas <ArrowRight className="size-4" /></Link>
            </div>
            <ProductGrid items={data.deals} />
          </section>
        ) : null}

        <section className="mt-12 grid gap-4 md:grid-cols-2">
          <Link href="/vendedor/registro" className="card relative flex items-center gap-5 overflow-hidden bg-gradient-to-r from-brand-50 to-white p-6 transition hover:shadow-lg">
            <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm"><Store className="size-8" /></div>
            <div>
              <h3 className="text-xl font-extrabold">¿Eres vendedor?</h3>
              <p className="mt-1 text-sm text-muted">Crea tu tienda, publica tus productos y llega a más clientes en todo el país.</p>
            </div>
            <ArrowRight className="ml-auto size-6 shrink-0 text-brand-600" />
          </Link>
          <div className="card flex items-center gap-5 bg-gradient-to-r from-white to-brand-50 p-6">
            <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm"><ShieldCheck className="size-8" /></div>
            <div>
              <h3 className="text-xl font-extrabold">Compra con confianza</h3>
              <p className="mt-1 text-sm text-muted">Pagos seguros, protección al comprador y soporte local.</p>
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [Truck, 'Envíos a todo RD', 'Recibe tus pedidos en la puerta de tu hogar.'],
            [ShieldCheck, 'Pagos seguros', 'Tus compras protegidas con métodos confiables.'],
            [BadgeCheck, 'Vendedores verificados', 'Tiendas reales y con reputación comprobada.'],
            [Headphones, 'Soporte local', 'Te acompañamos en todo el proceso.'],
          ].map(([Icon, t, d]: any) => (
            <div key={t} className="flex items-start gap-3">
              <Icon className="size-9 shrink-0 text-brand-600" strokeWidth={1.6} />
              <div>
                <p className="font-bold">{t}</p>
                <p className="text-sm text-muted">{d}</p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
