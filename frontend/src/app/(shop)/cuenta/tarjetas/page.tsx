'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { CreditCard, Lock, Plus, ShieldCheck, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, post } from '@/lib/api';
import { usePublicConfig } from '@/lib/config';
import { getLocale, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, Empty, PageLoader } from '@/components/ui/misc';

interface SavedCard { id: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; isDefault: boolean; expired: boolean }

const BRAND: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', diners: 'Diners Club', jcb: 'JCB', unionpay: 'UnionPay' };

export default function SavedCardsPage() {
  const qc = useQueryClient();
  const cfg = usePublicConfig();
  const q = useQuery({ queryKey: ['cards'], queryFn: () => get<{ enabled: boolean; cards: SavedCard[] }>('/me/cards') });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SavedCard | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const stripePromise = useMemo(() => (cfg?.stripePublishableKey ? loadStripe(cfg.stripePublishableKey, { locale: getLocale() === 'en' ? 'en' : 'es-419' }) : null), [cfg?.stripePublishableKey]);
  const update = (cards: SavedCard[]) => qc.setQueryData(['cards'], { enabled: true, cards });
  // Back from a bank redirect (3-D Secure): record the confirmed card.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const si = sp.get('setup_intent');
    if (!si || sp.get('redirect_status') !== 'succeeded') return;
    window.history.replaceState(null, '', '/cuenta/tarjetas');
    post<SavedCard[]>('/me/cards/confirm', { setupIntentId: si }).then((c) => { update(c); toast.success(t('Tarjeta guardada.')); }).catch((e) => toast.error(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const act = async (key: string, fn: () => Promise<SavedCard[]>, ok: string) => {
    setBusy(key);
    try {
      update(await fn());
      toast.success(t(ok));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (q.isLoading) return <PageLoader />;
  const cards = q.data?.cards ?? [];
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-extrabold">{t('Mis tarjetas')}</h1><p className="text-muted">{t('Tarjetas guardadas para pagar más rápido.')}</p></div>
        {q.data?.enabled && stripePromise && <Button onClick={() => setAdding(true)}><Plus /> {t('Agregar tarjeta')}</Button>}
      </div>
      {!q.data?.enabled ? (
        <div className="card mt-6"><Empty icon={<CreditCard />} title={t('Pagos con tarjeta no disponibles')} description={t('El procesador de pagos no está configurado.')} /></div>
      ) : !cards.length ? (
        <div className="card mt-6"><Empty icon={<CreditCard />} title={t('No tienes tarjetas guardadas')} description={t('Agrega una aquí o marca «Guardar esta tarjeta» al pagar.')} action={stripePromise && <Button onClick={() => setAdding(true)}><Plus /> {t('Agregar tarjeta')}</Button>} /></div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2" data-cards>
          {cards.map((c) => (
            <div key={c.id} className={cn('card p-5', c.isDefault && 'ring-2 ring-brand-200')} data-card={c.last4}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-600"><CreditCard className="size-5" /></span>
                  <div>
                    <p className="font-bold">{BRAND[c.brand ?? ''] ?? c.brand} •••• {c.last4}</p>
                    <p className={cn('text-sm', c.expired ? 'font-semibold text-red-600' : 'text-muted')}>{c.expired ? t('Vencida') : t('Vence')} {String(c.expMonth).padStart(2, '0')}/{c.expYear}</p>
                  </div>
                </div>
                {c.isDefault && <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold text-brand-700">{t('Principal')}</span>}
              </div>
              <div className="mt-4 flex gap-2">
                {!c.isDefault && !c.expired && <Button size="sm" variant="outline" loading={busy === `d-${c.id}`} onClick={() => act(`d-${c.id}`, () => post(`/me/cards/${c.id}/default`), 'Tarjeta principal actualizada.')}><Star /> {t('Usar como principal')}</Button>}
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setRemoving(c)}><Trash2 /> {t('Eliminar')}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-6 flex items-center gap-2 text-xs text-muted"><ShieldCheck className="size-4 text-brand-600" /> {t('Las tarjetas se guardan en Stripe. NEXOVAX solo conoce la marca, los últimos 4 dígitos y la fecha de vencimiento.')}</p>

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title={t('¿Eliminar esta tarjeta?')} description={removing ? `${BRAND[removing.brand ?? ''] ?? removing.brand} •••• ${removing.last4}` : ''}
        footer={<><Button variant="outline" onClick={() => setRemoving(null)}>{t('Cancelar')}</Button><Button variant="danger" loading={busy === 'remove'} onClick={async () => { await act('remove', () => del(`/me/cards/${removing!.id}`), 'Tarjeta eliminada.'); setRemoving(null); }}>{t('Eliminar')}</Button></>}>
        <p className="text-sm text-muted">{t('Tendrás que volver a ingresarla para usarla en otra compra.')}</p>
      </Dialog>

      {adding && stripePromise && (
        <Dialog open onOpenChange={(o) => !o && setAdding(false)} title={t('Agregar tarjeta')} description={t('Tu banco puede pedirte una verificación (3-D Secure).')}>
          <Elements stripe={stripePromise} options={{ mode: 'setup', currency: (cfg?.currency ?? 'USD').toLowerCase(), paymentMethodTypes: ['card'], setupFutureUsage: 'on_session', appearance: { theme: 'stripe', variables: { colorPrimary: '#0a6cf5', borderRadius: '10px' } } }}>
            <AddCardForm onDone={(c) => { update(c); setAdding(false); toast.success(t('Tarjeta guardada.')); }} />
          </Elements>
        </Dialog>
      )}
    </div>
  );
}

function AddCardForm({ onDone }: { onDone: (cards: SavedCard[]) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) return toast.error(submitError.message ?? t('Revisa los datos de la tarjeta.'));
      const { clientSecret } = await post<{ clientSecret: string }>('/me/cards/setup');
      const { error, setupIntent } = await stripe.confirmSetup({ elements, clientSecret, confirmParams: { return_url: `${window.location.origin}/cuenta/tarjetas` }, redirect: 'if_required' });
      if (error) return toast.error(error.message ?? t('No se pudo guardar la tarjeta.'));
      onDone(await post<SavedCard[]>('/me/cards/confirm', { setupIntentId: setupIntent!.id }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never', link: 'never' } as any, terms: { card: 'never' } }} />
      <Button className="w-full" onClick={save} loading={busy} disabled={!stripe}><Lock /> {t('Guardar tarjeta')}</Button>
    </div>
  );
}
