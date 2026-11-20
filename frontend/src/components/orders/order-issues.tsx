'use client';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, CreditCard, Headphones, MessageSquare, RotateCcw, Truck, XCircle } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn, fmtDateTime, money } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type Role = 'customer' | 'seller' | 'admin';
interface Item { key: string; icon: any; title: string; detail: string; open: boolean; at?: string | null; href?: string | null }

const CANCEL_LABEL: Record<string, string> = {
  REQUESTED: 'Cancelación solicitada, esperando respuesta de la tienda',
  APPROVED: 'Cancelación aprobada, reembolso en curso',
  REFUNDED: 'Cancelación completada y reembolsada',
  REJECTED: 'Cancelación rechazada',
  CANCELLED: 'Solicitud de cancelación retirada',
};
const SHIPPING_PROBLEM: Record<string, string> = {
  EXCEPTION: 'La transportadora reportó una incidencia en el envío',
  FAILURE: 'La entrega no se pudo completar',
  RETURNED: 'El paquete fue devuelto al remitente',
};

const returnHref = (role: Role, id: string) => (role === 'customer' ? `/cuenta/devoluciones/${id}` : role === 'seller' ? `/vendedor/devoluciones/${id}` : `/admin/devoluciones/${id}`);
const chatHref = (role: Role, id: string) => (role === 'customer' ? `/cuenta/mensajes?c=${id}` : role === 'seller' ? `/vendedor/mensajes?c=${id}` : null);

/** Everything that went off-plan with an order (returns, cancellations, delivery problems, reports, disputes). */
function issuesOf(order: any, role: Role): Item[] {
  const out: Item[] = [];
  const multi = (order.sellerOrders ?? []).length > 1;
  for (const so of order.sellerOrders ?? []) {
    const c = so.cancellation;
    if (c?.status && CANCEL_LABEL[c.status])
      out.push({ key: `cancel-${so.id}`, icon: XCircle, title: t('Cancelación'), detail: t(CANCEL_LABEL[c.status]) + (multi ? ` · ${so.seller.name}` : ''), open: ['REQUESTED', 'APPROVED'].includes(c.status), at: c.refundedAt ?? c.decidedAt ?? c.createdAt });
    for (const s of so.shipments ?? [])
      if (SHIPPING_PROBLEM[s.trackingStatus])
        out.push({ key: `ship-${s.id}`, icon: Truck, title: t('Envío {n}', { n: s.number }), detail: t(SHIPPING_PROBLEM[s.trackingStatus]), open: true, at: s.events?.[s.events.length - 1]?.at });
  }
  for (const i of order.issues ?? []) {
    if (i.kind === 'RETURN')
      out.push({ key: i.id, icon: RotateCcw, title: t('Devolución {n}', { n: i.ref }), detail: t(i.statusLabel), open: i.open, at: i.at, href: returnHref(role, i.id) });
    else if (i.kind === 'TICKET')
      out.push({ key: i.id, icon: Headphones, title: t('Reporte {n}', { n: i.ref }), detail: `${i.title} · ${t(i.statusLabel)}`, open: i.open, at: i.at, href: role === 'admin' ? `/admin/reportes?ticket=${i.id}` : '/cuenta/reportes' });
    else if (i.kind === 'DISPUTE')
      out.push({ key: i.id, icon: CreditCard, title: t('Disputa bancaria'), detail: `${money(i.amount, i.currency)} · ${t(i.statusLabel)}`, open: i.open, at: i.at, href: role === 'admin' ? '/admin/incidencias-pago' : null });
  }
  if (order.paymentStatus === 'PENDING' && order.status !== 'CANCELLED')
    out.push({ key: 'payment', icon: CreditCard, title: t('Pago'), detail: t('El pago todavía no está confirmado.'), open: true });
  return out.sort((a, b) => Number(b.open) - Number(a.open) || String(b.at ?? '').localeCompare(String(a.at ?? '')));
}

