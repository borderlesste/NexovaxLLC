'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Box, Calendar, Grid2X2, Headphones, Info, List, MessageSquare, Plus, Share2, ShieldCheck, Star, Tag, Truck, Users, Zap, Check } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, fmtDate } from '@/lib/utils';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Checkbox, Dialog, Empty, Pagination, Segmented, Skeleton } from '@/components/ui/misc';
import { Input, Select, Textarea } from '@/components/ui/input';
import { ProductGrid } from '@/components/shop/product-card';
import { useRequireAuth } from '@/components/shop/hooks';
import { LogoMark } from '@/components/layout/logo';

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
  const params = new URLSearchParams({ seller: store.slug, sort: tab === 'new' ? 'newest' : filters.sort, page: String(filters.page), pageSize: '12' });
  if (filters.category) params.set('category', filters.category);
  if (filters.brand) params.set('brand', filters.brand);
  if (filters.inStock) params.set('inStock', 'true');
  if (tab === 'offers') params.set('onSale', 'true');
  if (filters.minPrice) params.set('minPrice', filters.minPrice);
  if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
  const products = useQuery({ queryKey: ['store-products', params.toString()], queryFn: () => get(`/products?${params}`), enabled: tab !== 'reviews' && tab !== 'about' });
  const reviewsTotal = store.stats.reviews;

  const follow = async () => {
    if (!requireAuth()) return;
    try {
      const r = await post(`/me/following/${store.id}`);
      toast.success(r.following ? 'Ahora sigues esta tienda.' : 'Dejaste de seguir la tienda.');
      qc.invalidateQueries({ queryKey: ['store', store.slug] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const share = async () => {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: store.name, url }).catch(() => undefined);
    else {
      await navigator.clipboard.writeText(url);
      toast.success('Enlace copiado.');
    }
  };
  const send = async () => {
    setSending(true);
    try {
      const r = await post('/conversations', { sellerId: store.id, message: msg });
      router.push(`/mensajes?c=${r.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  };
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 lg:px-8">
      <Breadcrumbs items={[{ label: 'Vendedores', href: '/vendedores' }, { label: store.name }]} />
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
              <span className="inline-flex items-center gap-1"><Star className="size-4 fill-amber-400 text-amber-400" /> <b>{store.stats.rating ? store.stats.rating.toFixed(1) : '—'}</b> ({reviewsTotal.toLocaleString('es-DO')} valoraciones)</span>
              <span className="inline-flex items-center gap-1"><Box className="size-4" /> <b>{store.stats.products.toLocaleString('es-DO')}</b> productos</span>
              <span className="inline-flex items-center gap-1"><Users className="size-4" /> <b>{store.stats.followers.toLocaleString('es-DO')}</b> seguidores</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button onClick={follow}>{store.isFollowing ? <><Check /> Siguiendo</> : <><Plus /> Seguir tienda</>}</Button>
              <Button variant="outline" onClick={() => (requireAuth() ? setContact(true) : null)}><MessageSquare /> Contactar vendedor</Button>
              <Button variant="secondary" onClick={share}><Share2 /> Compartir</Button>
            </div>
          </div>
        </div>
      </section>

      <Segmented
        className="mt-4"
        value={tab}
        onChange={(t) => { setTab(t); setFilters((f) => ({ ...f, page: 1 })); }}
        options={[
          { value: 'products', label: <span className="flex items-center gap-2"><Grid2X2 className="size-4" /> Productos</span>, count: store.stats.products },
          { value: 'offers', label: <span className="flex items-center gap-2"><Tag className="size-4" /> Ofertas</span>, count: store.offers },
          { value: 'new', label: <span className="flex items-center gap-2"><Zap className="size-4" /> Novedades</span> },
          { value: 'reviews', label: <span className="flex items-center gap-2"><Star className="size-4" /> Valoraciones</span>, count: reviewsTotal },
          { value: 'about', label: <span className="flex items-center gap-2"><Info className="size-4" /> Acerca de la tienda</span> },
        ]}
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-[250px_1fr_300px]">
        <aside className="card h-fit space-y-5 p-5">
          <div className="flex items-center justify-between"><p className="text-lg font-bold">Filtros</p><button className="text-sm font-semibold text-brand-700 underline" onClick={() => setFilters({ inStock: false, sort: 'relevance', page: 1 })}>Limpiar filtros</button></div>
          <div>
            <p className="mb-2 text-sm font-bold">Categoría</p>
            {store.categories.map((c: any) => (
              <Checkbox key={c.slug} className="flex py-1" checked={filters.category === c.slug} onChange={(v) => set({ category: v ? c.slug : undefined })} label={<span>{c.name} <span className="text-muted">({c.count})</span></span>} />
            ))}
          </div>
          <div>
            <p className="mb-2 text-sm font-bold">Precio (RD$)</p>
            <div className="flex gap-2"><Input placeholder="Mín." value={filters.minPrice ?? ''} onChange={(e) => set({ minPrice: e.target.value.replace(/\D/g, '') })} /><Input placeholder="Máx." value={filters.maxPrice ?? ''} onChange={(e) => set({ maxPrice: e.target.value.replace(/\D/g, '') })} /></div>
          </div>
          {store.brands.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-bold">Marca</p>
              {store.brands.map((b: any) => (
                <Checkbox key={b.slug} className="flex py-1" checked={filters.brand === b.slug} onChange={(v) => set({ brand: v ? b.slug : undefined })} label={<span>{b.name} <span className="text-muted">({b.count})</span></span>} />
              ))}
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-bold">Disponibilidad</p>
            <Checkbox checked={filters.inStock} onChange={(v) => set({ inStock: v })} label="Solo disponibles" />
          </div>
        </aside>

        <section className="card p-4">
          {tab === 'about' ? (
            <div className="p-2">
              <h2 className="text-xl font-bold">Acerca de {store.name}</h2>
              <p className="mt-3 whitespace-pre-line text-ink/90">{store.description || store.shortDescription || 'Esta tienda aún no ha agregado una descripción.'}</p>
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted">Vendedor desde</dt><dd className="font-semibold">{fmtDate(store.memberSince)}</dd></div>
                {store.supportEmail && <div><dt className="text-muted">Correo de atención</dt><dd className="font-semibold">{store.supportEmail}</dd></div>}
                {store.supportPhone && <div><dt className="text-muted">Teléfono</dt><dd className="font-semibold">{store.supportPhone}</dd></div>}
              </dl>
            </div>
          ) : tab === 'reviews' ? (
            <div className="p-2">
              <h2 className="text-xl font-bold">Valoraciones de la tienda</h2>
              <p className="mt-1 text-sm text-muted">Basadas en compras verificadas de sus productos.</p>
              <div className="mt-4 max-w-md space-y-2">
                {store.ratingDistribution.map((d: any) => (
                  <div key={d.rating} className="flex items-center gap-2 text-sm"><span className="w-3">{d.rating}</span><Star className="size-3.5 fill-amber-400 text-amber-400" /><div className="h-2 flex-1 rounded-full bg-brand-50"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${reviewsTotal ? (d.count / reviewsTotal) * 100 : 0}%` }} /></div><span className="w-10 text-right text-muted">{reviewsTotal ? Math.round((d.count / reviewsTotal) * 100) : 0}%</span></div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted">{products.data ? `Mostrando ${products.data.items.length ? (filters.page - 1) * 12 + 1 : 0} – ${(filters.page - 1) * 12 + products.data.items.length} de ${products.data.total.toLocaleString('es-DO')} productos` : 'Cargando…'}</p>
                <div className="flex items-center gap-2"><span className="text-sm font-semibold">Ordenar por:</span>
                  <Select value={filters.sort} onChange={(e) => set({ sort: e.target.value })} className="w-48">
                    <option value="relevance">Más relevantes</option><option value="newest">Más recientes</option><option value="price_asc">Precio: menor a mayor</option><option value="price_desc">Precio: mayor a menor</option><option value="rating">Mejor valorados</option>
                  </Select>
                </div>
              </div>
              {products.isLoading ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-72" />)}</div>
                : products.data?.items.length ? (
                  <>
                    <ProductGrid items={products.data.items} showAddToCart cols="md:grid-cols-3 xl:grid-cols-4" />
                    <Pagination page={filters.page} pageSize={12} total={products.data.total} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} label="productos" />
                  </>
                ) : <Empty title="No hay productos con estos filtros" />}
            </>
          )}
        </section>

        <aside className="space-y-4">
          <div className="card p-5">
            <p className="text-lg font-bold">Sobre la tienda</p>
            <ul className="mt-3 space-y-2.5 text-sm">
              <li className="flex items-center gap-2"><Calendar className="size-4 text-muted" /> Vendedor desde: {fmtDate(store.memberSince)}</li>
              {store.verified && <li className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted" /> Tienda verificada</li>}
              <li className="flex items-center gap-2"><Truck className="size-4 text-muted" /> <b>Envíos a todo el país</b></li>
            </ul>
          </div>
          <div className="card p-5">
            <p className="text-lg font-bold">Calificación de la tienda</p>
            <p className="mt-2 flex items-center gap-2 text-3xl font-extrabold">{store.stats.rating ? store.stats.rating.toFixed(1) : '—'} <Star className="size-6 fill-amber-400 text-amber-400" /> <span className="text-sm font-normal text-muted">({reviewsTotal.toLocaleString('es-DO')} valoraciones)</span></p>
            <div className="mt-3 space-y-1.5">
              {store.ratingDistribution.map((d: any) => (
                <div key={d.rating} className="flex items-center gap-2 text-xs"><span className="w-3">{d.rating}</span><Star className="size-3 fill-amber-400 text-amber-400" /><div className="h-2 flex-1 rounded-full bg-brand-50"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${reviewsTotal ? (d.count / reviewsTotal) * 100 : 0}%` }} /></div><span className="w-9 text-right">{reviewsTotal ? Math.round((d.count / reviewsTotal) * 100) : 0}%</span></div>
              ))}
            </div>
          </div>
          <div className="rounded-[14px] bg-brand-50 p-5">
            <p className="flex items-center gap-2 text-lg font-bold"><Headphones className="size-5 text-brand-600" /> ¿Necesitas ayuda?</p>
            <p className="mt-2 text-sm text-muted">Contacta directamente con el vendedor para consultas sobre productos, envíos o devoluciones.</p>
            <Button variant="outline" className="mt-4 w-full bg-white" onClick={() => (requireAuth() ? setContact(true) : null)}><MessageSquare /> Contactar vendedor</Button>
          </div>
        </aside>
      </div>
      <Dialog open={contact} onOpenChange={setContact} title={`Escribir a ${store.name}`} footer={<><Button variant="secondary" onClick={() => setContact(false)}>Cancelar</Button><Button onClick={send} loading={sending} disabled={msg.trim().length < 3}>Enviar</Button></>}>
        <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Escribe tu consulta…" maxLength={1000} />
      </Dialog>
    </div>
  );
}
