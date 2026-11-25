'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { cn, fmtDateTime, money } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/input';
import { Dialog, Empty, PageLoader } from '@/components/ui/misc';
import { ProductImage } from '@/components/shop/product-card';
import { FlashCountdown } from '@/components/shop/flash-countdown';

const FLASH_STATE: Record<string, [string, 'green' | 'amber' | 'gray' | 'red' | 'blue']> = {
  LIVE: ['En curso', 'green'], SCHEDULED: ['Programada', 'blue'], ENDED: ['Terminada', 'gray'], CANCELLED: ['Cancelada', 'gray'], REMOVED: ['Retirada por el marketplace', 'red'],
};

/** <input type="datetime-local"> value for a date (local time). */
const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function ProductSelect({ value, onChange }: { value: any; onChange: (p: any) => void }) {
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['seller-products-flash', search],
    queryFn: () => get<any>(`/seller/products?status=ACTIVE&pageSize=50&search=${encodeURIComponent(search)}`),
  });
  return (
    <div className="rounded-xl border border-line" data-flash-product-select>
      <div className="border-b border-line p-2"><Input icon={<Search />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Buscar en mis productos')} /></div>
      <div className="max-h-56 overflow-y-auto p-1">
        {(q.data?.items ?? []).map((p: any) => (
          <button key={p.id} type="button" onClick={() => onChange(p)} className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface', value?.id === p.id && 'bg-brand-50 font-semibold text-brand-700')}>
            <ProductImage src={p.imageUrl} alt={p.title} className="size-10 rounded-md object-cover" />
            <span className="flex-1 truncate">{p.title}</span>
            {p.price && <span className="text-xs text-muted">{money(p.price)}</span>}
          </button>
        ))}
        {q.data && !q.data.items?.length && <p className="p-3 text-sm text-muted">{t('No hay productos publicados que coincidan.')}</p>}
      </div>
    </div>
  );
}