export function OrderIssuesCard({ order, role, onContactSeller }: { order: any; role: Role; onContactSeller: (so: any) => void }) {
  const items = issuesOf(order, role);
  const open = items.filter((i) => i.open).length;
  const chats: any[] = order.conversations ?? [];
  const withoutChat = role === 'customer' ? (order.sellerOrders ?? []).filter((so: any) => !chats.some((c) => c.sellerId === so.seller.id)) : [];
  return (
    <div className="card p-5" data-order-issues>
      <p className="text-lg font-bold">{t('Incidencias y mensajes')}</p>
      {open ? (
        <div className="mt-3 flex items-start gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" data-issues-open={open}>
          <AlertTriangle className="size-5 shrink-0" />
          <span><b>{open === 1 ? t('1 incidencia abierta.') : t('{n} incidencias abiertas.', { n: open })}</b><br />{t('Revisa el detalle abajo.')}</span>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" data-issues-open="0">
          <CheckCircle2 className="size-5 shrink-0" />
          <span><b>{t('Sin incidencias abiertas.')}</b><br />{items.length ? t('Las incidencias anteriores ya se resolvieron.') : t('No hay devoluciones, cancelaciones, reportes ni problemas de entrega en este pedido.')}</span>
        </div>
      )}

      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line text-sm">
          {items.map((i) => {
            const body = (
              <>
                <i.icon className={cn('mt-0.5 size-4 shrink-0', i.open ? 'text-amber-600' : 'text-muted')} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-semibold">{i.title}{i.open && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">{t('Abierta')}</span>}</span>
                  <span className="block text-muted">{i.detail}</span>
                  {i.at && <span className="block text-[11px] text-muted">{fmtDateTime(i.at)}</span>}
                </span>
                {i.href && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted" />}
              </>
            );
            return (
              <li key={i.key}>
                {i.href ? <Link href={i.href} className="flex items-start gap-3 p-3 hover:bg-surface">{body}</Link> : <div className="flex items-start gap-3 p-3">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-sm font-bold">{t('Mensajes')}</p>
      {chats.length ? (
        <ul className="mt-2 space-y-2 text-sm">
          {chats.map((c) => {
            const href = chatHref(role, c.id);
            const body = (
              <>
                <MessageSquare className="size-4 shrink-0 text-brand-600" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{role === 'customer' ? t('Chat con {s}', { s: c.store }) : t('Chat con el cliente')}</span>
                  <span className="block text-xs text-muted">{c.messages === 1 ? t('1 mensaje') : t('{n} mensajes', { n: c.messages })} · {fmtDateTime(c.lastMessageAt)}</span>
                </span>
                {c.unread > 0 && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white">{c.unread}</span>}
                {href && <ChevronRight className="size-4 shrink-0 text-muted" />}
              </>
            );
            return <li key={c.id}>{href ? <Link href={href} className="flex items-center gap-3 rounded-xl border border-line p-3 hover:bg-surface">{body}</Link> : <div className="flex items-center gap-3 rounded-xl border border-line p-3">{body}</div>}</li>;
          })}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">{role === 'customer' ? t('Aún no has escrito a la tienda sobre este pedido.') : t('No hay mensajes sobre este pedido.')}</p>
      )}

      {role === 'customer' && (
        <div className="mt-3 space-y-2">
          {withoutChat.map((so: any) => (
            <Button key={so.id} variant="outline" className="w-full" onClick={() => onContactSeller(so)}><MessageSquare /> {withoutChat.length > 1 || (order.sellerOrders ?? []).length > 1 ? t('Escribir a {s}', { s: so.seller.name }) : t('Escribir a la tienda')}</Button>
          ))}
          <Button variant="outline" className="w-full" asChild><Link href={`/ayuda/reportar?pedido=${order.number}`}><AlertCircle /> {t('Reportar un problema')}</Link></Button>
        </div>
      )}
    </div>
  );
}
