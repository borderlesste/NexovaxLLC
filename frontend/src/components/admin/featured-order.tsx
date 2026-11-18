'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Star } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ProductImage } from '@/components/shop/product-card';

/** Admin → Productos: order in which the featured products appear on the home page. */
export function FeaturedOrder({ refreshKey }: { refreshKey: number }) {
  const q = useQuery({ queryKey: ['admin-featured', refreshKey], queryFn: () => get<any[]>('/admin/featured') });
  const [list, setList] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setList(q.data); }, [q.data]);
  if (!q.data?.length) return null;
  const changed = list.map((x) => x.id).join() !== q.data.map((x) => x.id).join();
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const n = [...list];
    [n[i], n[j]] = [n[j], n[i]];
    setList(n);
  };
  const save = async () => {
    setBusy(true);
    try {
      setList(await post<any[]>('/admin/featured/order', { productIds: list.map((x) => x.id) }));
      toast.success(t('Orden de destacados guardado.'));
      q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mb-5">
      <CardHeader icon={<Star />} title={t('Orden en la portada')} subtitle={t('Los productos destacados se muestran en este orden. Usa las flechas y guarda.')} />
      <ol className="divide-y divide-line" data-featured-order>
        {list.map((p, i) => (
          <li key={p.id} className="flex items-center gap-3 px-5 py-2.5 text-sm" data-featured-row={p.id}>
            <span className="w-6 text-center font-bold text-muted">{i + 1}</span>
            <ProductImage src={p.imageUrl} alt={p.title} className="size-10 rounded-lg bg-surface" />
            <span className="flex-1"><b className="line-clamp-1">{p.title}</b><span className="text-xs text-muted">{p.store}{p.status !== 'ACTIVE' ? ` · ${t('No publicado: no se muestra')}` : ''}</span></span>
            <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Subir')}><ArrowUp /></Button>
            <Button size="icon" variant="ghost" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={t('Bajar')}><ArrowDown /></Button>
          </li>
        ))}
      </ol>
      <div className="flex justify-end gap-2 border-t border-line p-4">
        <Button variant="secondary" disabled={!changed} onClick={() => setList(q.data!)}>{t('Descartar cambios')}</Button>
        <Button loading={busy} disabled={!changed} onClick={save} data-featured-save><Check /> {t('Guardar orden')}</Button>
      </div>
    </Card>
  );
}
