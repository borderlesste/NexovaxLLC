'use client';
import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import { availabilityText, useAvailability, type Availability } from '@/lib/delivery';
import { countryName, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { DeliveryCountrySelector } from '@/components/layout/delivery-country-selector';

const TONE = {
  AVAILABLE: { icon: CheckCircle2, box: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'text-emerald-700' },
  UNAVAILABLE: { icon: XCircle, box: 'border-red-200 bg-red-50 text-red-800', text: 'text-red-600' },
  UNCONFIRMED: { icon: CircleHelp, box: 'border-amber-200 bg-amber-50 text-amber-800', text: 'text-amber-700' },
} as const;

const textOf = (a: Availability, country: string) => availabilityText(a, country, t, (c) => countryName(c) || c);

/** One line on product cards: only when the product can't be shipped to the destination, or confirmed available. */
export function AvailabilityLine({ productId, className }: { productId: string; className?: string }) {
  const { availability: a, country } = useAvailability(productId);
  if (!a || !country || a.status === 'UNCONFIRMED' || a.reason === 'NO_SHIPPING_NEEDED') return null;
  const tone = TONE[a.status];
  const Icon = tone.icon;
  return (
    <p className={cn('flex items-center gap-1 text-[11px] font-semibold', tone.text, className)} data-availability={a.status}>
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{a.status === 'AVAILABLE' ? t('Envía a {c}', { c: countryName(country) || country }) : t('No envía a {c}', { c: countryName(country) || country })}</span>
    </p>
  );
}

/** Product page panel: state, reason and a way to change the destination. */
export function AvailabilityPanel({ productId, className }: { productId: string; className?: string }) {
  const { availability: a, country } = useAvailability(productId);
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
export function AvailabilityWarning({ productId }: { productId: string }) {
  const { availability: a, country } = useAvailability(productId);
  if (!a || !country || a.status !== 'UNAVAILABLE') return null;
  const { title, detail } = textOf(a, country);
  return (
    <p className="mt-1 flex items-start gap-1 text-xs font-semibold text-red-600" data-availability={a.status}>
      <XCircle className="mt-px size-3.5 shrink-0" /> <span>{title}. {detail}</span>
    </p>
  );
}

export { textOf as availabilityLabel };
