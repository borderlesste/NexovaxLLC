'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, BadgeCheck, ChevronRight, MessageSquare, Package, RotateCcw, Search, Send, ShoppingCart, Star, Store, Truck, Users, Zap, CheckCheck, Check } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { cn, fmtTime, money, relative } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Empty, Spinner, Avatar } from '@/components/ui/misc';
import { ProductImage } from '@/components/shop/product-card';
import { LogoMark } from '@/components/layout/logo';
import { t, getIntlLocale } from '@/lib/i18n';

export function MessagesView({ as = 'customer' }: { as?: 'customer' | 'seller' }) {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const active = sp.get('c');
  const list = useQuery({ queryKey: ['conversations', as, search], queryFn: () => get(`/conversations?as=${as}&q=${encodeURIComponent(search)}`), refetchInterval: 15_000 });
  const conv = useQuery({ queryKey: ['conversation', active], queryFn: () => get(`/conversations/${active}`), enabled: !!active, refetchInterval: 5_000 });
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const send = useMutation({
    mutationFn: () => post(`/conversations/${active}/messages`, { body: text }),
    onSuccess: (c) => {
      setText('');
      qc.setQueryData(['conversation', active], c);
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conv.data?.messages?.length]);
  useEffect(() => {
    if (conv.data) qc.invalidateQueries({ queryKey: ['me'] });
  }, [conv.data?.id, qc]);
  const open = (id: string) => router.push(`?c=${id}`, { scroll: false });
  const c = conv.data;
  const isSeller = as === 'seller';
  const grouped = useMemo(() => {
    const out: { day: string; items: any[] }[] = [];
    for (const m of c?.messages ?? []) {
      const d = new Date(m.sentAt);
      const today = new Date();
      const day = d.toDateString() === today.toDateString() ? t('Hoy') : d.toLocaleDateString(getIntlLocale(), { day: 'numeric', month: 'short' });
      if (!out.length || out[out.length - 1].day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(m);
    }
    return out;
  }, [c?.messages]);

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_320px]">
      <aside className={cn('card flex h-[calc(100dvh-220px)] min-h-[520px] flex-col', active && 'hidden lg:flex')}>
        <div className="flex items-center justify-between px-5 pt-5">
          <p className="flex items-center gap-2 text-xl font-bold">{t('Conversaciones')}{' '}<span className="rounded-full bg-brand-600 px-2 text-xs font-bold leading-5 text-white">{list.data?.length ?? 0}</span></p>
        </div>
        <div className="px-5 py-3"><Input icon={<Search />} placeholder={t('Buscar conversación...')} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <ul className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
          {list.isLoading && <div className="grid place-items-center py-10"><Spinner /></div>}
          {list.data?.length === 0 && <Empty icon={<MessageSquare />} title={t('Sin conversaciones')} description={isSeller ? t('Cuando un cliente te escriba aparecerá aquí.') : t('Escribe a un vendedor desde un producto o su tienda.')} />}
          {list.data?.map((x: any) => (
            <li key={x.id}>
              <button onClick={() => open(x.id)} className={cn('flex w-full gap-3 rounded-xl p-3 text-left transition', active === x.id ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-surface')}>
                {isSeller ? <Avatar name={x.customer.name} size={48} /> : (
                  <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-brand-50">{x.seller.logoUrl ? <img src={x.seller.logoUrl} alt="" className="size-full object-cover" /> : <Store className="size-6 text-brand-600" />}</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1 truncate font-bold">{isSeller ? x.customer.name : x.seller.name} {!isSeller && x.seller.verified && <BadgeCheck className="size-4 shrink-0 fill-brand-600 text-white" />}</p>
                    <span className="shrink-0 text-xs text-muted">{relative(x.lastMessageAt)}</span>
                  </div>
                  <p className="truncate text-sm text-muted">{x.lastFromMe ? t('Tú: ') : ''}{x.lastMessage ?? '—'}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 truncate text-xs text-muted"><Package className="size-3.5 shrink-0" /> {x.product?.title ?? x.subject}</span>
                    {x.unread > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-bold leading-5 text-white">{x.unread}</span>}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className={cn('card flex h-[calc(100dvh-220px)] min-h-[520px] flex-col', !active && 'hidden lg:flex')}>
        {!active ? (
          <div className="grid flex-1 place-items-center"><Empty icon={<MessageSquare />} title={t('Selecciona una conversación')} /></div>
        ) : !c ? (
          <div className="grid flex-1 place-items-center"><Spinner /></div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <button className="lg:hidden" onClick={() => router.push('?', { scroll: false })} aria-label={t('Volver')}><ChevronRight className="size-5 rotate-180" /></button>
              {isSeller ? <Avatar name={list.data?.find((x: any) => x.id === c.id)?.customer.name} size={44} /> : (
                <div className="grid size-11 place-items-center overflow-hidden rounded-xl border border-line bg-white">{c.seller?.logoUrl ? <img src={c.seller.logoUrl} alt="" className="size-full object-cover" /> : <LogoMark className="size-7" />}</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate text-lg font-bold">{isSeller ? list.data?.find((x: any) => x.id === c.id)?.customer.name ?? t('Cliente') : c.seller?.name} {!isSeller && c.seller?.verified && <BadgeCheck className="size-5 fill-brand-600 text-white" />}</p>
                <p className="text-sm text-muted">{c.subject}</p>
              </div>
              {!isSeller && c.seller && <Button variant="outline" size="sm" asChild className="hidden sm:inline-flex"><Link href={`/tienda/${c.seller.slug}`}><Store /> {t('Ver tienda')}</Link></Button>}
              {c.product && <Button variant="outline" size="sm" asChild className="hidden sm:inline-flex"><Link href={`/producto/${c.product.slug}`}><Package /> {t('Ver producto')}</Link></Button>}
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 scrollbar-thin">
              {c.product && (
                <div className="mx-auto flex max-w-md items-center gap-3 rounded-xl border border-line bg-white p-3 shadow-sm">
                  <ProductImage src={c.product.imageUrl} alt={c.product.title} className="size-14 rounded-lg bg-surface" />
                  <div className="min-w-0 flex-1"><p className="truncate font-bold">{c.product.title}</p><p className="font-semibold">{c.product.price ? money(c.product.price) : ''}</p></div>
                </div>
              )}
              {grouped.map((g) => (
                <div key={g.day} className="space-y-3">
                  <p className="mx-auto w-fit rounded-full bg-surface px-3 py-1 text-xs font-medium text-muted">{g.day}</p>
                  {g.items.map((m: any) => (
                    <div key={m.id} className={cn('flex gap-2', m.mine ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[78%] rounded-2xl px-4 py-2.5 text-sm shadow-sm', m.mine ? 'rounded-br-md bg-brand-100/80 text-ink' : 'rounded-bl-md border border-line bg-white')}>
                        {['SUPPORT_AGENT', 'MODERATOR'].includes(m.role) && <p className="mb-1 text-[11px] font-bold text-brand-700">{t('Equipo NEXOVAX')}</p>}
                        <p className="whitespace-pre-line">{m.body}</p>
                        <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted">{fmtTime(m.sentAt)} {m.mine && <CheckCheck className="size-3.5 text-brand-500" />}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }} className="flex items-center gap-2 border-t border-line p-4">
              <Input placeholder={c.status === 'OPEN' ? t('Escribe un mensaje...') : t('Esta conversación está cerrada')} disabled={c.status !== 'OPEN'} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} className="h-11" />
              <Button type="submit" size="icon" className="size-11" loading={send.isPending} disabled={!text.trim()} aria-label={t('Enviar')}><Send /></Button>
            </form>
          </>
        )}
      </section>

      {c && (
        <aside className="hidden space-y-4 xl:block">
          {c.product && (
            <div className="card p-5">
              <p className="text-lg font-bold">{t('Producto en conversación')}</p>
              <div className="mt-3 flex gap-3">
                <ProductImage src={c.product.imageUrl} alt={c.product.title} className="size-24 rounded-xl bg-surface" />
                <div><p className="font-bold">{c.product.title}</p><p className="mt-1 flex items-center gap-1 text-sm"><Star className="size-4 fill-amber-400 text-amber-400" /> <b>{c.product.rating ? c.product.rating.toFixed(1) : '—'}</b> <span className="text-muted">({c.product.reviews} {t('opiniones)')}</span></p><p className="mt-1 text-xl font-extrabold">{c.product.price ? money(c.product.price) : ''}</p></div>
              </div>
              {c.product.shortDescription && <p className="mt-3 text-sm text-muted">{c.product.shortDescription}</p>}
              {!isSeller && (
                <div className="mt-4 grid gap-2">
                  <Button asChild><Link href={`/producto/${c.product.slug}`}><ShoppingCart /> {t('Comprar ahora')}</Link></Button>
                </div>
              )}
            </div>
          )}
          {!isSeller && c.seller && (
            <div className="card p-5">
              <p className="text-lg font-bold">{t('Sobre el vendedor')}</p>
              <p className="mt-3 flex items-center gap-1 font-bold">{c.seller.name} {c.seller.verified && <BadgeCheck className="size-4 fill-brand-600 text-white" />}</p>
              <p className="text-sm text-muted">{c.seller.verified ? t('Vendedor verificado') : t('Vendedor')}</p>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between"><dt className="flex items-center gap-2 text-muted"><Star className="size-4" /> {t('Calificación')}</dt><dd className="font-semibold">{c.seller.rating ? c.seller.rating.toFixed(1) : '—'} ({c.seller.reviews})</dd></div>
                <div className="flex justify-between"><dt className="flex items-center gap-2 text-muted"><Users className="size-4" /> {t('Seguidores')}</dt><dd className="font-semibold">{c.seller.followers}</dd></div>
                <div className="flex justify-between"><dt className="flex items-center gap-2 text-muted"><Truck className="size-4" /> {t('Cobertura de envíos')}</dt><dd className="font-semibold">{t('Nacional e internacional')}</dd></div>
              </dl>
            </div>
          )}
          {!isSeller && (
            <div className="card p-5">
              <p className="text-lg font-bold">{t('¿Necesitas ayuda con tu compra?')}</p>
              <div className="mt-3 grid gap-2">
                {[[Truck, t('Consultar envío'), '/cuenta/pedidos'], [RotateCcw, t('Solicitar devolución'), '/ayuda/reportar?tipo=PURCHASE'], [AlertCircle, t('Reportar problema'), '/ayuda/reportar']].map(([I, lbl, h]: any) => (
                  <Link key={lbl} href={h} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-sm font-semibold hover:bg-brand-50"><I className="size-5 text-brand-600" /> {t(lbl)} <ChevronRight className="ml-auto size-4" /></Link>
                ))}
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
