'use client';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, Heart, X } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get } from '@/lib/api';
import { fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Empty, PageLoader } from '@/components/ui/misc';
import { ProductCard } from '@/components/shop/product-card';
import { t } from '@/lib/i18n';

export default function FavoritesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['favorites'], queryFn: () => get('/me/favorites') });
  const alerts = useQuery({ queryKey: ['my-alerts', 'all'], queryFn: () => get<any[]>('/me/alerts') });
  if (q.isLoading) return <PageLoader />;
  const cancel = async (id: string) => {
    try {
      await del(`/me/alerts/${id}`);
      toast.success(t('Aviso cancelado.'));
      qc.invalidateQueries({ queryKey: ['my-alerts'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t('Mis favoritos')}</h1>
      <p className="text-muted">{t('Productos que guardaste para después. Si alguno baja de precio, te avisamos.')}</p>
      {!!alerts.data?.length && (
        <div className="card mt-6" data-my-alerts>
          <p className="flex items-center gap-2 border-b border-line px-5 py-4 font-bold"><Bell className="size-5 text-brand-600" /> {t('Avisos de stock')}</p>
          <ul className="divide-y divide-line">
            {alerts.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm" data-my-alert={a.status}>
                {a.status === 'SENT' ? <BellRing className="size-4 text-emerald-600" /> : <Bell className="size-4 text-muted" />}
                <Link href={`/producto/${a.slug}`} className="min-w-0 flex-1 font-semibold hover:text-brand-700">{a.title}{a.variant ? <span className="font-normal text-muted"> · {a.variant}</span> : null}</Link>
                <span className="text-xs text-muted">{a.status === 'SENT' ? t('Te avisamos el {d}: ya está disponible', { d: fmtDate(a.notifiedAt) }) : t('Esperando stock desde el {d}', { d: fmtDate(a.createdAt) })}</span>
                {a.status === 'ACTIVE' && <Button size="sm" variant="ghost" onClick={() => cancel(a.id)} aria-label={t('Cancelar aviso')}><X /></Button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!q.data?.length ? (
        <div className="card mt-6"><Empty icon={<Heart />} title={t('Aún no tienes favoritos')} description={t('Toca el corazón en cualquier producto para guardarlo aquí.')} action={<Button asChild><Link href="/catalogo">{t('Explorar productos')}</Link></Button>} /></div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">{q.data.map((p: any) => <ProductCard key={p.id} p={p} isFavorite showAddToCart />)}</div>
      )}
    </div>
  );
}
