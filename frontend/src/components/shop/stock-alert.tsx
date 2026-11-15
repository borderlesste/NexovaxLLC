'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

/** "Notify me when it's back": shown when the selected product / variant is out of stock. */
export function StockAlertButton({ productId, variantId, slug }: { productId: string; variantId?: string | null; slug: string }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-alerts', productId], queryFn: () => get<any[]>(`/me/alerts?productId=${productId}`), enabled: !!session });
  const [busy, setBusy] = useState(false);
  const active = (q.data ?? []).find((a) => a.status === 'ACTIVE' && (a.variantId ?? null) === (variantId ?? null));
  if (!session)
    return <Button size="lg" variant="outline" className="sm:col-span-2" asChild><Link href={`/auth/iniciar-sesion?next=/producto/${slug}`}><Bell /> {t('Inicia sesión para que te avisemos cuando haya stock')}</Link></Button>;
  const toggle = async () => {
    setBusy(true);
    try {
      if (active) {
        await del(`/me/alerts/${active.id}`);
        toast.success(t('Aviso cancelado.'));
      } else {
        await post('/me/alerts', { productId, variantId: variantId ?? undefined });
        toast.success(t('Listo: te avisaremos cuando vuelva a estar disponible.'));
      }
      qc.invalidateQueries({ queryKey: ['my-alerts'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return active ? (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm sm:col-span-2" data-stock-alert="on">
      <span className="flex items-center gap-2 font-semibold text-brand-800"><Bell className="size-4" /> {t('Te avisaremos cuando vuelva a estar disponible.')}</span>
      <Button size="sm" variant="ghost" loading={busy} onClick={toggle}><BellOff /> {t('Cancelar aviso')}</Button>
    </div>
  ) : (
    <Button size="lg" variant="soft" className="sm:col-span-2" loading={busy} onClick={toggle} data-stock-alert="off"><Bell /> {t('Avísame cuando haya stock')}</Button>
  );
}
