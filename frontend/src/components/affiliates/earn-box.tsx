'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Copy, Handshake } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { affiliateUrl } from '@/lib/affiliates';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

/** "Earn by recommending": shown when the product's store runs an affiliate program. */
export function EarnBox({ productId, slug }: { productId: string; slug: string }) {
  const { session, me } = useAuth();
  const offer = useQuery({ queryKey: ['affiliate-offer', productId], queryFn: () => get<any>(`/affiliates/products/${productId}`), staleTime: 60_000 });
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!offer.data?.ratePercent) return null;
  const own = me?.sellers?.some((s) => s.id === offer.data.sellerId);
  if (own) return null;
  const get_ = async () => {
    setBusy(true);
    try {
      const r = await post<any>(`/affiliates/stores/${offer.data.sellerId}/link`, {});
      const url = affiliateUrl(`/producto/${slug}`, r.code);
      setLink(url);
      await navigator.clipboard.writeText(url).catch(() => undefined);
      toast.success(t('Enlace copiado. Compártelo para ganar tu comisión.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card p-5" data-earn-box>
      <p className="flex items-center gap-2 font-bold"><Handshake className="size-5 text-brand-600" /> {t('Gana {r} % recomendando', { r: offer.data.ratePercent })}</p>
      <p className="mt-1 text-sm text-muted">{t('Comparte tu enlace: si alguien compra en esta tienda dentro de {d} días, ganas una comisión que paga la tienda.', { d: offer.data.windowDays })}</p>
      {link ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface p-2 text-xs">
          <span className="min-w-0 flex-1 truncate" data-earn-link>{link}</span>
          <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success(t('Enlace copiado.')))} aria-label={t('Copiar enlace')}><Copy /></Button>
        </div>
      ) : session ? (
        <Button variant="soft" className="mt-3 w-full" loading={busy} onClick={get_} data-earn-get><Handshake /> {t('Obtener mi enlace')}</Button>
      ) : (
        <Button variant="soft" className="mt-3 w-full" asChild><Link href={`/auth/iniciar-sesion?next=/producto/${slug}`}>{t('Inicia sesión para obtener tu enlace')}</Link></Button>
      )}
      {session && <Link href="/cuenta/afiliados" className="mt-2 block text-xs font-semibold text-brand-700">{t('Ver mis comisiones →')}</Link>}
    </div>
  );
}
