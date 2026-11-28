'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Ban, ChevronRight, Flag, MessageSquare, Package, RotateCcw, Search, Send, ShieldAlert, ShoppingCart, Star, Store, Truck, Users, Zap, CheckCheck, Check } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, post, upload } from '@/lib/api';
import { AttachmentList, FilePicker, formWith } from '@/components/attachments/attachments';
import { cn, fmtDate, fmtTime, money, relative } from '@/lib/utils';
import { ReportMessageDialog, messageText } from '@/components/messaging/chat-safety';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Empty, Spinner, Avatar } from '@/components/ui/misc';
import { ProductImage } from '@/components/shop/product-card';
import { LogoMark } from '@/components/layout/logo';
import { t, getIntlLocale } from '@/lib/i18n';
import { IdentityMark, SellerTrustBadges } from '@/components/shop/seller-trust';

export function MessagesView({ as = 'customer', compact = false }: { as?: 'customer' | 'seller'; compact?: boolean }) {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const active = sp.get('c');
  const list = useQuery({ queryKey: ['conversations', as, search], queryFn: () => get(`/conversations?as=${as}&q=${encodeURIComponent(search)}`), refetchInterval: 60_000 }); // live updates come from RealtimeInbox; polling is the fallback
  const conv = useQuery({ queryKey: ['conversation', active], queryFn: () => get(`/conversations/${active}`), enabled: !!active, refetchInterval: 20_000 });
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);
  const toggleBlock = async (on: boolean) => {
    if (on && !window.confirm(isSeller ? t('¿Bloquear a este cliente? No podrá escribirle a tu tienda hasta que lo desbloquees.') : t('¿Bloquear a esta tienda? No podrá escribirte hasta que la desbloquees.'))) return;
    setBlocking(true);
    try {
      await (on ? post(`/conversations/${active}/block`) : del(`/conversations/${active}/block`));
      toast.success(on ? t('Conversación bloqueada.') : t('Conversación desbloqueada.'));
      await qc.invalidateQueries({ queryKey: ['conversation', active] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBlocking(false);
    }
  };
  const send = useMutation({
    mutationFn: () => upload(`/conversations/${active}/messages`, formWith({ body: text.trim() }, files)),
    onSuccess: (c) => {
      setText('');
      setFiles([]);
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
    <div className={cn('grid gap-4', compact ? 'lg:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)_300px]' : 'lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_320px]')}>
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
                    <p className="flex items-center gap-1 truncate font-bold">{isSeller ? x.customer.name : x.seller.name} {!isSeller && <IdentityMark trust={x.seller.trust} className="size-4" />}</p>
                    <span className="shrink-0 text-xs text-muted">{relative(x.lastMessageAt)}</span>
                  </div>
                  <p className="truncate text-sm text-muted">{x.lastFromMe ? t('Tú: ') : ''}{x.lastMessage ? messageText(x.lastMessage) : '—'}</p>
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
                <p className="flex items-center gap-1 truncate text-lg font-bold">{isSeller ? list.data?.find((x: any) => x.id === c.id)?.customer.name ?? t('Cliente') : c.seller?.name} {!isSeller && <IdentityMark trust={c.seller?.trust} />}</p>
                <p className="text-sm text-muted">{c.subject}</p>
              </div>
              {!isSeller && c.seller && <Button variant="outline" size="sm" asChild className="hidden sm:inline-flex"><Link href={`/tienda/${c.seller.slug}`}><Store /> {t('Ver tienda')}</Link></Button>}
              {c.product && <Button variant="outline" size="sm" asChild className="hidden sm:inline-flex"><Link href={`/producto/${c.product.slug}`}><Package /> {t('Ver producto')}</Link></Button>}
              {c.safety?.available && (
                <Button variant="ghost" size="sm" loading={blocking} onClick={() => toggleBlock(!c.safety.blockedByMe)} data-chat-block title={c.safety.blockedByMe ? t('Desbloquear') : isSeller ? t('Bloquear cliente') : t('Bloquear tienda')}>
                  <Ban /> <span className="hidden md:inline">{c.safety.blockedByMe ? t('Desbloquear') : t('Bloquear')}</span>
                </Button>
              )}
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
                    <div key={m.id} className={cn('group flex items-center gap-2', m.mine ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[78%] rounded-2xl px-4 py-2.5 text-sm shadow-sm', m.removed ? 'border border-dashed border-line bg-surface italic text-muted' : m.mine ? 'rounded-br-md bg-brand-100/80 text-ink' : 'rounded-bl-md border border-line bg-white')}>
                        {['SUPPORT_AGENT', 'MODERATOR'].includes(m.role) && <p className="mb-1 text-[11px] font-bold text-brand-700">{t('Equipo NEXOVAX')}</p>}
                        {!(m.attachments?.length && m.body.startsWith('📎')) && <p className="whitespace-pre-line">{messageText(m.body)}</p>}
                        <AttachmentList base={`/conversations/${c.id}/attachments`} items={m.attachments} />
                        <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted">{fmtTime(m.sentAt)} {m.mine && <CheckCheck className="size-3.5 text-brand-500" />}</p>
                      </div>
                      {!m.mine && !m.removed && c.safety?.available && !['SUPPORT_AGENT', 'MODERATOR'].includes(m.role) && (
                        m.reportedByMe
                          ? <span className="text-[11px] text-muted" title={t('Reportado')}><Flag className="size-3.5 fill-current" /></span>
                          : <button type="button" onClick={() => setReporting(m.id)} className="rounded-lg p-1 text-muted opacity-60 transition hover:bg-surface hover:text-red-600 group-hover:opacity-100 focus:opacity-100" aria-label={t('Reportar mensaje')} title={t('Reportar mensaje')} data-report-message><Flag className="size-3.5" /></button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              <div ref={endRef} />
            </div>
            {c.safety && (c.safety.blockedByMe || c.safety.blockedByOther || c.safety.restrictedUntil) ? (
              <div className="flex items-center gap-3 border-t border-line bg-surface/60 p-4 text-sm" data-chat-locked>
                <ShieldAlert className="size-5 shrink-0 text-amber-600" />
                <p className="flex-1">
                  {c.safety.restrictedUntil
                    ? t('Tu cuenta no puede enviar mensajes hasta el {d} por una decisión de moderación.', { d: fmtDate(c.safety.restrictedUntil) })
                    : c.safety.blockedByMe ? t('Bloqueaste esta conversación. No recibirás mensajes nuevos.') : t('No puedes enviar mensajes en esta conversación.')}
                </p>
                {c.safety.blockedByMe && !c.safety.restrictedUntil && <Button size="sm" variant="outline" loading={blocking} onClick={() => toggleBlock(false)}>{t('Desbloquear')}</Button>}
              </div>
            ) : (
            <form onSubmit={(e) => { e.preventDefault(); if (text.trim() || files.length) send.mutate(); }} className="border-t border-line p-4">
              {files.length > 0 && <FilePicker files={files} onChange={setFiles} className="mb-3 [&>button]:hidden" />}
              <div className="flex items-center gap-2">
                {c.status === 'OPEN' && <FilePicker files={[]} onChange={(f) => setFiles([...files, ...f].slice(0, 4))} max={4 - files.length} />}
                <div className="min-w-0 flex-1"><Input placeholder={c.status === 'OPEN' ? t('Escribe un mensaje...') : t('Esta conversación está cerrada')} disabled={c.status !== 'OPEN'} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} className="h-11" /></div>
                <Button type="submit" size="icon" className="size-11" loading={send.isPending} disabled={!text.trim() && !files.length} aria-label={t('Enviar')}><Send /></Button>
              </div>
            </form>
            )}
            <ReportMessageDialog conversationId={c.id} messageId={reporting} onClose={() => setReporting(null)} onDone={() => { setReporting(null); qc.invalidateQueries({ queryKey: ['conversation', active] }); }} />
          </>
        )}
      </section>

      {c && (
        <aside className={cn('hidden space-y-4', compact ? '2xl:block' : 'xl:block')}>
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
              <p className="mt-3 flex items-center gap-1 font-bold">{c.seller.name} <IdentityMark trust={c.seller.trust} className="size-4" /></p>
              <SellerTrustBadges trust={c.seller.trust} className="mt-1" />
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
