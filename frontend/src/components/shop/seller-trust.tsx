'use client';
import { BadgeCheck, Store, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * Public seller trust levels, from the API (`seller.trust`). Each badge says only what the platform checked:
 * registered (no check), payout verified (Finance verified its payout account), identity verified
 * (staff checked an official ID document or business registry). Never show more than this.
 */
export interface SellerTrust { registered?: boolean; payoutVerified: boolean; identityVerified: boolean }

export const trustText = () => ({
  registered: t('Vendedor registrado'),
  registeredHint: t('Tienda registrada en el marketplace. Este estado no implica ninguna verificación.'),
  payout: t('Cobro verificado'),
  payoutHint: t('Nuestro equipo verificó la cuenta donde esta tienda recibe sus pagos. No implica que se haya verificado su identidad.'),
  identity: t('Identidad verificada'),
  identityHint: t('Nuestro equipo verificó la identidad de esta tienda con un documento oficial de identidad o un registro oficial de empresas.'),
});

/** Check mark next to the store name: only for a verified identity. */
export function IdentityMark({ trust, className }: { trust?: SellerTrust | null; className?: string }) {
  if (!trust?.identityVerified) return null;
  const x = trustText();
  return <span title={x.identityHint} className="inline-flex shrink-0"><BadgeCheck className={cn('size-5 fill-brand-600 text-white', className)} aria-label={x.identity} /></span>;
}

/** One chip per level the store has reached ("Vendedor registrado" is always shown). */
export function SellerTrustBadges({ trust, className }: { trust?: SellerTrust | null; className?: string }) {
  const x = trustText();
  const chip = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset';
  return (
    <span className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className={cn(chip, 'bg-gray-100 text-gray-600 ring-gray-200')} title={x.registeredHint}><Store className="size-3" /> {x.registered}</span>
      {trust?.payoutVerified && <span className={cn(chip, 'bg-emerald-50 text-emerald-700 ring-emerald-200')} title={x.payoutHint}><Wallet className="size-3" /> {x.payout}</span>}
      {trust?.identityVerified && <span className={cn(chip, 'bg-brand-50 text-brand-700 ring-brand-200')} title={x.identityHint}><BadgeCheck className="size-3" /> {x.identity}</span>}
    </span>
  );
}

/** Long form for a store's "About" box: each level with what it means, including the ones not reached. */
export function SellerTrustList({ trust }: { trust?: SellerTrust | null }) {
  const x = trustText();
  const rows: [boolean, typeof Store, string, string][] = [
    [true, Store, x.registered, x.registeredHint],
    [!!trust?.payoutVerified, Wallet, x.payout, x.payoutHint],
    [!!trust?.identityVerified, BadgeCheck, x.identity, x.identityHint],
  ];
  return (
    <ul className="space-y-2 text-sm">
      {rows.map(([on, Icon, label, hint]) => (
        <li key={label} className={cn('flex gap-2', !on && 'opacity-60')}>
          <Icon className={cn('mt-0.5 size-4 shrink-0', on ? 'text-brand-600' : 'text-muted')} />
          <span><b className={on ? 'text-ink' : 'text-muted'}>{label}</b>{!on && <span className="text-muted"> · {t('Sin verificar')}</span>}<br /><span className="text-xs text-muted">{hint}</span></span>
        </li>
      ))}
    </ul>
  );
}
