'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { fmtDateTime, money } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Dialog, PageLoader } from '@/components/ui/misc';

const AUD: [string, string][] = [['BOTH', 'Favoritos y carrito'], ['FAVORITES', 'Lo tienen en favoritos'], ['CART', 'Lo tienen en el carrito']];

/** Store: send a coupon to the people interested in a product. Only counts are shown, never who. */
export function OfferDialog({ product, onClose }: { product: { id: string; title: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['offer-audience', product.id], queryFn: () => get<any>(`/seller/offers/audience?productId=${product.id}`) });
  const [audience, setAudience] = useState('BOTH');
  const [coupon, setCoupon] = useState('NEW');
  const [pct, setPct] = useState('10');
  const [days, setDays] = useState('7');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data?.coupons?.length) setCoupon(q.data.coupons[0].id);
  }, [q.data?.coupons]);
  const n = q.data?.counts?.[audience] ?? 0;
  const send = async () => {
    setBusy(true);
    try {
      const r = await post<any>('/seller/offers', {
        productId: product.id, audience, message: message.trim() || undefined,
        ...(coupon === 'NEW' ? { newCoupon: { percent: Number(pct), days: Number(days) } } : { couponId: coupon }),
      });
      toast.success(r.recipients === 1 ? t('Oferta enviada a 1 persona con el cupón {code}.', { code: r.code }) : t('Oferta enviada a {n} personas con el cupón {code}.', { n: r.recipients, code: r.code }));
      qc.invalidateQueries({ queryKey: ['seller-offers'] });
      qc.invalidateQueries({ queryKey: ['seller-coupons'] });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={t('Ofrecer cupón a interesados')} description={product.title}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Cancelar')}</Button><Button loading={busy} disabled={!q.data || n < 1 || !!q.data.availableAt || !q.data.product.active} onClick={send} data-offer-send><Send /> {n === 1 ? t('Enviar a 1 persona') : t('Enviar a {n} personas', { n })}</Button></>}>
      {!q.data ? <PageLoader /> : (
        <div className="space-y-4" data-offer-dialog>
          <p className="flex items-start gap-2 rounded-xl bg-surface p-3 text-sm text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" />{t('NEXOVAX envía la oferta por ti. Nunca verás quiénes son: solo cuántas personas la reciben y cuántas compran. No se envía a quien ya compró el producto ni a quien recibió muchas ofertas esta semana.')}</p>
          {q.data.availableAt && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{t('Ya enviaste una oferta de este producto esta semana. Podrás enviar otra desde el {d}.', { d: fmtDateTime(q.data.availableAt) })}</p>}
          {!q.data.product.active && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{t('El producto debe estar publicado para enviar una oferta.')}</p>}
          <Field label={t('Enviar a')} required>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {AUD.map(([v, l]) => (
                <label key={v} className={`flex cursor-pointer flex-col rounded-xl border p-3 text-sm ${audience === v ? 'border-brand-600 bg-brand-50' : 'border-line'}`}>
                  <span className="flex items-center gap-2 font-semibold"><input type="radio" checked={audience === v} onChange={() => setAudience(v)} /> {t(l)}</span>
                  <span className="mt-1 text-2xl font-extrabold" data-audience={v}>{q.data.counts[v]}</span>
                  <span className="text-xs text-muted">{q.data.counts[v] === 1 ? t('persona') : t('personas')}</span>
                </label>
              ))}
            </div>
          </Field>
          <Field label={t('Cupón')} required>
            <Select value={coupon} onChange={(e) => setCoupon(e.target.value)} data-offer-coupon>
              <option value="NEW">{t('Crear un cupón nuevo solo para este producto')}</option>
              {q.data.coupons.map((c: any) => <option key={c.id} value={c.id}>{c.code} · {c.type === 'PERCENT' ? `${c.value} %` : money(c.value)}</option>)}
            </Select>
          </Field>
          {coupon === 'NEW' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('Descuento (%)')} required><Input type="number" min={1} max={90} step="1" value={pct} onChange={(e) => setPct(e.target.value)} data-offer-pct /></Field>
              <Field label={t('Válido por (días)')} required><Input type="number" min={1} max={30} step="1" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
              <p className="text-xs text-muted sm:col-span-2">{t('Se crea un código único, válido una vez por cliente y solo para este producto. El descuento lo financia tu tienda.')}</p>
            </div>
          )}
          <Field label={t('Mensaje para los clientes (opcional)')} hint={t('Hasta 280 caracteres, sin enlaces.')}>
            <Textarea rows={2} maxLength={280} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('Ej.: ¡Gracias por tu interés! Solo por esta semana.')} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

/** Store: past offers and their results (totals only). */
export function OfferCampaigns() {
  const q = useQuery({ queryKey: ['seller-offers'], queryFn: () => get<any[]>('/seller/offers') });
  if (!q.data?.length) return null;
  const AUD_LABEL: Record<string, string> = Object.fromEntries(AUD);
  return (
    <div className="card mt-5" data-offer-campaigns>
      <div className="border-b border-line px-5 py-4"><p className="font-bold">{t('Ofertas enviadas')}</p><p className="text-sm text-muted">{t('Resultados en totales: cuántas personas recibieron la oferta y cuántas compraron con el cupón.')}</p></div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs text-muted"><tr><th className="px-5 py-2.5">{t('Fecha')}</th><th>{t('Producto')}</th><th>{t('Cupón')}</th><th>{t('Enviado a')}</th><th>{t('Compraron')}</th><th>{t('Ventas')}</th></tr></thead>
        <tbody className="divide-y divide-line">
          {q.data.map((c) => (
            <tr key={c.id} data-offer-row>
              <td className="px-5 py-3 text-muted">{fmtDateTime(c.createdAt)}</td>
              <td>{c.product}</td>
              <td className="font-mono font-semibold">{c.code}</td>
              <td>{c.recipients}<span className="block text-xs text-muted">{t(AUD_LABEL[c.audience] ?? c.audience)}</span></td>
              <td>{c.buyers}{c.recipients > 0 && <span className="block text-xs text-muted">{Math.round((c.buyers / c.recipients) * 1000) / 10} %</span>}</td>
              <td>{money(c.sales)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
