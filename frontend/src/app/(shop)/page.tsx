import Link from 'next/link';
import { ArrowRight, Globe2, Headphones, LayoutGrid, ShieldCheck, ShoppingCart, Store, Truck } from 'lucide-react';
import { serverGet } from '@/lib/server-api';
import { Recommendations } from '@/components/shop/recommendations';
import { ProductGrid, ProductImage } from '@/components/shop/product-card';
import { getServerLocale, getT } from '@/lib/i18n/server';
import { SectionHeading, StoreCards } from '@/components/shop/home-blocks';
import { PriceRanges, RecentlyViewed } from '@/components/shop/home-client';
import { CategoryIcon } from '@/components/shop/category-icon';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/misc';

export const revalidate = 30;

/** Product cards on the home page sit closer together than in the catalog. */
const HOME_GAP = 'gap-2 md:gap-2.5';
const HOME_GRID = `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 ${HOME_GAP}`;

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
                  <ProductImage src={p?.imageUrl} alt={p?.title ?? ''} sizes="80px" className="aspect-square w-full rounded-md object-cover" />
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

/** Default title of each section (Spanish source text, translated with t). */
const DEFAULT_TITLES: Record<string, string> = {
  categories: 'Explora por categorías',
  flash_deals: 'Ofertas relámpago',
  best_sellers: 'Más vendidos',
  featured: 'Productos destacados',
  new_arrivals: 'Novedades',
  recently_viewed: 'Vistos recientemente',
  deals: 'Ofertas de la semana',
  category_rows: 'Lo mejor en {category}',
  top_stores: 'Tiendas destacadas',
  preorders: 'Próximamente',
  price_ranges: 'Por rango de precio',
  seller_banner: '¿Tienes una marca o tienda? Llega a compradores globales',
  guarantees: 'Tu compra, respaldada de principio a fin',
};

/** Layout of API builds that don't send `sections` yet: the four sections the home page always had. */
function legacySections(data: any) {
  return [
    { key: 'categories', limit: 9 },
    { key: 'recommended', limit: 12 },
    ...(data?.featuredEnabled !== false ? [{ key: 'featured', limit: 12, items: data?.featured ?? [] }] : []),
    { key: 'deals', limit: 6, items: data?.deals ?? [] },
    { key: 'seller_banner' },
    { key: 'guarantees' },
  ];
}

const SECTION = 'mt-7 lg:mt-9';

