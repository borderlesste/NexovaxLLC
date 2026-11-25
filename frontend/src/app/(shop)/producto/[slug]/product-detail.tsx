'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, BadgeCheck, Box, Check, CreditCard, ExternalLink, HelpCircle, List, MessageSquare, Minus, Plus, RotateCcw, ShieldCheck,
  ShoppingCart, Star, Store, Truck, Zap,
} from 'lucide-react';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EarnBox } from '@/components/affiliates/earn-box';
import { ShareButton } from '@/components/shop/share-button';
import { StockAlertButton } from '@/components/shop/stock-alert';
import { ProductPreorder, useProductPreorders } from '@/components/shop/product-preorder';
import { AvailabilityPanel } from '@/components/shop/availability';
import { Recommendations } from '@/components/shop/recommendations';
import { trackProductView } from '@/lib/analytics';
import { ga, type GaItem } from '@/lib/ga';
import { money, cn, fmtDate } from '@/lib/utils';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, Empty, Segmented } from '@/components/ui/misc';
import { Textarea } from '@/components/ui/input';
import { ProductCard, Stars } from '@/components/shop/product-card';
import { useAddToCart, useRequireAuth } from '@/components/shop/hooks';
import { post, errorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { ProductGallery } from './product-gallery';
import { isColorOption } from '@/lib/variant-words';
import { productMetadataLabels } from '@/lib/product-metadata';
import { t, getIntlLocale, getLocale } from '@/lib/i18n';

export function ProductDetail({ initial }: { initial: any }) {
  const router = useRouter();
  const { session } = useAuth();
  useEffect(() => trackProductView(initial.id), [initial.id]);
  const q = useQuery({ queryKey: ['product', initial.slug, !!session], queryFn: () => get(`/products/${initial.slug}`), initialData: initial });
  const p = q.data;
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState<'specs' | 'reviews' | 'questions'>('specs');
  const [choice, setChoice] = useState<Record<string, string> | null>(null);
  const preorders = useProductPreorders(p.id, p.variants.some((v: any) => v.stock <= 0));
  const offers = preorders.data?.items ?? [];
  const reservableVariants = new Set(offers.filter((offer) => offer.remaining > 0).map((offer) => offer.variantId));
  const firstVariant = p.variants.find((v: any) => v.stock > 0)
    ?? p.variants.find((v: any) => reservableVariants.has(v.id))
    ?? p.variants.find((v: any) => offers.some((offer) => offer.variantId === v.id))
    ?? p.variants[0];
  const selected = choice ?? firstVariant?.optionValues ?? {};
  const selectOption = (optionId: string, valueId: string) => setChoice({ ...selected, [optionId]: valueId });
  const variant = useMemo(() => {
    if (!p.options.length) return p.variants[0];
    return p.variants.find((v: any) => p.options.every((o: any) => v.optionValues?.[o.id] === selected[o.id]));
  }, [p, selected]);
  const cart = useAddToCart();
  const requireAuth = useRequireAuth();
  const reviews = useQuery({ queryKey: ['reviews', p.slug], queryFn: () => get(`/products/${p.slug}/reviews`), enabled: tab === 'reviews' });
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);

  const price = variant?.price ?? p.price;
  const compare = variant?.compareAtPrice ?? p.compareAtPrice;
  const discount = price && compare && Number(compare) > Number(price) ? Math.round((1 - Number(price) / Number(compare)) * 100) : null;
  const stock = variant?.stock ?? 0;
  const preorder = stock <= 0 ? offers.find((offer) => offer.variantId === variant?.id) : undefined;
  const hasReviews = p.reviewCount > 0;
  const colorOption = p.options.find((o: any) => isColorOption(o.name))
    ?? p.options.find((o: any) => o.displayType === 'SWATCH');
  const colorVariants = colorOption ? p.variants
    .filter((v: any) => v.optionValues?.[colorOption.id] === selected[colorOption.id])
    .map((v: any) => v.id) : [];
  const labels = productMetadataLabels(getLocale());

  const isAvailable = (optionId: string, valueId: string) =>
    p.variants.some((v: any) => v.optionValues?.[optionId] === valueId
      && (v.stock > 0 || reservableVariants.has(v.id))
      && p.options.every((o: any) => o.id === optionId || !selected[o.id] || v.optionValues?.[o.id] === selected[o.id]));

  const gaItem = (): GaItem => ({
    item_id: p.id, item_name: p.title, price: ga.num(variant?.price ?? p.price), item_brand: p.brand?.name ?? undefined,
    item_category: p.category?.name ?? undefined, item_variant: p.variants.length > 1 ? variant?.title ?? undefined : undefined, affiliation: p.seller?.name ?? undefined,
  });
  // GA4 view_item, once per product page (only with analytics consent).
  useEffect(() => ga.viewItem(p.currency, gaItem()), [p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addToCart = async (buyNow = false) => {
    if (!variant) return toast.error(t('Selecciona una combinación disponible.'));
    const r = await cart.add(variant.id, qty);
    if (r) ga.addToCart(p.currency, { ...gaItem(), quantity: qty });
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
    <div className="mx-auto max-w-[1400px] px-4 py-4 lg:px-8">
      <Breadcrumbs items={[...p.breadcrumbs.map((b: any) => ({ label: b.name, href: `/catalogo/categorias/${b.slug}` })), { label: p.title }]} />
      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-7">
        <ProductGallery key={JSON.stringify([p.id, selected])} product={p} variantId={variant?.id} colorVariants={colorVariants} />
        <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {p.brand && <Badge tone="violet"><Store className="size-3" /> {p.brand.name}</Badge>}
              <Badge tone="green"><Check className="size-3" /> {t('Producto publicado')}</Badge>
              {(p.condition === 'NEW' || p.condition === 'USED') && (
                <Badge><span>{labels.condition} · {p.condition === 'NEW' ? labels.new : labels.used}</span></Badge>
              )}
              <ShareButton product={p} className="ml-auto" />
            </div>
            <h1 className="mt-3 break-words text-2xl font-extrabold leading-tight sm:text-3xl">{p.title}</h1>
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
              return (
                <div key={o.id} className="mt-5">
                  <p className="mb-2 text-sm font-semibold">{o.name}: <span className="font-normal">{cur?.label ?? t('Selecciona')}</span></p>
                  <div className="flex flex-wrap gap-2">
                    {o.values.map((v: any) => {
                      const avail = isAvailable(o.id, v.id);
                      const active = selected[o.id] === v.id;
                      return v.swatch ? (
                        <button key={v.id} title={v.label} aria-label={v.label} aria-pressed={active} onClick={() => selectOption(o.id, v.id)} className={cn('grid size-10 place-items-center rounded-full border-2 p-0.5', active ? 'border-brand-600' : 'border-line', !avail && 'opacity-40')}>
                          <span className="size-full rounded-full border border-black/10" style={{ background: v.swatch }} />
                        </button>
                      ) : (
                        <button key={v.id} aria-pressed={active} onClick={() => selectOption(o.id, v.id)} className={cn('h-10 min-w-12 rounded-lg border px-3 text-sm font-semibold', active ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-white', !avail && 'text-muted line-through')}>
                          {v.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {p.sizeGuide?.trim() && (
              <details className="mt-3 rounded-lg border border-line bg-white px-3 py-2.5">
                <summary className="cursor-pointer text-sm font-semibold text-brand-700">{labels.sizeGuide}</summary>
                <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed">{p.sizeGuide}</p>
              </details>
            )}
            {!preorder && <div className="mt-4">
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
            </div>}
            <AvailabilityPanel productId={p.id} variantId={variant?.id ?? null} className="mt-5" />
            {preorder ? (
              <div className="mt-4 space-y-2">
                <ProductPreorder key={preorder.offerId} offer={preorder} productId={p.id} sellerId={p.seller.id} />
                {preorder.remaining <= 0 && <StockAlertButton productId={p.id} variantId={p.variants.length > 1 ? variant.id : null} slug={p.slug} />}
              </div>
            ) : <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button size="lg" onClick={() => addToCart(false)} loading={cart.isPending} disabled={!variant || stock <= 0}><ShoppingCart /> {t('Agregar al carrito')}</Button>
              <Button size="lg" variant="outline" onClick={() => addToCart(true)} disabled={!variant || stock <= 0}><Zap /> {t('Comprar ahora')}</Button>
              {variant && stock <= 0 && <StockAlertButton productId={p.id} variantId={p.variants?.length > 1 ? variant.id : null} slug={p.slug} />}
            </div>}
          </div>
          {p.description && (
            <section className="card p-4">
              <h2 className="text-lg font-bold">{t('Descripción del producto')}</h2>
              <p className="mt-2 whitespace-pre-line break-words leading-relaxed text-ink/90">{p.description}</p>
            </section>
          )}
          <div className="card p-4">
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
              <Stars value={p.sellerStats.rating} count={p.sellerStats.reviews} countLabel={t('valoraciones')} size="md" />
              <span className="inline-flex items-center gap-1"><Box className="size-4" /> <b className="text-ink">{p.sellerStats.products.toLocaleString(getIntlLocale())}</b> {t('productos')}</span>
            </div>
            <Button variant="soft" className="mt-4 w-full" onClick={() => (requireAuth() ? setAskOpen(true) : null)}><MessageSquare /> {t('Contactar vendedor')}</Button>
          </div>
          <EarnBox productId={p.id} slug={p.slug} />
          <div className="card divide-y divide-line px-5">
            {[
              [Truck, t('Envíos nacionales e internacionales'), t('Tarifa y tiempo según tu dirección, calculados en el checkout.')],
              [ShieldCheck, t('Compra segura'), t('Tus datos están protegidos.')],
              [RotateCcw, t('Devoluciones'), t('Hasta 30 días según políticas de la tienda.')],
              [CreditCard, t('Múltiples medios de pago'), t('Tarjetas y transferencias bancarias.')],
            ].map(([Icon, lbl, d]: any) => (
              <div key={lbl} className="flex gap-3 py-3">
                <Icon className="size-6 shrink-0 text-brand-600" />
                <div><p className="font-bold">{t(lbl)}</p><p className="text-sm text-muted">{d}</p></div>
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-2">
          <div className="card">
            <Segmented
              className="px-3"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'specs', label: <span className="flex items-center gap-2"><List className="size-4" /> {t('Especificaciones')}</span> },
                { value: 'reviews', label: <span className="flex items-center gap-2"><Star className="size-4" /> {t('Opiniones (')}{p.reviewCount})</span> },
                { value: 'questions', label: <span className="flex items-center gap-2"><HelpCircle className="size-4" /> {t('Preguntas')}</span> },
              ]}
            />
            <div className="p-4">
              {tab === 'specs' && (
                p.specifications.length ? (
                  <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                    {p.specifications.map((s: any) => (
                      <div key={s.code} className="flex justify-between gap-4 border-b border-line py-2.5 text-sm"><dt className="shrink-0 text-muted">{s.name}</dt><dd className="min-w-0 break-words text-right font-semibold">{s.value}</dd></div>
                    ))}
                    {p.variants[0]?.sku && <div className="flex justify-between gap-4 border-b border-line py-2.5 text-sm"><dt className="text-muted">{t('SKU')}</dt><dd className="font-semibold">{variant?.sku ?? p.variants[0].sku}</dd></div>}
                  </dl>
                ) : <Empty title={t('Sin especificaciones')} description={t('El vendedor no agregó especificaciones técnicas.')} />
              )}
              {tab === 'reviews' && (
                <div className={cn('grid grid-cols-1 gap-6', hasReviews && 'md:grid-cols-[220px_minmax(0,1fr)]')}>
                  {hasReviews && <div>
                    <p className="text-4xl font-extrabold">{p.rating.toFixed(1)}</p>
                    <Stars value={p.rating} count={p.reviewCount} size="md" />
                    <div className="mt-3 space-y-1">
                      {p.ratingDistribution.map((d: any) => (
                        <div key={d.rating} className="flex items-center gap-2 text-xs">
                          <span className="w-3">{d.rating}</span><Star className="size-3 fill-amber-400 text-amber-400" />
                          <div className="h-2 flex-1 rounded-full bg-brand-50"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${(d.count / p.reviewCount) * 100}%` }} /></div>
                          <span className="w-6 text-right text-muted">{d.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>}
                  <div className="space-y-4">
                    {reviews.data?.items?.length ? reviews.data.items.map((r: any) => (
                      <div key={r.id} className="border-b border-line pb-4">
                        <div className="flex items-center justify-between"><Stars value={r.rating} /><span className="text-xs text-muted">{fmtDate(r.createdAt)}</span></div>
                        {r.title && <p className="mt-1 break-words font-semibold">{r.title}</p>}
                        {r.body && <p className="mt-1 whitespace-pre-line break-words text-sm text-ink/90">{r.body}</p>}
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
          <div className="card p-4">
            <Recommendations context="product" productId={p.id} limit={4} gridClassName="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4"
              fallback={<>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold">{t('Productos relacionados')}</h2>
                  <Link href={`/catalogo/categorias/${p.category.slug}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">{t('Ver más')}{' '}<ArrowRight className="size-4" /></Link>
                </div>
                {p.related.length ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
                    {p.related.slice(0, 4).map((r: any) => <ProductCard key={r.id} p={r} />)}
                  </div>
                ) : <Empty title={t('Sin productos relacionados')} />}
              </>} />
          </div>
        </div>
      </div>

      <Dialog open={askOpen} onOpenChange={setAskOpen} title={t('Preguntar al vendedor')} description={`${p.seller.name} · ${p.title}`}
        footer={<><Button variant="secondary" onClick={() => setAskOpen(false)}>{t('Cancelar')}</Button><Button onClick={ask} loading={asking} disabled={question.trim().length < 3}>{t('Enviar mensaje')}</Button></>}>
        <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('Ej. ¿Tienen disponible la talla 42? ¿Cuánto tarda el envío a mi ciudad?')} maxLength={1000} />
      </Dialog>
    </div>
  );
}
