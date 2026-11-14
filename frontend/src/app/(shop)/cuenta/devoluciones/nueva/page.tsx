'use client';
import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, Info, RotateCcw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, upload } from '@/lib/api';
import { getLocale, t } from '@/lib/i18n';
import { cn, fmtDate, money, uid } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/input';
import { Empty, ErrorBox, PageLoader } from '@/components/ui/misc';
import { ProductImage } from '@/components/shop/product-card';
import { FilePicker, formWith } from '@/components/attachments/attachments';
import { policySummary } from '@/components/returns/return-policy';

const WHY: Record<string, string> = {
  NOT_DELIVERED: 'Podrás solicitar la devolución cuando el pedido se marque como entregado.',
  WINDOW_EXPIRED: 'El plazo de devolución ya venció.',
  NOTHING_LEFT: 'Ya devolviste o tienes en devolución todas las unidades.',
};

function NewReturn() {
  const sp = useSearchParams();
  const router = useRouter();
  const orderId = sp.get('pedido') ?? '';
  const q = useQuery({ queryKey: ['returnable', orderId], queryFn: () => get(`/me/orders/${orderId}/returnable`), enabled: !!orderId });
  const [groupId, setGroupId] = useState<string | null>(sp.get('tienda'));
  const [sel, setSel] = useState<Record<string, { qty: number; reason: string; comment: string }>>({});
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => uid());
  const data = q.data;
  const groups = data?.sellerOrders ?? [];
  const group = groups.find((g: any) => g.sellerOrderId === groupId) ?? groups.find((g: any) => g.eligible) ?? groups[0];
  const reasons = data?.reasons ?? [];
  const label = (r: any) => (getLocale() === 'en' && r.labelEn ? r.labelEn : t(r.label));
  const chosen = useMemo(() => Object.entries(sel).filter(([, v]) => v.qty > 0), [sel]);
  const needsPhoto = chosen.some(([, v]) => reasons.find((r: any) => r.code === v.reason)?.requiresEvidence);
  const total = chosen.reduce((s, [id, v]) => s + Number(group?.items.find((i: any) => i.orderItemId === id)?.unitPrice ?? 0) * v.qty, 0);
  if (!orderId) return <Empty icon={<RotateCcw />} title={t('Elige el pedido a devolver')} description={t('Entra al detalle de un pedido entregado y pulsa «Solicitar devolución».')} action={<Button asChild><Link href="/cuenta/pedidos">{t('Ver mis pedidos')}</Link></Button>} />;
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const set = (id: string, patch: Partial<{ qty: number; reason: string; comment: string }>) => setSel((s) => ({ ...s, [id]: { ...(s[id] ?? { qty: 0, reason: '', comment: '' }), ...patch } }));
  const submit = async () => {
    if (!chosen.length) return toast.error(t('Selecciona al menos un producto y la cantidad a devolver.'));
    for (const [id, v] of chosen) {
      const it = group.items.find((i: any) => i.orderItemId === id);
      const r = reasons.find((x: any) => x.code === v.reason);
      if (!r) return toast.error(t('Indica el motivo de la devolución de «{p}».', { p: it.title }));
      if (r.requiresComment && !v.comment.trim() && !comment.trim()) return toast.error(t('Explica el motivo «{r}» en el comentario.', { r: label(r) }));
    }
    if ((needsPhoto || group.policy?.requireEvidence) && !files.length) return toast.error(t('Adjunta al menos una foto del problema.'));
    setBusy(true);
    try {
      const r = await upload('/me/returns', formWith({
        sellerOrderId: group.sellerOrderId, comment: comment.trim(), idempotencyKey: key,
        items: JSON.stringify(chosen.map(([orderItemId, v]) => ({ orderItemId, quantity: v.qty, reasonCode: v.reason, comment: v.comment.trim() || undefined }))),
      }, files));
      toast.success(t('Solicitud enviada. La tienda la revisará pronto.'));
      router.replace(`/cuenta/devoluciones/${r.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <Link href={`/cuenta/pedidos/${orderId}`} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><ChevronLeft className="size-4" /> {t('Volver al pedido')}</Link>
      <h1 className="text-3xl font-extrabold">{t('Solicitar devolución')}</h1>
      <p className="text-muted">{t('Pedido')} {data.orderNumber} · {t('Tienes {n} días desde la entrega para devolver.', { n: data.policy.windowDays })}</p>
      {groups.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {groups.map((g: any) => (
            <button key={g.sellerOrderId} onClick={() => { setGroupId(g.sellerOrderId); setSel({}); }} className={cn('rounded-lg border px-3 py-2 text-sm font-semibold', g.sellerOrderId === group?.sellerOrderId ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-line bg-white')}>{g.store}</button>
          ))}
        </div>
      )}
      {group && !group.eligible ? (
        <Card className="mt-5 p-6"><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-5 text-amber-500" /> {t(WHY[group.reason] ?? 'Este pedido no admite devoluciones.')}</p></Card>
      ) : group ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <Card className="divide-y divide-line">
              {group.items.map((i: any) => {
                const v = sel[i.orderItemId] ?? { qty: 0, reason: '', comment: '' };
                const r = reasons.find((x: any) => x.code === v.reason);
                return (
                  <div key={i.orderItemId} className={cn('p-5', !i.returnable && 'opacity-60')} data-return-item>
                    <div className="flex gap-4">
                      <ProductImage src={i.imageUrl} alt={i.title} className="size-16 shrink-0 rounded-lg bg-surface" />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-bold">{i.title}</p>
                        {i.variantTitle && <p className="text-muted">{i.variantTitle}</p>}
                        <p className="text-muted">{money(i.unitPrice, data.currency)} · {t('Recibidas')}: {i.delivered}{i.inProgress ? ` · ${t('En devolución')}: ${i.inProgress}` : ''}</p>
                      </div>
                      <Field label={t('Cantidad')} className="w-28">
                        <Select value={String(v.qty)} disabled={!i.returnable} onChange={(e) => set(i.orderItemId, { qty: Number(e.target.value) })} data-return-qty>
                          {Array.from({ length: i.returnable + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                        </Select>
                      </Field>
                    </div>
                    {v.qty > 0 && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Field label={t('Motivo')} required>
                          <Select value={v.reason} onChange={(e) => set(i.orderItemId, { reason: e.target.value })} data-return-reason>
                            <option value="">{t('Selecciona un motivo')}</option>
                            {reasons.map((x: any) => <option key={x.code} value={x.code}>{label(x)}</option>)}
                          </Select>
                        </Field>
                        <Field label={t('Detalle')} required={!!r?.requiresComment} hint={r?.requiresComment ? undefined : t('(opcional)')}>
                          <Textarea rows={1} value={v.comment} onChange={(e) => set(i.orderItemId, { comment: e.target.value })} maxLength={500} placeholder={r?.description ? t(r.description) : t('Cuéntanos qué pasó')} />
                        </Field>
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
            <Card className="p-5">
              <Field label={t('Fotos del producto')} required={needsPhoto || !!group.policy?.requireEvidence} hint={needsPhoto ? t('Obligatorias para este motivo') : t('(recomendado) hasta 4 fotos')}>
                <FilePicker files={files} onChange={setFiles} imagesOnly label={t('Agregar fotos')} />
              </Field>
              <Field label={t('Comentario para la tienda')} hint={t('(opcional)')} className="mt-4">
                <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder={t('Información adicional que ayude a la tienda a revisar tu solicitud.')} />
              </Field>
            </Card>
          </div>
          <Card className="h-fit p-5 text-sm lg:sticky lg:top-24">
            <h3 className="font-bold">{t('Resumen')}</h3>
            <p className="mt-2 text-muted">{group.store} · {t('Entregado el {d}', { d: fmtDate(group.deliveredAt) })}</p>
            <p className="text-muted">{t('Puedes devolver hasta el {d}', { d: fmtDate(group.deadline) })}</p>
            {group.policy && <p className="mt-2 rounded-lg bg-surface p-2 text-xs" data-new-return-policy>{group.policy.storePolicy ? t('Política de la tienda') : t('Política del marketplace')}: {policySummary(group.policy)}</p>}
            <div className="mt-4 flex justify-between border-t border-line pt-3 text-base font-extrabold"><span>{t('Reembolso estimado')}</span><span>{money(total, data.currency)}</span></div>
            <p className="mt-1 text-xs text-muted">{t('Más los impuestos de esos productos. El envío original no se reembolsa.')}</p>
            <ul className="mt-4 space-y-2 text-xs text-muted">
              <li className="flex gap-2"><Info className="size-4 shrink-0 text-brand-600" /> {t('La tienda revisa tu solicitud y te indica la dirección de devolución.')}</li>
              <li className="flex gap-2"><Info className="size-4 shrink-0 text-brand-600" /> {t('Tú envías el paquete y registras la guía.')}</li>
              <li className="flex gap-2"><Info className="size-4 shrink-0 text-brand-600" /> {t('Al recibirlo e inspeccionarlo, te reembolsamos al mismo medio de pago.')}</li>
            </ul>
            <Button size="lg" className="mt-5 w-full" onClick={submit} loading={busy} disabled={!chosen.length}><Send /> {t('Enviar solicitud')}</Button>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

export default function NewReturnPage() {
  return <Suspense fallback={<PageLoader />}><NewReturn /></Suspense>;
}
