'use client';
import { CheckCircle2, CircleHelp, MapPin, XCircle } from 'lucide-react';
import { availabilityText, useAvailability, useAvailabilityMany, useDelivery, type Availability } from '@/lib/delivery';
import { countryName, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { DeliveryCountrySelector } from '@/components/layout/delivery-country-selector';

const TONE = {
  AVAILABLE: { icon: CheckCircle2, box: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'text-emerald-700' },
  UNAVAILABLE: { icon: XCircle, box: 'border-red-200 bg-red-50 text-red-800', text: 'text-red-600' },
  UNCONFIRMED: { icon: CircleHelp, box: 'border-amber-200 bg-amber-50 text-amber-800', text: 'text-amber-700' },
} as const;

const textOf = (a: Availability, country: string) => availabilityText(a, country, t, (c) => countryName(c) || c);

/** One line on product cards with the three states (NX-GEO-001 §4): Disponible, No disponible or Por confirmar. */
export function AvailabilityLine({ productId, className }: { productId: string; className?: string }) {
  const { availability: a, country } = useAvailability(productId);
  if (!a || !country || a.reason === 'NO_SHIPPING_NEEDED' || a.reason === 'NOT_FOUND') return null;
  const tone = TONE[a.status];
  const Icon = tone.icon;
  const c = countryName(country) || country;
  const label = a.status === 'AVAILABLE' ? t('Envía a {c}', { c }) : a.status === 'UNAVAILABLE' ? t('No envía a {c}', { c }) : t('Envío a {c} por confirmar', { c });
  return (
    <p className={cn('flex items-center gap-1 text-[11px] font-semibold', tone.text, className)} data-availability={a.status} title={textOf(a, country).detail || undefined}>
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </p>
  );
}

/** Product page panel for the selected variant: state, reason and a way to change the destination. */
export function AvailabilityPanel({ productId, variantId, className }: { productId: string; variantId?: string | null; className?: string }) {
  const { availability: a, country } = useAvailability(productId, variantId);
  if (!a || !country) return null;
  const tone = TONE[a.status];
  const Icon = tone.icon;
  const { title, detail } = textOf(a, country);
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', tone.box, className)} data-availability={a.status} role="status">
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {detail && <p className="mt-0.5 text-xs opacity-90">{detail}</p>}
      </div>
      <DeliveryCountrySelector compact className="shrink-0 bg-white/70 text-ink" />
    </div>
  );
}

/** Cart line warning: only for "No disponible" (the checkout confirms the rest with the address). */
export function AvailabilityWarning({ productId, variantId }: { productId: string; variantId?: string | null }) {
  const { availability: a, country } = useAvailability(productId, variantId);
  if (!a || !country || a.status !== 'UNAVAILABLE') return null;
  const { title, detail } = textOf(a, country);
  return (
    <p className="mt-1 flex items-start gap-1 text-xs font-semibold text-red-600" data-availability={a.status}>
      <XCircle className="mt-px size-3.5 shrink-0" /> <span>{title}. {detail}</span>
    </p>
  );
}

/**
 * Cart summary for the browsing destination: how many items can't be shipped there, with the
 * selector to change it. Changing the destination re-evaluates every line (NX-GEO-001 §4).
 */
export function CartDestinationBanner({ lines }: { lines: { productId: string; variantId?: string | null }[] }) {
  const { country, isApproximate, byProduct } = useAvailabilityMany(lines);
  if (!country) return null;
  const blocked = [...byProduct.values()].filter((a) => a.status === 'UNAVAILABLE').length;
  const unsure = [...byProduct.values()].filter((a) => a.status === 'UNCONFIRMED').length;
  const name = countryName(country) || country;
  const tone = blocked ? 'border-red-200 bg-red-50 text-red-900' : 'border-line bg-white text-ink';
  return (
    <div className={cn('mt-4 flex flex-col gap-3 rounded-xl border p-4 text-sm sm:flex-row sm:items-center', tone)} data-cart-destination={country} role="status">
      <MapPin className="size-5 shrink-0 text-brand-600" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {blocked
            ? blocked === 1 ? t('1 producto no se envía a {c}.', { c: name }) : t('{n} productos no se envían a {c}.', { n: blocked, c: name })
            : isApproximate ? t('Destino sugerido: {c}.', { c: name }) : t('Destino de entrega: {c}.', { c: name })}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {blocked
            ? t('Quítalos o cambia el país de entrega. Al pagar se confirma todo con tu dirección.')
            : unsure
              ? t('El envío de algunos productos se confirma con tu dirección al pagar.')
              : t('Al pagar se confirman el envío, su costo y los impuestos con tu dirección.')}
        </p>
      </div>
      <DeliveryCountrySelector compact className="shrink-0 self-start border border-line bg-white sm:self-auto" />
    </div>
  );
}

/**
 * Checkout: the confirmed address decides (NX-GEO-001 §3). When it is in another country than the
 * browsing destination, say so and offer to browse with the address country.
 */
export function AddressCountryNotice({ addressCountry }: { addressCountry: string | null }) {
  const { context, setCountry } = useDelivery();
  if (!addressCountry || !context || context.deliveryCountry === addressCountry) return null;
  if (context.countries.length && !context.countries.includes(addressCountry)) return null;
  const a = countryName(addressCountry) || addressCountry;
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center" data-address-country-notice>
      <p className="flex-1">
        {t('Tu dirección está en {a}; navegabas con destino {d}. Calculamos el envío, los impuestos y la disponibilidad para {a}.', { a, d: countryName(context.deliveryCountry) || context.deliveryCountry })}
      </p>
      <button type="button" onClick={() => setCountry(addressCountry)} className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-amber-200 hover:bg-brand-50">
        {t('Usar {a} como destino', { a })}
      </button>
    </div>
  );
}

export { textOf as availabilityLabel };
