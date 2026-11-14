'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, post } from '@/lib/api';
import { getLocale, t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

const ZERO_DECIMAL = new Set(['CLP', 'JPY', 'KRW', 'VND', 'PYG', 'XAF', 'XOF']);
const minorUnits = (amount: string | number, currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(Number(amount)) : Math.round(Number(amount) * 100));

export interface PlacedCheckout {
  checkoutId: string;
  orderId?: string | null;
  paymentAction?: { provider: 'STRIPE'; clientSecret: string } | { provider: 'PAYPAL'; orderId: string } | null;
}

/** Stripe Elements in deferred-intent mode: the card form renders before the order is created. */
export function StripeBoundary({ publishableKey, amount, currency, saveCard, children }: { publishableKey?: string | null; amount: string; currency: string; saveCard?: boolean; children: React.ReactNode }) {
  const stripePromise = useMemo(() => (publishableKey ? loadStripe(publishableKey, { locale: getLocale() === 'en' ? 'en' : 'es-419' }) : null), [publishableKey]);
  if (!stripePromise) return <>{children}</>;
  return (
    <Elements
      stripe={stripePromise}
      options={{
        mode: 'payment',
        amount: Math.max(minorUnits(amount, currency), 50),
        currency: currency.toLowerCase(),
        paymentMethodTypes: ['card'],
        ...(saveCard ? { setupFutureUsage: 'on_session' as const } : {}),
        appearance: { theme: 'stripe', variables: { colorPrimary: '#0a6cf5', borderRadius: '10px', fontFamily: 'Inter, system-ui, sans-serif', colorText: '#0f172a' } },
      }}
    >
      <AmountSync amount={amount} currency={currency} saveCard={!!saveCard} />
      {children}
    </Elements>
  );
}

function AmountSync({ amount, currency, saveCard }: { amount: string; currency: string; saveCard: boolean }) {
  const elements = useElements();
  useEffect(() => {
    // "Save this card" must match the PaymentIntent's setup_future_usage.
    elements?.update({ amount: Math.max(minorUnits(amount, currency), 50), currency: currency.toLowerCase(), setupFutureUsage: saveCard ? 'on_session' : null } as any);
  }, [elements, amount, currency, saveCard]);
  return null;
}

export function StripeCardForm({ billing }: { billing?: { name?: string; email?: string; country?: string; postalCode?: string | null } }) {
  return (
    <PaymentElement
      key={billing?.country ?? 'x'}
      options={{
        layout: 'tabs',
        paymentMethodOrder: ['card'],
        wallets: { applePay: 'never', googlePay: 'never', link: 'never' } as any,
        terms: { card: 'never' },
        defaultValues: { billingDetails: { name: billing?.name, email: billing?.email, address: { country: billing?.country, postal_code: billing?.postalCode ?? undefined } } },
      }}
    />
  );
}

/**
 * Pays with the card typed in the Payment Element:
 * validate → create the order's payment (PaymentIntent) → confirm with Stripe (3-D Secure in place)
 * → server verifies with Stripe and creates the order. A declined card can be retried on the same intent.
 */
export function StripePayButton({ place, onPaid, disabled, resetKey, savedCard }: { place: () => Promise<PlacedCheckout>; onPaid: (checkoutId: string) => void; disabled?: boolean; resetKey: string; savedCard?: boolean }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ checkoutId: string; clientSecret: string } | null>(null);

  // Address / shipping / cart changed after an unpaid attempt: release it and start over.
  useEffect(() => {
    const p = pending.current;
    if (p) {
      pending.current = null;
      post(`/checkout/${p.checkoutId}/cancel`).catch(() => undefined);
    }
  }, [resetKey, savedCard]);

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    try {
      if (!savedCard) {
        const { error: submitError } = await elements.submit();
        if (submitError) return toast.error(submitError.message ?? t('Revisa los datos de la tarjeta.'));
      }
      if (!pending.current) {
        const r = await place();
        if (r.orderId) return onPaid(r.checkoutId);
        const action = r.paymentAction;
        if (!action || action.provider !== 'STRIPE') throw new Error(t('No se pudo iniciar el pago con tarjeta.'));
        pending.current = { checkoutId: r.checkoutId, clientSecret: action.clientSecret };
      }
      const { checkoutId, clientSecret } = pending.current;
      // Saved card: the PaymentIntent already carries it; Stripe.js only handles 3-D Secure.
      const { error } = savedCard
        ? await stripe.confirmCardPayment(clientSecret)
        : await stripe.confirmPayment({
            elements,
            clientSecret,
            confirmParams: { return_url: `${window.location.origin}/checkout/confirmacion/${checkoutId}` },
            redirect: 'if_required',
          });
      if (error) return toast.error(error.message ?? t('El pago fue rechazado.'));
      await post(`/checkout/${checkoutId}/payments/stripe/confirm`);
      pending.current = null;
      onPaid(checkoutId);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button size="lg" className="mt-5 h-14 w-full text-lg" onClick={pay} loading={busy} disabled={disabled || !stripe || !elements}>
      <Lock /> {t('Pagar y confirmar compra')}
    </Button>
  );
}

/** PayPal Smart Buttons: the PayPal order is created and captured by our API. */
export function PaypalPay({ clientId, currency, place, onPaid, disabled }: { clientId: string; currency: string; place: () => Promise<PlacedCheckout>; onPaid: (checkoutId: string) => void; disabled?: boolean }) {
  const checkoutRef = useRef<string | null>(null);
  return (
    <div className="mt-5">
      <PayPalScriptProvider options={{ clientId, currency, intent: 'capture', components: 'buttons', locale: getLocale() === 'en' ? 'en_US' : 'es_ES' }}>
        <PayPalButtons
          style={{ layout: 'vertical', shape: 'rect', label: 'pay', height: 48 }}
          disabled={disabled}
          forceReRender={[currency, disabled]}
          createOrder={async () => {
            const r = await place();
            checkoutRef.current = r.checkoutId;
            if (r.paymentAction?.provider !== 'PAYPAL') throw new Error(t('No se pudo iniciar el pago con PayPal.'));
            return r.paymentAction.orderId;
          }}
          onApprove={async () => {
            try {
              await post(`/checkout/${checkoutRef.current}/payments/paypal/capture`);
              onPaid(checkoutRef.current!);
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}
          onCancel={() => {
            if (checkoutRef.current) post(`/checkout/${checkoutRef.current}/cancel`).catch(() => undefined);
            toast.info(t('Pago con PayPal cancelado.'));
          }}
          onError={(e) => toast.error(errorMessage(e))}
        />
      </PayPalScriptProvider>
    </div>
  );
}
