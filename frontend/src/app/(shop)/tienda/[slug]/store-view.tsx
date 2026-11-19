'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Box, Calendar, Grid2X2, Headphones, Info, List, MessageSquare, Plus, Settings, Share2, ShieldCheck, Star, Tag, Truck, Users, Zap, Check } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, fmtDate, currencySymbol } from '@/lib/utils';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Checkbox, Dialog, Empty, Pagination, Segmented, Skeleton } from '@/components/ui/misc';
import { Input, Select, Textarea } from '@/components/ui/input';
import { ProductGrid, Stars } from '@/components/shop/product-card';
import { useRequireAuth } from '@/components/shop/hooks';
import { LogoMark } from '@/components/layout/logo';
import { t, getIntlLocale } from '@/lib/i18n';

export function StoreView({ initial }: { initial: any }) {
  const { session } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const requireAuth = useRequireAuth();
  const store = useQuery({ queryKey: ['store', initial.slug, !!session], queryFn: () => get(`/stores/${initial.slug}`), initialData: initial }).data;
  const [tab, setTab] = useState<'products' | 'offers' | 'new' | 'reviews' | 'about'>('products');
  const [filters, setFilters] = useState<{ category?: string; brand?: string; inStock: boolean; minPrice?: string; maxPrice?: string; sort: string; page: number }>({ inStock: false, sort: 'relevance', page: 1 });
  const [contact, setContact] = useState(false);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [following, setFollowing] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<{ rating?: number; page: number }>({ page: 1 });
  const params = new URLSearchParams({ seller: store.slug, sort: tab === 'new' ? 'newest' : filters.sort, page: String(filters.page), pageSize: '12' });
  if (filters.category) params.set('category', filters.category);
  if (filters.brand) params.set('brand', filters.brand);
  if (filters.inStock) params.set('inStock', 'true');
  if (tab === 'offers') params.set('onSale', 'true');
  if (filters.minPrice) params.set('minPrice', filters.minPrice);
  if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
  const products = useQuery({ queryKey: ['store-products', params.toString()], queryFn: () => get(`/products?${params}`), enabled: tab !== 'reviews' && tab !== 'about' });
  const reviewsTotal = store.stats.reviews;
  const reviewParams = new URLSearchParams({ page: String(reviewFilter.page) });
  if (reviewFilter.rating) reviewParams.set('rating', String(reviewFilter.rating));
  const reviews = useQuery({ queryKey: ['store-reviews', store.slug, reviewParams.toString()], queryFn: () => get(`/stores/${store.slug}/reviews?${reviewParams}`), enabled: tab === 'reviews' });
  /** Opens the reviews tab, optionally showing only one star rating. */
  const showReviews = (rating?: number) => {
    setTab('reviews');
    setReviewFilter({ rating, page: 1 });
  };
  const shipsFrom = (() => {
    if (!store.shipsFrom) return null;
    let country = store.shipsFrom.countryCode;
    try {
      country = new Intl.DisplayNames([getIntlLocale()], { type: 'region' }).of(country) ?? country;
    } catch {}
    return [store.shipsFrom.city, country].filter(Boolean).join(', ');
  })();

  const follow = async () => {
    if (!requireAuth() || following) return;
    setFollowing(true);
    try {
      const r = await post(`/me/following/${store.id}`);
      toast.success(r.following ? t('Ahora sigues esta tienda.') : t('Dejaste de seguir la tienda.'));
      await qc.invalidateQueries({ queryKey: ['store', store.slug] });
      qc.invalidateQueries({ queryKey: ['following'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setFollowing(false);
    }
  };
  const share = async () => {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: store.name, url }).catch(() => undefined);
    else {
      await navigator.clipboard.writeText(url);
      toast.success(t('Enlace copiado.'));
    }
  };
  const send = async () => {
    setSending(true);
    try {
      const r = await post('/conversations', { sellerId: store.id, message: msg });
      router.push(`/cuenta/mensajes?c=${r.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  };
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 lg:px-8">
      <Breadcrumbs items={[{ label: t('Vendedores'), href: '/vendedores' }, { label: store.name }]} />
      <section className="relative mt-4 overflow-hidden rounded-3xl bg-gradient-to-r from-brand-100 via-brand-200 to-brand-400">
        {store.bannerUrl && <img src={store.bannerUrl} alt="" className="absolute inset-0 size-full object-cover opacity-70" />}
        <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
          <div className="grid size-32 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white shadow-lg">
            {store.logoUrl ? <img src={store.logoUrl} alt={store.name} className="size-full object-cover" /> : <LogoMark className="size-16" />}
          </div>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-3xl font-extrabold">{store.name} {store.verified && <BadgeCheck className="size-7 fill-brand-600 text-white" />}</h1>
            {store.shortDescription && <p className="mt-1 text-ink/80">{store.shortDescription}</p>}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <button type="button" onClick={() => showReviews()} className="inline-flex items-center gap-1 hover:underline"><Star className="size-4 fill-amber-400 text-amber-400" /> <b>{store.stats.rating ? store.stats.rating.toFixed(1) : '—'}</b> ({reviewsTotal.toLocaleString(getIntlLocale())} {t('valoraciones)')}</button>
              <span className="inline-flex items-center gap-1"><Box className="size-4" /> <b>{store.stats.products.toLocaleString(getIntlLocale())}</b> {t('productos')}</span>
              <span className="inline-flex items-center gap-1"><Users className="size-4" /> <b>{store.stats.followers.toLocaleString(getIntlLocale())}</b> {t('seguidores')}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              {store.isOwnStore ? (
                <Button asChild><Link href="/vendedor/configuracion"><Settings /> {t('Editar mi tienda')}</Link></Button>
              ) : (
                <>
                  <Button onClick={follow} loading={following} title={store.isFollowing ? t('Dejar de seguir') : undefined}>{store.isFollowing ? <><Check /> {t('Siguiendo')}</> : <><Plus /> {t('Seguir tienda')}</>}</Button>
                  <Button variant="outline" onClick={() => (requireAuth() ? setContact(true) : null)}><MessageSquare /> {t('Contactar vendedor')}</Button>
                </>
              )}
              <Button variant="secondary" onClick={share}><Share2 /> {t('Compartir')}</Button>
            </div>
          </div>
        </div>
      </section>

      <Segmented
        className="mt-4"
        value={tab}
        onChange={(lbl) => { setTab(lbl); setFilters((f) => ({ ...f, page: 1 })); if (lbl === 'reviews') setReviewFilter({ page: 1 }); }}
        options={[
          { value: 'products', label: <span className="flex items-center gap-2"><Grid2X2 className="size-4" /> {t('Productos')}</span>, count: store.stats.products },
          { value: 'offers', label: <span className="flex items-center gap-2"><Tag className="size-4" /> {t('Ofertas')}</span>, count: store.offers },
          { value: 'new', label: <span className="flex items-center gap-2"><Zap className="size-4" /> {t('Novedades')}</span> },
          { value: 'reviews', label: <span className="flex items-center gap-2"><Star className="size-4" /> {t('Valoraciones')}</span>, count: reviewsTotal },
          { value: 'about', label: <span className="flex items-center gap-2"><Info className="size-4" /> {t('Acerca de la tienda')}</span> },
        ]}
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-[250px_1fr_300px]">
        <aside className="card h-fit space-y-5 p-5">
          <div className="flex items-center justify-between"><p className="text-lg font-bold">{t('Filtros')}</p><button className="text-sm font-semibold text-brand-700 underline" onClick={() => setFilters({ inStock: false, sort: 'relevance', page: 1 })}>{t('Limpiar filtros')}</button></div>
          <div>
            <p className="mb-2 text-sm font-bold">{t('Categoría')}</p>
            {store.categories.map((c: any) => (
              <Checkbox key={c.slug} className="flex py-1" checked={filters.category === c.slug} onChange={(v) => set({ category: v ? c.slug : undefined })} label={<span>{c.name} <span className="text-muted">({c.count})</span></span>} />
            ))}
          </div>
          <div>
            <p className="mb-2 text-sm font-bold">{`${t('Precio')} (${currencySymbol()})`}</p>
            <div className="flex gap-2"><Input placeholder={t('Mín.')} value={filters.minPrice ?? ''} onChange={(e) => set({ minPrice: e.target.value.replace(/\D/g, '') })} /><Input placeholder={t('Máx.')} value={filters.maxPrice ?? ''} onChange={(e) => set({ maxPrice: e.target.value.replace(/\D/g, '') })} /></div>
          </div>
          {store.brands.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-bold">{t('Marca')}</p>
              {store.brands.map((b: any) => (
                <Checkbox key={b.slug} className="flex py-1" checked={filters.brand === b.slug} onChange={(v) => set({ brand: v ? b.slug : undefined })} label={<span>{b.name} <span className="text-muted">({b.count})</span></span>} />
              ))}
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-bold">{t('Disponibilidad')}</p>
            <Checkbox checked={filters.inStock} onChange={(v) => set({ inStock: v })} label={t('Solo disponibles')} />
          </div>
        </aside>

        <section className="card p-4">
          {tab === 'about' ? (
            <div className="p-2">
              <h2 className="text-xl font-bold">{t('Acerca de')}{' '}{store.name}</h2>
              <p className="mt-3 whitespace-pre-line text-ink/90">{store.description || store.shortDescription || t('Esta tienda aún no ha agregado una descripción.')}</p>
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted">{t('Vendedor desde')}</dt><dd className="font-semibold">{fmtDate(store.memberSince)}</dd></div>
                {store.supportEmail && <div><dt className="text-muted">{t('Correo de atención')}</dt><dd className="font-semibold">{store.supportEmail}</dd></div>}
                {store.supportPhone && <div><dt className="text-muted">{t('Teléfono')}</dt><dd className="font-semibold">{store.supportPhone}</dd></div>}
              </dl>
            </div>
          ) : tab === 'reviews' ? (
            <div className="p-2">
              <h2 className="text-xl font-bold">{t('Valoraciones de la tienda')}</h2>
              <p className="mt-1 text-sm text-muted">{t('Basadas en compras verificadas de sus productos.')}</p>
              <div className="mt-4 max-w-md space-y-1">
                {store.ratingDistribution.map((d: any) => (
                  <button key={d.rating} type="button" disabled={!d.count} onClick={() => setReviewFilter((f) => ({ rating: f.rating === d.rating ? undefined : d.rating, page: 1 }))}
                    className={cn('flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-sm enabled:hover:bg-brand-50 disabled:cursor-default', reviewFilter.rating === d.rating && 'bg-brand-50 font-semibold')}>
                    <span className="w-3">{d.rating}</span><Star className="size-3.5 fill-amber-400 text-amber-400" /><div className="h-2 flex-1 rounded-full bg-brand-50"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${reviewsTotal ? (d.count / reviewsTotal) * 100 : 0}%` }} /></div><span className="w-16 text-right text-muted">{d.count} · {reviewsTotal ? Math.round((d.count / reviewsTotal) * 100) : 0}%</span>
                  </button>
                ))}
              </div>
              {reviewFilter.rating && (
                <p className="mt-3 text-sm">{t('Mostrando solo valoraciones de {n} estrellas.', { n: reviewFilter.rating })}{' '}<button type="button" className="font-semibold text-brand-700 underline" onClick={() => setReviewFilter({ page: 1 })}>{t('Ver todas')}</button></p>
              )}
              <div className="mt-5 space-y-4">
                {reviews.isLoading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)
                  : reviews.data?.items?.length ? (
                    <>
                      {reviews.data.items.map((r: any) => (
                        <div key={r.id} className="border-b border-line pb-4">
                          <div className="flex items-center justify-between"><Stars value={r.rating} /><span className="text-xs text-muted">{fmtDate(r.createdAt)}</span></div>
                          {r.title && <p className="mt-1 font-semibold">{r.title}</p>}
                          {r.body && <p className="mt-1 text-sm text-ink/90">{r.body}</p>}
                          <p className="mt-1 text-xs text-muted">
                            {r.author} {t('· Compra verificada')}
                            {r.product?.title && <> · {r.product.slug ? <Link href={`/producto/${r.product.slug}`} className="text-brand-700 hover:underline">{r.product.title}</Link> : r.product.title}</>}
                          </p>
                        </div>
                      ))}
                      <Pagination page={reviewFilter.page} pageSize={10} total={reviews.data.total} onPage={(p) => setReviewFilter((f) => ({ ...f, page: p }))} label={t('valoraciones')} />
                    </>
                  ) : <Empty title={t('Aún no hay opiniones')} description={t('Las opiniones provienen de compradores que recibieron el producto.')} />}
              </div>
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted">{products.data ? t('Mostrando {a} – {b} de {c} productos', { a: products.data.items.length ? (filters.page - 1) * 12 + 1 : 0, b: (filters.page - 1) * 12 + products.data.items.length, c: products.data.total.toLocaleString(getIntlLocale()) }) : 'Cargando…'}</p>
                <div className="flex items-center gap-2"><span className="text-sm font-semibold">{t('Ordenar por:')}</span>
                  <Select value={filters.sort} onChange={(e) => set({ sort: e.target.value })} className="w-48">
                    <option value="relevance">{t('Más relevantes')}</option><option value="newest">{t('Más recientes')}</option><option value="price_asc">{t('Precio: menor a mayor')}</option><option value="price_desc">{t('Precio: mayor a menor')}</option><option value="rating">{t('Mejor valorados')}</option>
                  </Select>
                </div>
              </div>
              {products.isLoading ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-72" />)}</div>
                : products.data?.items.length ? (
                  <>
                    <ProductGrid items={products.data.items} showAddToCart cols="md:grid-cols-3 xl:grid-cols-4" />
                    <Pagination page={filters.page} pageSize={12} total={products.data.total} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} label={t('productos')} />
                  </>
                ) : <Empty title={t('No hay productos con estos filtros')} />}
            </>
          )}
        </section>

        <aside className="space-y-4">
          <div className="card p-5">
            <p className="text-lg font-bold">{t('Sobre la tienda')}</p>
            <ul className="mt-3 space-y-2.5 text-sm">
              <li className="flex items-center gap-2"><Calendar className="size-4 text-muted" /> {t('Vendedor desde:')}{' '}{fmtDate(store.memberSince)}</li>
              {store.verified && <li className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted" /> {t('Tienda verificada')}</li>}
              {shipsFrom && <li className="flex items-center gap-2"><Truck className="size-4 text-muted" /> {t('Envía desde:')}{' '}<b>{shipsFrom}</b></li>}
            </ul>
          </div>
          <div className="card p-5">
            <p className="text-lg font-bold">{t('Calificación de la tienda')}</p>
            <p className="mt-2 flex items-center gap-2 text-3xl font-extrabold">{store.stats.rating ? store.stats.rating.toFixed(1) : '—'} <Star className="size-6 fill-amber-400 text-amber-400" /> <span className="text-sm font-normal text-muted">({reviewsTotal.toLocaleString(getIntlLocale())} {t('valoraciones)')}</span></p>
            <div className="mt-3 space-y-0.5">
              {store.ratingDistribution.map((d: any) => (
                <button key={d.rating} type="button" disabled={!d.count} onClick={() => showReviews(d.rating)} title={d.count ? t('Ver valoraciones de {n} estrellas', { n: d.rating }) : undefined}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-xs enabled:hover:bg-brand-50 disabled:cursor-default">
                  <span className="w-3">{d.rating}</span><Star className="size-3 fill-amber-400 text-amber-400" /><div className="h-2 flex-1 rounded-full bg-brand-50"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${reviewsTotal ? (d.count / reviewsTotal) * 100 : 0}%` }} /></div><span className="w-9 text-right">{reviewsTotal ? Math.round((d.count / reviewsTotal) * 100) : 0}%</span>
                </button>
              ))}
            </div>
            {reviewsTotal > 0 && <button type="button" className="mt-3 text-sm font-semibold text-brand-700 underline" onClick={() => showReviews()}>{t('Leer valoraciones')}</button>}
          </div>
          <div className="rounded-[14px] bg-brand-50 p-5">
            <p className="flex items-center gap-2 text-lg font-bold"><Headphones className="size-5 text-brand-600" /> {t('¿Necesitas ayuda?')}</p>
            <p className="mt-2 text-sm text-muted">{t('Contacta directamente con el vendedor para consultas sobre productos, envíos o devoluciones.')}</p>
            {!store.isOwnStore && <Button variant="outline" className="mt-4 w-full bg-white" onClick={() => (requireAuth() ? setContact(true) : null)}><MessageSquare /> {t('Contactar vendedor')}</Button>}
          </div>
        </aside>
      </div>
      <Dialog open={contact} onOpenChange={setContact} title={t('Escribir a {name}', { name: store.name })} footer={<><Button variant="secondary" onClick={() => setContact(false)}>{t('Cancelar')}</Button><Button onClick={send} loading={sending} disabled={msg.trim().length < 3}>{t('Enviar')}</Button></>}>
        <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t('Escribe tu consulta…')} maxLength={1000} />
      </Dialog>
    </div>
  );
}