export default function FlashDealsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['seller-flash-deals'], queryFn: () => get<any>('/seller/flash-deals') });
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState<any>(null);
  const [discount, setDiscount] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const rules = q.data?.rules;
  const refresh = () => qc.invalidateQueries({ queryKey: ['seller-flash-deals'] });
  const openNew = () => {
    setProduct(null);
    setDiscount(String(Math.max(rules?.minDiscount ?? 10, 20)));
    setStartsAt('');
    setEndsAt(toLocal(new Date(Date.now() + Math.min(24, rules?.maxHours ?? 24) * 3600_000)));
    setOpen(true);
  };
  const create = async () => {
    setBusy(true);
    try {
      await post('/seller/flash-deals', {
        productId: product.id, discountPercent: Number(discount),
        startsAt: startsAt ? new Date(startsAt).toISOString() : null, endsAt: new Date(endsAt).toISOString(),
      });
      toast.success(t('Oferta relámpago creada.'));
      setOpen(false);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (d: any) => {
    if (!confirm(t('¿Terminar ahora la oferta de {a}? El producto vuelve a su precio normal.', { a: d.title }))) return;
    try { await post(`/seller/flash-deals/${d.id}/cancel`, {}); toast.success(t('Oferta terminada.')); refresh(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const pct = Number(discount);
  const preview = product?.price && pct > 0 && pct < 100 ? Number(product.price) * (1 - pct / 100) : null;
  return (
    <>
      <PageHeader crumbs={[{ label: t('Inicio') }, { label: t('Ofertas relámpago') }]} title={t('Ofertas relámpago')}
        description={t('Rebaja un producto por tiempo limitado. Sale en la portada con una cuenta regresiva y al terminar vuelve solo a su precio normal. El descuento lo financia tu tienda.')}
        actions={rules?.enabled !== false && <Button onClick={openNew} data-flash-new><Plus /> {t('Nueva oferta relámpago')}</Button>} />
      {rules && (
        <p className="mb-4 text-sm text-muted" data-flash-rules>
          {rules.enabled === false
            ? t('El marketplace desactivó las ofertas relámpago por ahora.')
            : t('Reglas del marketplace: descuento mínimo {a} %, duración máxima {b} horas, hasta {c} ofertas activas o programadas a la vez.', { a: rules.minDiscount, b: rules.maxHours, c: rules.maxPerSeller })}
        </p>
      )}
      <Card>
        {q.isLoading ? <PageLoader /> : !q.data?.items?.length ? (
          <Empty icon={<Zap />} title={t('Aún no tienes ofertas relámpago')} description={t('Elige un producto, el descuento y cuándo termina.')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-flash-table>
              <thead className="bg-surface text-left text-xs text-muted"><tr><th className="px-5 py-2.5">{t('Producto')}</th><th>{t('Descuento')}</th><th>{t('Precio')}</th><th>{t('Vigencia')}</th><th>{t('Estado')}</th><th /></tr></thead>
              <tbody className="divide-y divide-line">
                {q.data.items.map((d: any) => (
                  <tr key={d.id} data-flash-row={d.state}>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-3"><ProductImage src={d.imageUrl} alt={d.title} className="size-10 rounded-md object-cover" /><span className="max-w-64 truncate font-semibold">{d.title}</span></span>
                    </td>
                    <td className="font-semibold">-{d.discountPercent} %</td>
                    <td className="text-xs">{d.flashPrice && <b className="text-sm">{money(d.flashPrice)}</b>} {d.regularPrice && <span className="text-muted line-through">{money(d.regularPrice)}</span>}</td>
                    <td className="text-xs text-muted">{fmtDateTime(d.startsAt)} → {fmtDateTime(d.endsAt)}{d.state === 'LIVE' && <span className="mt-1 block"><FlashCountdown endsAt={d.endsAt} compact /></span>}</td>
                    <td>
                      <Badge tone={FLASH_STATE[d.state]?.[1] ?? 'gray'}>{t(FLASH_STATE[d.state]?.[0] ?? d.state)}</Badge>
                      {d.removalReason && <span className="mt-1 block max-w-56 text-xs text-muted">{d.removalReason}</span>}
                    </td>
                    <td className="pr-5 text-right">{(d.state === 'LIVE' || d.state === 'SCHEDULED') && <Button size="sm" variant="secondary" onClick={() => cancel(d)}>{t('Terminar')}</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)} size="lg" title={t('Nueva oferta relámpago')}
          description={t('Mientras dure, el precio del producto (todas sus variantes) baja el porcentaje que elijas y no podrás cambiarlo. Puedes terminarla antes cuando quieras.')}
          footer={<><Button variant="secondary" onClick={() => setOpen(false)}>{t('Cancelar')}</Button><Button loading={busy} disabled={!product || !discount || !endsAt} onClick={create} data-flash-save>{t('Crear oferta')}</Button></>}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-flash-form>
            <div className="sm:col-span-2">
              <p className="mb-2 text-sm font-semibold">{t('Producto')}</p>
              <ProductSelect value={product} onChange={setProduct} />
            </div>
            <Field label={t('Descuento')} required hint={rules ? t('Mínimo {a} %', { a: rules.minDiscount }) : undefined}>
              <Input inputMode="decimal" suffix="%" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} data-flash-discount />
            </Field>
            <div className="flex items-end pb-2 text-sm">
              {preview != null && <span>{t('Precio en oferta')}: <b>{money(preview)}</b> <span className="text-muted line-through">{money(product.price)}</span></span>}
            </div>
            <Field label={t('Empieza')} hint={t('Vacío: ahora mismo')}><Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></Field>
            <Field label={t('Termina')} required hint={rules ? t('Máximo {a} horas', { a: rules.maxHours }) : undefined}><Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} data-flash-ends /></Field>
          </div>
        </Dialog>
      )}
    </>
  );
}
