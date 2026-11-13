import Link from 'next/link';
import { ArrowRight, BadgeCheck, CheckCircle2, Globe2, Headphones, LayoutGrid, ShieldCheck, ShoppingCart, Store, Truck } from 'lucide-react';
import { serverGet } from '@/lib/server-api';
import { ProductGrid, ProductImage } from '@/components/shop/product-card';
import { getT } from '@/lib/i18n/server';
import { CategoryIcon } from '@/components/shop/category-icon';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/misc';

export const revalidate = 30;

async function Hero({ preview }: { preview: any[] }) {
  const t = await getT();
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-white via-brand-50 to-brand-100">
      <div className="absolute -right-24 -top-32 size-[420px] rounded-full bg-brand-200/50 blur-3xl" />
      <div className="relative mx-auto grid max-w-[1400px] items-center gap-6 px-4 py-5 lg:grid-cols-[1.8fr_1fr] lg:px-8 lg:py-5">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-600">
            <Globe2 className="size-3.5" /> {t('Tiendas de todo el mundo, un solo carrito')}
          </span>
          <h1 className="mt-2.5 text-xl font-extrabold leading-tight tracking-tight text-balance text-brand-950 sm:text-[26px]">
            {t('Compra a vendedores de todo el mundo con envíos a tu puerta')}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">{t('Miles de productos, múltiples tiendas y una sola plataforma segura, con tarifas de envío en tiempo real e impuestos claros.')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <Button asChild>
              <Link href="/catalogo"><ShoppingCart /> {t('Explorar productos')} <ArrowRight /></Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/vendedor/registro"><Store /> {t('Vender en NEXOVAX')}</Link>
            </Button>
            <div className="hidden flex-wrap gap-x-4 gap-y-1 text-xs text-ink xl:flex xl:pl-2">
              {['Compras seguras', 'Vendedores verificados', 'Envíos internacionales'].map((x) => (
                <span key={x} className="inline-flex items-center gap-1"><CheckCircle2 className="size-3.5 text-brand-600" /> {t(x)}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="relative hidden lg:block">
          <div className="ml-auto w-full max-w-[360px] rounded-xl border-[5px] border-ink bg-white p-2 shadow-xl">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-red-400" /><span className="size-2 rounded-full bg-amber-400" /><span className="size-2 rounded-full bg-emerald-400" />
              <span className="ml-2 h-3 flex-1 rounded bg-surface" />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(preview.length ? preview : Array.from({ length: 4 })).slice(0, 4).map((p: any, i) => (
                <div key={i} className="rounded-lg bg-surface p-1.5">
                  <ProductImage src={p?.imageUrl} alt={p?.title ?? ''} className="aspect-square w-full rounded-md" />
                  <div className="mt-1 h-1.5 w-3/4 rounded bg-brand-100" />
                </div>
              ))}
            </div>
          </div>
          <div className="absolute -bottom-3 right-[345px] grid size-12 place-items-center rounded-2xl bg-brand-600 text-white shadow-xl">
            <Store className="size-6" />
          </div>
        </div>
      </div>
    </section>
  );
}

export default async function HomePage() {
  const t = await getT();
  const data = await serverGet<any>('/home', 30);
  const categories = data?.categories ?? [];
  const featured = data?.featured ?? [];
  return (
    <>
      <Hero preview={featured} />
      <div className="mx-auto max-w-[1400px] px-4 lg:px-8">
        <section className="mt-12">
          <div className="mb-5 flex items-end justify-between">
            <h2 className="text-2xl font-extrabold">{t('Explora por categorías')}</h2>
            <Link href="/catalogo" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">{t('Ver todas las categorías')} <ArrowRight className="size-4" /></Link>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-10">
            {categories.slice(0, 9).map((c: any) => (
              <Link key={c.id} href={`/catalogo/categorias/${c.slug}`} className="card flex flex-col items-center gap-2 px-2 py-4 text-center transition hover:-translate-y-0.5 hover:border-brand-200">
                <CategoryIcon slug={c.slug} className="size-8 text-brand-600" strokeWidth={1.6} />
                <span className="line-clamp-1 text-sm font-semibold">{t(c.name)}</span>
              </Link>
            ))}
            <Link href="/catalogo" className="card flex flex-col items-center gap-2 px-2 py-4 text-center transition hover:-translate-y-0.5">
              <LayoutGrid className="size-8 text-brand-600" strokeWidth={1.6} />
              <span className="text-sm font-semibold">{t('Más')}</span>
            </Link>
          </div>
        </section>

        <section className="mt-12">
          <div className="mb-5 flex items-end justify-between">
            <h2 className="text-2xl font-extrabold">{t('Productos destacados')}</h2>
            <Link href="/catalogo" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">{t('Ver más productos')} <ArrowRight className="size-4" /></Link>
          </div>
          {featured.length ? (
            <ProductGrid items={featured.slice(0, 12)} />
          ) : (
            <div className="card"><Empty title={t('Pronto verás productos aquí')} description={t('Los vendedores están preparando su catálogo.')} /></div>
          )}
        </section>

        {data?.deals?.length ? (
          <section className="mt-12">
            <div className="mb-5 flex items-end justify-between">
              <h2 className="text-2xl font-extrabold">{t('Ofertas de la semana')}</h2>
              <Link href="/catalogo?onSale=true" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">{t('Ver ofertas')} <ArrowRight className="size-4" /></Link>
            </div>
            <ProductGrid items={data.deals} />
          </section>
        ) : null}

        <section className="mt-12 grid gap-4 md:grid-cols-2">
          <Link href="/vendedor/registro" className="card relative flex items-center gap-5 overflow-hidden bg-gradient-to-r from-brand-50 to-white p-6 transition hover:shadow-lg">
            <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm"><Store className="size-8" /></div>
            <div>
              <h3 className="text-xl font-extrabold">{t('¿Eres vendedor?')}</h3>
              <p className="mt-1 text-sm text-muted">{t('Crea tu tienda, publica tus productos y vende a clientes de todo el mundo.')}</p>
            </div>
            <ArrowRight className="ml-auto size-6 shrink-0 text-brand-600" />
          </Link>
          <div className="card flex items-center gap-5 bg-gradient-to-r from-white to-brand-50 p-6">
            <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm"><ShieldCheck className="size-8" /></div>
            <div>
              <h3 className="text-xl font-extrabold">{t('Compra con confianza')}</h3>
              <p className="mt-1 text-sm text-muted">{t('Pagos seguros, protección al comprador y soporte en tu idioma.')}</p>
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [Truck, 'Envíos internacionales', 'Tarifas en vivo de USPS, UPS, DHL y más, con rastreo.'],
            [ShieldCheck, 'Pagos seguros', 'Tus compras protegidas con métodos confiables.'],
            [BadgeCheck, 'Vendedores verificados', 'Tiendas reales y con reputación comprobada.'],
            [Headphones, 'Soporte en tu idioma', 'Te acompañamos en español e inglés.'],
          ].map(([Icon, title, d]: any) => (
            <div key={title} className="flex items-start gap-3">
              <Icon className="size-9 shrink-0 text-brand-600" strokeWidth={1.6} />
              <div>
                <p className="font-bold">{t(title)}</p>
                <p className="text-sm text-muted">{t(d)}</p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
