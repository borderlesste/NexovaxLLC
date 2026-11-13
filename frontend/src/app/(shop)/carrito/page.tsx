'use client';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Minus, Plus, ShoppingCart, Store, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/utils';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Empty, PageLoader } from '@/components/ui/misc';
import { ProductImage } from '@/components/shop/product-card';
import { t } from '@/lib/i18n';

export default function CartPage() {
  const { session, loading } = useAuth();
  const qc = useQueryClient();
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => get('/cart'), enabled: !!session });
  const onDone = (c: any) => {
    qc.setQueryData(['cart'], c);
    qc.invalidateQueries({ queryKey: ['me'] });
  };
  const upd = useMutation({ mutationFn: (v: { id: string; quantity: number }) => put(`/cart/items/${v.id}`, { quantity: v.quantity }), onSuccess: onDone, onError: (e) => toast.error(errorMessage(e)) });
  const rem = useMutation({ mutationFn: (id: string) => del(`/cart/items/${id}`), onSuccess: onDone, onError: (e) => toast.error(errorMessage(e)) });

  if (loading) return <PageLoader />;
  if (!session)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="card"><Empty icon={<ShoppingCart />} title={t('Inicia sesión para ver tu carrito')} action={<Button asChild><Link href="/auth/iniciar-sesion?next=/carrito">{t('Iniciar sesión')}</Link></Button>} /></div>
      </div>
    );
  if (cart.isLoading) return <PageLoader />;
  const c = cart.data;
  const hasIssues = c?.groups.some((g: any) => g.items.some((i: any) => i.issue));
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 lg:px-8">
      <Breadcrumbs items={[{ label: t('Carrito') }]} />
      <h1 className="mt-4 text-3xl font-extrabold">{t('Tu carrito')}</h1>
      {!c?.groups.length ? (
        <div className="card mt-6"><Empty icon={<ShoppingCart />} title={t('Tu carrito está vacío')} description={t('Explora el catálogo y agrega productos de tus tiendas favoritas.')} action={<Button asChild><Link href="/catalogo">{t('Explorar productos')}</Link></Button>} /></div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            {c.groups.map((g: any) => (
              <div key={g.sellerId} className="card">
                <div className="flex items-center gap-2 border-b border-line px-5 py-3">
                  <Store className="size-4 text-brand-600" />
                  <Link href={`/tienda/${g.sellerSlug}`} className="font-bold hover:text-brand-700">{g.sellerName}</Link>
                </div>
                <ul className="divide-y divide-line">
                  {g.items.map((i: any) => (
                    <li key={i.id} className="flex gap-4 p-5">
                      <Link href={`/producto/${i.slug}`} className="shrink-0"><ProductImage src={i.imageUrl} alt={i.title} className="size-24 rounded-xl bg-surface" /></Link>
                      <div className="min-w-0 flex-1">
                        <Link href={`/producto/${i.slug}`} className="line-clamp-2 font-semibold hover:text-brand-700">{i.title}</Link>
                        <p className="mt-0.5 text-sm text-muted">{Object.entries(i.attributes ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || i.sku}</p>
                        {i.issue && <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle className="size-3.5" /> {i.issue}</p>}
                        <div className="mt-3 flex flex-wrap items-center gap-4">
                          <div className="inline-flex items-center rounded-lg border border-line">
                            <button className="grid size-9 place-items-center disabled:opacity-40" disabled={i.quantity <= 1 || upd.isPending} onClick={() => upd.mutate({ id: i.id, quantity: i.quantity - 1 })} aria-label={t('Menos')}><Minus className="size-4" /></button>
                            <span className="w-9 text-center text-sm font-semibold">{i.quantity}</span>
                            <button className="grid size-9 place-items-center disabled:opacity-40" disabled={i.quantity >= i.stock || upd.isPending} onClick={() => upd.mutate({ id: i.id, quantity: i.quantity + 1 })} aria-label={t('Más')}><Plus className="size-4" /></button>
                          </div>
                          <button className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline" onClick={() => rem.mutate(i.id)}><Trash2 className="size-4" /> {t('Eliminar')}</button>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-extrabold">{money(i.lineTotal)}</p>
                        <p className="text-xs text-muted">{money(i.unitPrice)} c/u</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="card h-fit p-5 lg:sticky lg:top-24">
            <h2 className="text-lg font-bold">{t('Resumen')}</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted">{t('Productos (')}{c.itemCount})</span><b>{money(c.subtotal)}</b></div>
              <div className="flex justify-between"><span className="text-muted">{t('Envío e impuestos')}</span><span className="text-muted">{t('Se calculan en el pago')}</span></div>
            </div>
            <div className="mt-4 flex justify-between border-t border-line pt-4 text-lg font-extrabold"><span>{t('Subtotal')}</span><span>{money(c.subtotal)}</span></div>
            <Button size="lg" className="mt-5 w-full" asChild disabled={hasIssues}>
              <Link href="/checkout">{t('Continuar al pago')}{' '}<ArrowRight /></Link>
            </Button>
            {hasIssues && <p className="mt-2 text-xs text-amber-700">{t('Corrige los productos marcados antes de continuar.')}</p>}
            <Link href="/catalogo" className="mt-3 block text-center text-sm font-semibold text-brand-700">{t('Seguir comprando')}</Link>
          </div>
        </div>
      )}
    </div>
  );
}
