'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { HandCoins } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { getLocale, t } from '@/lib/i18n';
import { money } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Dialog } from '@/components/ui/misc';

/** Admin: refund delivered units the customer keeps (no physical return). */
export function RefundWithoutReturn({ order }: { order: any }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [soId, setSoId] = useState(order.sellerOrders[0]?.id ?? '');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('DAMAGED');
  const [note, setNote] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const reasons = useQuery({ queryKey: ['return-reasons'], queryFn: () => get<any[]>('/me/returns/reasons'), enabled: open });
  const so = order.sellerOrders.find((s: any) => s.id === soId);
  const items = (so?.items ?? []).filter((i: any) => i.delivered > 0);
  useEffect(() => setQty({}), [soId]);
  if (!order.sellerOrders.some((s: any) => s.items.some((i: any) => i.delivered > 0))) return null;
  const total = items.reduce((s: number, i: any) => s + Number(i.unitPrice) * (qty[i.id] ?? 0), 0);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await post(`/admin/orders/${order.id}/refund-without-return`, {
        sellerOrderId: soId, reasonCode: reason, note: note.trim(), manualReference: ref.trim() || undefined,
        items: Object.entries(qty).filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
      });
      toast.success(t('Reembolso realizado.'));
      router.push(`/admin/devoluciones/${r.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-no-return-open><HandCoins /> {t('Reembolsar sin devolución')}</Button>
      <Dialog open={open} onOpenChange={setOpen} title={t('Reembolsar sin devolución')} size="lg"
        description={t('Para productos entregados que el cliente se queda (dañados, equivocados, perdidos…). Se devuelve el dinero por el medio de pago original y no se repone inventario.')}
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>{t('Cancelar')}</Button><Button loading={busy} disabled={!Object.values(qty).some((q) => q > 0) || note.trim().length < 5} onClick={submit} data-no-return-submit>{t('Reembolsar')}{total > 0 ? ` (${t('productos')} ${money(total, order.currency)})` : ''}</Button></>}>
        <div className="space-y-3 text-sm">
          {order.sellerOrders.length > 1 && (
            <Field label={t('Tienda')}><Select value={soId} onChange={(e) => setSoId(e.target.value)}>{order.sellerOrders.map((s: any) => <option key={s.id} value={s.id}>{s.seller.name} · {s.number}</option>)}</Select></Field>
          )}
          {items.map((i: any) => (
            <div key={i.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
              <span className="min-w-0"><b className="block truncate">{i.title}</b><span className="text-muted">{money(i.unitPrice, order.currency)} · {t('Entregadas')}: {i.delivered}</span></span>
              <Select value={String(qty[i.id] ?? 0)} onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })} className="w-24" data-no-return-qty>
                {Array.from({ length: i.delivered + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </div>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Motivo')} required>
              <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                {(reasons.data ?? []).map((r: any) => <option key={r.code} value={r.code}>{getLocale() === 'en' && r.labelEn ? r.labelEn : t(r.label)}</option>)}
              </Select>
            </Field>
            <Field label={t('Referencia de la transferencia')} hint={t('Solo si se pagó por transferencia')}><Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} /></Field>
          </div>
          <Field label={t('Nota para el cliente')} required><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t('Ej. Lamentamos que el producto llegara dañado; te devolvemos el importe.')} data-no-return-note /></Field>
          <p className="text-xs text-muted">{t('Si se reembolsan todas las unidades, también se reembolsa el envío según la política de la tienda. El monto del vendedor y la comisión se revierten.')}</p>
        </div>
      </Dialog>
    </>
  );
}
