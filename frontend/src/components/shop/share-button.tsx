'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Link2, Mail, MessageCircle, Send, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { shareUrl } from '@/lib/shares';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/misc';

const FacebookIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden><path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5H16.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21h3z" /></svg>
);
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.2-8.3L1.8 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" /></svg>
);

/**
 * "Compartir": signed-in users share a personal link (?s=CODE) they can follow in
 * Mi cuenta → Enlaces compartidos. If the store runs an affiliate program the link also
 * carries the user's affiliate code, so a sale pays them a commission.
 */
export function ShareButton({ product, className, iconOnly }: { product: { id: string; slug: string; title: string }; className?: string; iconOnly?: boolean }) {
  const { session, me } = useAuth();
  const [open, setOpen] = useState(false);
  const offer = useQuery({ queryKey: ['affiliate-offer', product.id], queryFn: () => get<any>(`/affiliates/products/${product.id}`), staleTime: 60_000, enabled: open && !!session });
  const link = useQuery({
    queryKey: ['share-link', product.id, !!session, offer.data?.sellerId ?? null],
    enabled: open && (!session || !offer.isLoading),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      if (!session) return shareUrl(product.slug);
      const s = await post<{ code: string }>('/shares', { productId: product.id }).catch(() => null);
      let ref: string | null = null;
      const sellerId = offer.data?.ratePercent ? offer.data.sellerId : null;
      if (sellerId && !me?.sellers?.some((x) => x.id === sellerId))
        ref = (await post<any>(`/affiliates/stores/${sellerId}/link`, {}).catch(() => null))?.code ?? null;
      return shareUrl(product.slug, s?.code, ref);
    },
  });
  const url = link.data ?? '';

  return (
    <>
      {iconOnly ? (
        <button onClick={() => setOpen(true)} className={cn('grid size-11 place-items-center rounded-full bg-white shadow', className)} aria-label={t('Compartir')} data-share-open>
          <Share2 className="size-5" />
        </button>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className={className} data-share-open><Share2 /> {t('Compartir')}</Button>
      )}
      <ShareDialog open={open} onOpenChange={setOpen} title={t('Compartir producto')} description={product.title} url={url} loading={link.isLoading} text={`${product.title} en NEXOVAX`}>
        {session ? (
          <p className="text-xs text-muted">
            {t('Este enlace es tuyo: en')}{' '}
            <Link href="/cuenta/enlaces" className="font-semibold text-brand-700">{t('Mis enlaces compartidos')}</Link>{' '}
            {t('verás cuántas personas lo abrieron y si generó ventas.')}
          </p>
        ) : (
          <p className="text-xs text-muted">
            <Link href={`/auth/iniciar-sesion?next=/producto/${product.slug}`} className="font-semibold text-brand-700">{t('Inicia sesión')}</Link>{' '}
            {t('para compartir con tu enlace personal y saber si generó ventas.')}
          </p>
        )}
      </ShareDialog>
    </>
  );
}

/** Share sheet: copy the link, open it in a social network or e-mail, or use the device's own share menu. */
export function ShareDialog({ open, onOpenChange, title, description, url, text, loading, children }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; url: string; text: string; loading?: boolean; children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API blocked (permissions/insecure context): fall back to a hidden textarea.
      const el = document.createElement('textarea');
      el.value = url;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      el.remove();
      if (!ok) {
        toast.error(t('No se pudo copiar. Selecciona el enlace y cópialo manualmente.'));
        return;
      }
    }
    setCopied(true);
    toast.success(t('Enlace copiado.'));
    setTimeout(() => setCopied(false), 2000);
  };
  const native = async () => {
    try {
      await navigator.share({ title, text, url });
    } catch {
      /* cancelled or unavailable */
    }
  };
  const enc = encodeURIComponent;
  const targets = [
    { label: 'WhatsApp', icon: MessageCircle, href: `https://wa.me/?text=${enc(`${text} ${url}`)}`, cls: 'bg-emerald-50 text-emerald-700' },
    { label: 'Facebook', icon: FacebookIcon, href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, cls: 'bg-blue-50 text-blue-700' },
    { label: 'X', icon: XIcon, href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`, cls: 'bg-slate-100 text-slate-900' },
    { label: 'Telegram', icon: Send, href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`, cls: 'bg-sky-50 text-sky-700' },
    { label: t('Correo'), icon: Mail, href: `mailto:?subject=${enc(text)}&body=${enc(`${text}\n${url}`)}`, cls: 'bg-amber-50 text-amber-700' },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description} size="sm">
      <div className="space-y-4" data-share-dialog>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2">
          <Link2 className="ml-1 size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 select-all truncate text-sm" data-share-url>{loading || !url ? t('Generando tu enlace…') : url}</span>
          <Button size="sm" onClick={copy} disabled={!url}>{copied ? <Check /> : <Copy />} {copied ? t('Copiado') : t('Copiar')}</Button>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {targets.map((x) => (
            <a key={x.label} href={url ? x.href : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!url}
              className={cn('flex flex-col items-center gap-1.5 rounded-xl p-2 text-[11px] font-semibold', x.cls, !url && 'pointer-events-none opacity-50')}>
              <x.icon className="size-5" /> {x.label}
            </a>
          ))}
        </div>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <Button variant="soft" className="w-full" onClick={native} disabled={!url}><Share2 /> {t('Más opciones')}</Button>
        )}
        {children}
      </div>
    </Dialog>
  );
}
