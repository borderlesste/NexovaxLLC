'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, BadgeCheck, Box, Check, CreditCard, ExternalLink, FileText, Heart, HelpCircle, List, Maximize2, MessageSquare, Minus, Plus, RotateCcw, ShieldCheck,
  ShoppingCart, Star, Store, Truck, Zap,
} from 'lucide-react';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money, cn, fmtDate } from '@/lib/utils';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, Empty, Segmented } from '@/components/ui/misc';
import { Textarea } from '@/components/ui/input';
import { ProductCard, ProductImage, Stars } from '@/components/shop/product-card';
import { useAddToCart, useRequireAuth, useToggleFavorite } from '@/components/shop/hooks';
import { post, errorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { t, getIntlLocale } from '@/lib/i18n';

export function ProductDetail({ initial }: { initial: any }) {
  const router = useRouter();
  const { session } = useAuth();
  const q = useQuery({ queryKey: ['product', initial.slug, !!session], queryFn: () => get(`/products/${initial.slug}`), initialData: initial });
  const p = q.data;
  const [img, setImg] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState<'desc' | 'specs' | 'reviews' | 'questions'>('desc');
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const v = p.variants.find((x: any) => x.stock > 0) ?? p.variants[0];
    return { ...(v?.optionValues ?? {}) };
  });
  const variant = useMemo(() => {
    if (!p.options.length) return p.variants[0];
    return p.variants.find((v: any) => p.options.every((o: any) => v.optionValues?.[o.id] === selected[o.id]));
  }, [p, selected]);
  const cart = useAddToCart();
  const fav = useToggleFavorite();
  const requireAuth = useRequireAuth();
  const reviews = useQuery({ queryKey: ['reviews', p.slug], queryFn: () => get(`/products/${p.slug}/reviews`), enabled: tab === 'reviews' });
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);

  const price = variant?.price ?? p.price;
  const compare = variant?.compareAtPrice ?? p.compareAtPrice;
  const discount = price && compare && Number(compare) > Number(price) ? Math.round((1 - Number(price) / Number(compare)) * 100) : null;
  const stock = variant?.stock ?? 0;
  const images = p.images.length ? p.images : [{ url: null, alt: p.title }];

  const isAvailable = (optionId: string, valueId: string) =>
    p.variants.some((v: any) => v.optionValues?.[optionId] === valueId && v.stock > 0 && p.options.every((o: any) => o.id === optionId || !selected[o.id] || v.optionValues?.[o.id] === selected[o.id]));

  const addToCart = async (buyNow = false) => {
    if (!variant) return toast.error(t('Selecciona una combinación disponible.'));
    const r = await cart.add(variant.id, qty);
    if (r && buyNow) router.push('/checkout');
  };

  const ask = async () => {
    if (!requireAuth()) return;
    setAsking(true);
    try {
      const r = await post('/conversations', { productId: p.id, message: question });
      toast.success(t('Mensaje enviado al vendedor.'));
      router.push(`/cuenta/mensajes?c=${r.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setAsking(false);
    }
  };

  const features = (p.specifications ?? []).slice(0, 4);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 lg:px-8">
      <Breadcrumbs items={[...p.breadcrumbs.map((b: any) => ({ label: b.name, href: `/catalogo/categorias/${b.slug}` })), { label: p.title }]} />
      <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          {/* gallery */}
          <div className="flex gap-3">
            <div className="hidden w-20 shrink-0 flex-col gap-2 sm:flex">
              {images.map((im: any, i: number) => (
                <button key={i} onClick={() => setImg(i)} className={cn('overflow-hidden rounded-xl border-2 bg-white', i === img ? 'border-brand-600' : 'border-line')}>
                  <ProductImage src={im.url} alt={im.alt} className="aspect-square w-full" />
                </button>
              ))}
            </div>
            <div className="relative flex-1">
              <div className="card relative overflow-hidden bg-brand-50/40">
                <ProductImage src={images[img]?.url} alt={p.title} className="aspect-square w-full" />
                <button onClick={() => fav.toggle(p.id)} className="absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-white shadow" aria-label={t('Favorito')}>
                  <Heart className={cn('size-5', p.isFavorite && 'fill-brand-600 text-brand-600')} />
                </button>
                {images[img]?.url && (
                  <button onClick={() => setZoom(true)} className="absolute bottom-4 right-4 grid size-10 place-items-center rounded-full bg-white shadow" aria-label={t('Ampliar')}>
                    <Maximize2 className="size-4" />
                  </button>
                )}
              </div>
              <div className="mt-3 flex justify-center gap-1.5">
                {images.map((_: any, i: number) => <span key={i} onClick={() => setImg(i)} className={cn('size-2 cursor-pointer rounded-full', i === img ? 'bg-brand-600' : 'bg-brand-200')} />)}
              </div>
            </div>
          </div>
          {/* info */}
          <div>
            <div className="flex flex-wrap gap-2">
              {p.brand && <Badge tone="violet"><Store className="size-3" /> {p.brand.name}</Badge>}
              <Badge tone="green"><Check className="size-3" /> {t('Producto publicado')}</Badge>
            </div>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight">{p.title}</h1>
            {p.shortDescription && <p className="mt-2 text-muted">{p.shortDescription}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <Stars value={p.rating} count={p.reviewCount} size="md" />
              <span className="h-4 w-px bg-line" />
              <span className="inline-flex items-center gap-1 text-muted"><ShoppingCart className="size-4" /> <b className="text-ink">{p.soldCount.toLocaleString(getIntlLocale())}</b> {t('ventas')}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-4xl font-extrabold">{price ? money(price) : '—'}</span>
              {discount ? <Badge tone="violet" className="text-sm">-{discount}%</Badge> : null}
              {discount ? <span className="text-lg text-muted line-through">{money(compare)}</span> : null}
            </div>
            {features.length > 0 && (
              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {features.map((f: any) => (
                  <div key={f.code} className="rounded-xl border border-line bg-white px-2 py-3 text-center">
                    <p className="text-[11px] text-muted">{f.name}</p>
                    <p className="mt-0.5 truncate text-sm font-semibold">{f.value}</p>
                  </div>
                ))}
              </div>
            )}
            {p.options.map((o: any) => {
              const cur = o.values.find((v: any) => v.id === selected[o.id]);
              const swatch = o.displayType === 'SWATCH';
              return (
                <div key={o.id} className="mt-5">
                  <p className="mb-2 text-sm font-semibold">{o.name}: <span className="font-normal">{cur?.label ?? t('Selecciona')}</span></p>
                  <div className="flex flex-wrap gap-2">
                    {o.values.map((v: any) => {
                      const avail = isAvailable(o.id, v.id);
                      const active = selected[o.id] === v.id;
                      return swatch && v.swatch ? (
                        <button key={v.id} title={v.label} onClick={() => setSelected((s) => ({ ...s, [o.id]: v.id }))} className={cn('grid size-10 place-items-center rounded-full border-2 p-0.5', active ? 'border-brand-600' : 'border-line', !avail && 'opacity-40')}>
                          <span className="size-full rounded-full border border-black/10" style={{ background: v.swatch }} />
                        </button>
                      ) : (
                        <button key={v.id} onClick={() => setSelected((s) => ({ ...s, [o.id]: v.id }))} className={cn('h-10 min-w-12 rounded-lg border px-3 text-sm font-semibold', active ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-white', !avail && 'text-muted line-through')}>
                          {v.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div className="mt-5">
              <p className="mb-2 text-sm font-semibold">{t('Cantidad')}</p>
              <div className="flex items-center gap-4">
                <div className="inline-flex items-center rounded-lg border border-line bg-white">
                  <button className="grid size-10 place-items-center" onClick={() => setQty((x) => Math.max(1, x - 1))} aria-label={t('Menos')}><Minus className="size-4" /></button>
                  <span className="w-10 text-center font-semibold">{qty}</span>
                  <button className="grid size-10 place-items-center" onClick={() => setQty((x) => Math.min(Math.max(stock, 1), x + 1))} aria-label={t('Más')}><Plus className="size-4" /></button>
                </div>
                <span className={cn('text-sm', stock > 0 ? 'text-emerald-600' : 'text-red-600')}>
                  {!variant ? t('Combinación no disponible') : stock > 0 ? (stock <= 5 ? t('¡Solo quedan {a}!', { a: stock }) : `${stock} disponibles`) : t('Agotado')}
                </span>
              </div>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button size="lg" onClick={() => addToCart(false)} loading={cart.isPending} disabled={!variant || stock <= 0}><ShoppingCart /> {t('Agregar al carrito')}</Button>
              <Button size="lg" variant="outline" onClick={() => addToCart(true)} disabled={!variant || stock <= 0}><Zap /> {t('Comprar ahora')}</Button>
            </div>
          </div>
        </div>
        {/* seller + benefits */}
        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <p className="font-bold">{t('Vendido por')}</p>
              <Link href={`/tienda/${p.seller.slug}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">{t('Ver tienda')}{' '}<ExternalLink className="size-3.5" /></Link>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="grid size-14 place-items-center rounded-full bg-brand-50 text-brand-600"><Store className="size-7" /></div>
              <div>
                <p className="flex items-center gap-1 text-lg font-bold">{p.seller.name} {p.seller.verified && <BadgeCheck className="size-5 fill-brand-600 text-white" />}</p>
                <p className="text-sm text-muted">{p.seller.verified ? t('Vendedor verificado') : t('Vendedor')}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1"><Star className="size-4 fill-amber-400 text-amber-400" /> <b className="text-ink">{p.sellerStats.rating ? p.sellerStats.rating.toFixed(1) : '—'}</b> ({p.sellerStats.reviews.toLocaleString(getIntlLocale())} {t('valoraciones)')}</span>
              <span className="inline-flex items-center gap-1"><Box className="size-4" /> <b className="text-ink">{p.sellerStats.products.toLocaleString(getIntlLocale())}</b> {t('productos')}</span>
            </div>
            <Button variant="soft" className="mt-4 w-full" onClick={() => (requireAuth() ? setAskOpen(true) : null)}><MessageSquare /> {t('Contactar vendedor')}</Button>
          </div>
          <div className="card divide-y divide-line px-5">
            {[
              [Truck, t('Envíos nacionales e internacionales'), t('Tarifa y tiempo según tu dirección, calculados en el checkout.')],
              [ShieldCheck, t('Compra segura'), t('Tus datos están protegidos.')],
              [RotateCcw, t('Devoluciones'), t('Hasta 30 días según políticas de la tienda.')],
              [CreditCard, t('Múltiples medios de pago'), t('Tarjetas y transferencias bancarias.')],
            ].map(([Icon, lbl, d]: any) => (
              <div key={lbl} className="flex gap-3 py-4">
                <Icon className="size-6 shrink-0 text-brand-600" />
                <div><p className="font-bold">{t(lbl)}</p><p className="text-sm text-muted">{d}</p></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="card">
          <Segmented
            className="px-3"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'desc', label: <span className="flex items-center gap-2"><FileText className="size-4" /> {t('Descripción')}</span> },
              { value: 'specs', label: <span className="flex items-center gap-2"><List className="size-4" /> {t('Especificaciones')}</span> },
              { value: 'reviews', label: <span className="flex items-center gap-2"><Star className="size-4" /> {t('Opiniones (')}{p.reviewCount})</span> },
              { value: 'questions', label: <span className="flex items-center gap-2"><HelpCircle className="size-4" /> {t('Preguntas')}</span> },
            ]}
          />
          <div className="p-6">
            {tab === 'desc' && (
              <div>
                <h2 className="text-xl font-bold">{t('Descripción del producto')}</h2>
                <p className="mt-3 whitespace-pre-line leading-relaxed text-ink/90">{p.description}</p>
              </div>
            )}
            {tab === 'specs' && (
              p.specifications.length ? (
                <dl className="grid gap-x-6 sm:grid-cols-2">
                  {p.specifications.map((s: any) => (
                    <div key={s.code} className="flex justify-between gap-4 border-b border-line py-2.5 text-sm"><dt className="text-muted">{s.name}</dt><dd className="font-semibold">{s.value}</dd></div>
                  ))}
                  {p.variants[0]?.sku && <div className="flex justify-between gap-4 border-b border-line py-2.5 text-sm"><dt className="text-muted">{t('SKU')}</dt><dd className="font-semibold">{variant?.sku ?? p.variants[0].sku}</dd></div>}
                </dl>
              ) : <Empty title={t('Sin especificaciones')} description={t('El vendedor no agregó especificaciones técnicas.')} />
            )}
            {tab === 'reviews' && (
              <div className="grid gap-6 md:grid-cols-[220px_1fr]">
                <div>
                  <p className="text-4xl font-extrabold">{p.rating ? p.rating.toFixed(1) : '—'}</p>
                  <Stars value={p.rating} count={p.reviewCount} size="md" />
                  <div className="mt-3 space-y-1">
                    {p.ratingDistribution.map((d: any) => (
                      <div key={d.rating} className="flex items-center gap-2 text-xs">
                        <span className="w-3">{d.rating}</span><Star className="size-3 fill-amber-400 text-amber-400" />
                        <div className="h-2 flex-1 rounded-full bg-brand-50"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${p.reviewCount ? (d.count / p.reviewCount) * 100 : 0}%` }} /></div>
                        <span className="w-6 text-right text-muted">{d.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  {reviews.data?.items?.length ? reviews.data.items.map((r: any) => (
                    <div key={r.id} className="border-b border-line pb-4">
                      <div className="flex items-center justify-between"><Stars value={r.rating} /><span className="text-xs text-muted">{fmtDate(r.createdAt)}</span></div>
                      {r.title && <p className="mt-1 font-semibold">{r.title}</p>}
                      {r.body && <p className="mt-1 text-sm text-ink/90">{r.body}</p>}
                      <p className="mt-1 text-xs text-muted">{r.author} {t('· Compra verificada')}</p>
                    </div>
                  )) : <Empty title={t('Aún no hay opiniones')} description={t('Las opiniones provienen de compradores que recibieron el producto.')} />}
                </div>
              </div>
            )}
            {tab === 'questions' && (
              <div className="text-center">
                <Empty icon={<HelpCircle />} title={t('¿Tienes una pregunta?')} description={t('Escríbele directamente al vendedor; te responderá en tu bandeja de mensajes.')} action={<Button onClick={() => (requireAuth() ? setAskOpen(true) : null)}><MessageSquare /> {t('Preguntar al vendedor')}</Button>} />
              </div>
            )}
          </div>
        </div>
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold">{t('Productos relacionados')}</h2>
            <Link href={`/catalogo/categorias/${p.category.slug}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">{t('Ver más')}{' '}<ArrowRight className="size-4" /></Link>
          </div>
          {p.related.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
              {p.related.slice(0, 4).map((r: any) => <ProductCard key={r.id} p={r} />)}
            </div>
          ) : <Empty title={t('Sin productos relacionados')} />}
        </div>
      </div>

      <Dialog open={zoom} onOpenChange={setZoom} title={p.title} size="xl">
        <ProductImage src={images[img]?.url} alt={p.title} className="mx-auto max-h-[70vh] w-full" />
      </Dialog>
      <Dialog open={askOpen} onOpenChange={setAskOpen} title={t('Preguntar al vendedor')} description={`${p.seller.name} · ${p.title}`}
        footer={<><Button variant="secondary" onClick={() => setAskOpen(false)}>{t('Cancelar')}</Button><Button onClick={ask} loading={asking} disabled={question.trim().length < 3}>{t('Enviar mensaje')}</Button></>}>
        <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('Ej. ¿Tienen disponible la talla 42? ¿Cuánto tarda el envío a mi ciudad?')} maxLength={1000} />
      </Dialog>
    </div>
  );
}
