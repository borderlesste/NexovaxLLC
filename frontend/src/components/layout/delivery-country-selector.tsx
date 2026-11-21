'use client';
import * as Popover from '@radix-ui/react-popover';
import { Check, MapPin, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCountries } from '@/components/shop/geo-fields';
import { useDelivery } from '@/lib/delivery';
import { countryName, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * "Enviar a" destination selector (NX-GEO-001). Shows the destination used for browsing and
 * marks it as suggested when it comes from the IP or the marketplace default. Changing it never
 * changes the language.
 */
export function DeliveryCountrySelector({ className, compact }: { className?: string; compact?: boolean }) {
  const { context, setCountry } = useDelivery();
  const all = useCountries();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const offered = context?.countries ?? [];
    const base = offered.length ? all.filter((c) => offered.includes(c.code)) : all;
    const term = fold(q.trim());
    return term ? base.filter((c) => fold(c.name).includes(term) || c.code.toLowerCase() === term) : base;
  }, [all, context?.countries, q]);

  if (!context || !context.showSelector) return null;
  const current = context.deliveryCountry;
  const name = countryName(current) || current;
  const suggested = context.isApproximate;

  const pick = async (code: string) => {
    setOpen(false);
    setQ('');
    if (code !== current || suggested) await setCountry(code);
  };

  return (
    <Popover.Root open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQ(''); }}>
      <Popover.Trigger
        className={cn('flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-brand-50 data-[state=open]:bg-brand-50', className)}
        aria-label={t('Enviar a {c}. Cambiar país de entrega', { c: name })}
        data-delivery-country={current}
      >
        <MapPin className="size-4 shrink-0 text-brand-600" />
        {compact ? (
          <span className="text-sm font-semibold">{name}</span>
        ) : (
          <span className="leading-tight">
            <span className="block text-[11px] text-muted">{suggested ? t('Enviar a (sugerido)') : t('Enviar a')}</span>
            <span className="block max-w-[130px] truncate text-sm font-semibold">{name}</span>
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={8} className="z-50 w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          <div className="border-b border-line p-3">
            <p className="text-sm font-semibold">{t('Elige tu país de entrega')}</p>
            <p className="mt-0.5 text-xs text-muted">
              {suggested
                ? t('Lo sugerimos según tu conexión. La disponibilidad y el envío se confirman con tu dirección al pagar.')
                : t('La disponibilidad y el envío se confirman con tu dirección al pagar.')}
            </p>
            <a href="/ayuda#ubicacion" className="mt-1 inline-block text-[11px] font-semibold text-brand-700 hover:underline">{t('Cómo usamos tu ubicación')}</a>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && list[0]) {
                    e.preventDefault();
                    pick(list[0].code);
                  }
                }}
                placeholder={t('Buscar país')}
                aria-label={t('Buscar país')}
                className="h-9 w-full rounded-lg border border-line pl-8 pr-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </div>
          </div>
          <ul role="listbox" aria-label={t('Países de entrega')} className="max-h-72 overflow-y-auto p-1">
            {list.map((c) => (
              <li key={c.code} role="option" aria-selected={c.code === current}>
                <button
                  type="button"
                  onClick={() => pick(c.code)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-50 focus:bg-brand-50 focus:outline-none"
                >
                  {c.name} {c.code === current && <Check className="size-4 text-brand-600" />}
                </button>
              </li>
            ))}
            {!list.length && <li className="px-3 py-4 text-center text-sm text-muted">{t('No encontramos ese país.')}</li>}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
