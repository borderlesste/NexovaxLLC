import Link from 'next/link';
import { ArrowRight, BadgeCheck, Globe2, Headphones, LayoutGrid, ShieldCheck, ShoppingCart, Store, Truck } from 'lucide-react';
import { serverGet } from '@/lib/server-api';
import { Recommendations } from '@/components/shop/recommendations';
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
      <div className="relative mx-auto grid grid-cols-1 max-w-[1400px] items-center gap-6 px-4 py-5 lg:grid-cols-[1.8fr_1fr] lg:px-8 lg:py-5">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-700">
            <Globe2 className="size-3.5" /> {t('Un carrito único para tus compras internacionales')}
          </span>
          <h1 className="mt-2.5 text-xl font-extrabold leading-tight tracking-tight text-balance text-brand-950 sm:text-[26px]">
            {t('Compra en tiendas de todo el mundo y recíbelo en tu puerta')}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">{t('Explora productos seleccionados de tiendas registradas, con el costo de envío antes de pagar, seguimiento paso a paso e impuestos claros desde el primer momento.')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <Button asChild>
              <Link href="/catalogo"><ShoppingCart /> {t('Explorar catálogo')} <ArrowRight /></Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/vendedor/registro"><Store /> {t('Abrir mi tienda')}</Link>
            </Button>
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
                  <ProductImage src={p?.imageUrl} alt={p?.title ?? ''} sizes="80px" className="aspect-square w-full rounded-md" />
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
  const featuredOn = data?.featuredEnabled !== false;
  return (
    <>
      <Hero preview={featured.length ? featured : data?.popular ?? data?.newest ?? []} />
      <section className="border-b border-line bg-white" data-trust-badges>
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-3 lg:px-8">
          {[
            [ShieldCheck, 'Pagos protegidos', 'Pagas con métodos seguros y la tienda recibe tu dinero solo después de la entrega.'],
            [BadgeCheck, 'Tiendas identificadas', 'Cada tienda se registra con su identificación fiscal y verificamos su cuenta de cobro antes de pagarle.'],
            [Truck, 'Envíos claros y rastreables', 'Conoce el costo del envío antes de pagar, con tarifas de transportadoras como DHL, UPS y USPS cuando están disponibles.'],
          ].map(([Icon, title, d]: any) => (
            <div key={title} className="flex items-start gap-3">
              <Icon className="size-7 shrink-0 text-brand-600" strokeWidth={1.7} />
              <div>
                <p className="text-sm font-bold">{t(title)}</p>
                <p className="text-xs text-muted">{t(d)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
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
              <span className="text-sm font-semibold">{t('Más categorías')}</span>
            </Link>
          </div>
        </section>

        <Recommendations context="home" limit={12} className="mt-12" reserveSpace />

        {featuredOn && <section className="mt-12" data-featured-section>
          <div className="mb-5 flex items-end justify-between">
            <h2 className="text-2xl font-extrabold">{t('Productos destacados')}</h2>
            <Link href="/catalogo" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">{t('Ver más productos')} <ArrowRight className="size-4" /></Link>
          </div>
          {featured.length ? (
            <ProductGrid items={featured.slice(0, 12)} />
          ) : (
            <div className="card"><Empty title={t('Pronto verás productos aquí')} description={t('Los vendedores están preparando su catálogo.')} /></div>
          )}
        </section>}

        {data?.deals?.length ? (
          <section className="mt-12">
            <div className="mb-5 flex items-end justify-between">
              <h2 className="text-2xl font-extrabold">{t('Ofertas de la semana')}</h2>
              <Link href="/catalogo?onSale=true" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">{t('Ver ofertas')} <ArrowRight className="size-4" /></Link>
            </div>
            <ProductGrid items={data.deals} />
          </section>
        ) : null}

        <section className="mt-12">
          <Link href="/vendedor/registro" className="card relative flex flex-col items-start gap-5 overflow-hidden bg-gradient-to-r from-brand-50 to-white p-6 transition hover:shadow-lg sm:flex-row sm:items-center" data-seller-banner>
            <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm"><Store className="size-8" /></div>
            <div className="flex-1">
              <h3 className="text-xl font-extrabold">{t('¿Tienes una marca o tienda? Llega a compradores globales')}</h3>
              <p className="mt-1 text-sm text-muted">{t('Abre tu espacio en minutos, gestiona tus envíos internacionales desde un solo panel y vende sin complicaciones técnicas.')}</p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">{t('Empezar a vender')} <ArrowRight className="size-4" /></span>
          </Link>
        </section>

        <section className="mt-12" data-guarantees>
          <div className="mb-6 max-w-3xl">
            <h2 className="text-2xl font-extrabold">{t('Tu compra, respaldada de principio a fin')}</h2>
            <p className="mt-1 text-muted">{t('Comprar fuera de tu país no debería ser complicado. Nosotros nos encargamos de que todo sea transparente.')}</p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [Truck, 'Costos claros sin sorpresas', 'Visualiza el costo de envío e impuestos antes de pagar, con seguimiento por USPS, UPS, DHL, entre otros.'],
              [ShieldCheck, 'Protección al comprador', 'Si tu pedido no llega o es distinto a lo descrito, nuestro equipo interviene para reembolsar tu dinero.'],
              [BadgeCheck, 'Vendedores identificados', 'Cada tienda se registra con su identificación fiscal, sus reseñas son públicas y verificamos su cuenta de cobro antes de pagarle.'],
              [Headphones, 'Atención cercana en tu idioma', '¿Tienes dudas con un pedido o una devolución? Te acompañamos en 4 idiomas en cada paso.'],
            ].map(([Icon, title, d]: any) => (
              <div key={title} className="flex items-start gap-3">
                <Icon className="size-9 shrink-0 text-brand-600" strokeWidth={1.6} />
                <div>
                  <p className="font-bold">{t(title)}</p>
                  <p className="text-sm text-muted">{t(d)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