export default async function HomePage() {
  const t = await getT();
  const locale = await getServerLocale();
  const data = await serverGet<any>('/home', 30);
  const categories = data?.categories ?? [];
  const featured = data?.featured ?? [];
  const sections: any[] = data?.sections ?? legacySections(data);
  /** Admin title for the visitor's language, else the default title translated. */
  const titleOf = (s: any, vars?: Record<string, string>) => {
    const custom = { es: s.title, en: s.titleEn, fr: s.titleFr, ht: s.titleHt }[locale]?.trim();
    const raw = custom || t(DEFAULT_TITLES[s.key] ?? '', vars);
    return vars ? raw.replace(/\{(\w+)\}/g, (m: string, k: string) => vars[k] ?? m) : raw;
  };
  const productRow = (s: any, opts: { subtitle?: string; href?: string; link?: string; extra?: React.ReactNode }) =>
    s.items?.length ? (
      <section key={s.key} className={SECTION} data-home-section={s.key}>
        <SectionHeading title={titleOf(s)} subtitle={opts.subtitle} href={opts.href} linkLabel={opts.link} extra={opts.extra} />
        <ProductGrid items={s.items} showAddToCart hideSeller gap={HOME_GAP} />
      </section>
    ) : null;

  const render = (s: any) => {
    switch (s.key) {
      case 'categories':
        return categories.length ? (
          <section key={s.key} className={SECTION} data-home-section={s.key}>
            <SectionHeading title={titleOf(s)} href="/catalogo" linkLabel={t('Ver todas las categorías')} />
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-10">
              {categories.slice(0, s.limit ?? 9).map((c: any) => (
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
        ) : null;
      case 'recommended': {
        const custom = { es: s.title, en: s.titleEn, fr: s.titleFr, ht: s.titleHt }[locale]?.trim();
        return <Recommendations key={s.key} context="home" limit={s.limit ?? 12} title={custom || undefined} className={SECTION} reserveSpace showAddToCart hideSeller gridClassName={HOME_GRID} />;
      }
      case 'flash_deals':
        return productRow(s, { subtitle: t('Rebajas de las tiendas por tiempo limitado: el precio vuelve a la normalidad al terminar la cuenta'), href: '/catalogo?flash=true', link: t('Ver todo') });
      case 'best_sellers':
        return productRow(s, { subtitle: t('Lo más comprado en los últimos {n} días', { n: s.days ?? 30 }), href: '/catalogo?sort=best_selling', link: t('Ver todo') });
      case 'featured':
        return s.items?.length ? productRow(s, { href: '/catalogo', link: t('Ver más productos') }) : null;
      case 'new_arrivals':
        return productRow(s, { subtitle: t('Recién publicados por las tiendas'), href: '/catalogo?sort=newest', link: t('Ver todo') });
      case 'recently_viewed': {
        const custom = { es: s.title, en: s.titleEn, fr: s.titleFr, ht: s.titleHt }[locale]?.trim();
        return <RecentlyViewed key={s.key} title={custom || undefined} limit={s.limit ?? 12} gap={HOME_GAP} className={SECTION} />;
      }
      case 'deals':
        return productRow(s, { href: '/catalogo?onSale=true', link: t('Ver ofertas') });
      case 'category_rows':
        return s.rows?.length ? (
          <div key={s.key} data-home-section={s.key}>
            {s.rows.map((r: any) => (
              <section key={r.category.id} className={SECTION}>
                <SectionHeading title={titleOf(s, { category: t(r.category.name) })} href={`/catalogo/categorias/${r.category.slug}`} linkLabel={t('Ver todo')} />
                <ProductGrid items={r.items} showAddToCart hideSeller gap={HOME_GAP} />
              </section>
            ))}
          </div>
        ) : null;
      case 'top_stores':
        return s.stores?.length ? (
          <section key={s.key} className={SECTION} data-home-section={s.key}>
            <SectionHeading title={titleOf(s)} subtitle={t('Vendedores con las mejores valoraciones')} href="/vendedores" linkLabel={t('Ver todas las tiendas')} />
            <StoreCards stores={s.stores} labels={{ products: (n) => t('{n} productos', { n }), noReviews: t('Sin valoraciones'), identity: t('Identidad verificada'), payout: t('Cobro verificado') }} />
          </section>
        ) : null;
      case 'preorders':
        return productRow(s, { subtitle: t('Resérvalos antes de que lleguen'), href: '/catalogo?preorder=true', link: t('Ver todo') });
      case 'price_ranges': {
        const custom = { es: s.title, en: s.titleEn, fr: s.titleFr, ht: s.titleHt }[locale]?.trim();
        return s.ranges?.length ? <PriceRanges key={s.key} title={custom || undefined} ranges={s.ranges} gap={HOME_GAP} className={SECTION} /> : null;
      }
      case 'seller_banner':
        return (
          <section key={s.key} className={SECTION}>
            <Link href="/vendedor/registro" className="card relative flex flex-col items-start gap-5 overflow-hidden bg-gradient-to-r from-brand-50 to-white p-6 transition hover:shadow-lg sm:flex-row sm:items-center" data-seller-banner>
              <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm"><Store className="size-8" /></div>
              <div className="flex-1">
                <h3 className="text-xl font-extrabold">{titleOf(s)}</h3>
                <p className="mt-1 text-sm text-muted">{t('Abre tu espacio en minutos, gestiona tus envíos internacionales desde un solo panel y vende sin complicaciones técnicas.')}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">{t('Empezar a vender')} <ArrowRight className="size-4" /></span>
            </Link>
          </section>
        );
      case 'guarantees':
        return (
          <section key={s.key} className={SECTION} data-guarantees>
            <div className="mb-4 max-w-3xl">
              <h2 className="text-2xl font-extrabold">{titleOf(s)}</h2>
              <p className="mt-1 text-muted">{t('Comprar fuera de tu país no debería ser complicado. Nosotros nos encargamos de que todo sea transparente.')}</p>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [Truck, 'Costos claros sin sorpresas', 'Visualiza el costo de envío e impuestos antes de pagar, con seguimiento por USPS, UPS, DHL, entre otros.'],
                [ShieldCheck, 'Protección al comprador', 'Si tu pedido no llega o es distinto a lo descrito, nuestro equipo interviene para reembolsar tu dinero.'],
                [Store, 'Tiendas registradas', 'Cada tienda se registra en el marketplace, sus reseñas son públicas y verificamos su cuenta de cobro antes de pagarle. Sus insignias indican solo lo que comprobamos.'],
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
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Hero preview={featured.length ? featured : data?.popular ?? data?.newest ?? []} />
      <section className="border-b border-line bg-white" data-trust-badges>
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-3 lg:px-8">
          {[
            [ShieldCheck, 'Pagos protegidos', 'Pagas con métodos seguros y la tienda recibe tu dinero solo después de la entrega.'],
            [Store, 'Tiendas registradas', 'Cada tienda se registra en el marketplace y verificamos su cuenta de cobro antes de pagarle. Sus insignias indican solo lo que comprobamos.'],
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
        {sections.map(render)}
        {!sections.some((s) => s.items?.length || s.rows?.length || s.ranges?.length) && !categories.length && (
          <div className={`${SECTION} card`}><Empty title={t('Pronto verás productos aquí')} description={t('Los vendedores están preparando su catálogo.')} /></div>
        )}
      </div>
    </>
  );
}
