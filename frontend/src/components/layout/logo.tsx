import Link from 'next/link';
import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn('size-10 text-brand-600', className)} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" aria-hidden>
      <path d="M7 18h34l-3.5-9h-27z" />
      <path d="M7 18c0 3 2.5 5 5.7 5s5.6-2 5.6-5c0 3 2.5 5 5.7 5s5.6-2 5.6-5c0 3 2.5 5 5.7 5S41 21 41 18" />
      <path d="M10 24v16h28V24M20 40v-9h8v9" />
    </svg>
  );
}

export function Logo({ subtitle = 'Multivendedor', href = '/', invert = false, compact = false }: { subtitle?: string; href?: string; invert?: boolean; compact?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="RD Marketplace - inicio">
      <LogoMark className={invert ? 'text-white' : undefined} />
      {!compact && (
        <span className="leading-tight">
          <span className={cn('block text-lg font-extrabold tracking-tight', invert ? 'text-white' : 'text-ink')}>RD Marketplace</span>
          <span className={cn('block text-[13px] font-medium', invert ? 'text-brand-200' : 'text-muted')}>{subtitle}</span>
        </span>
      )}
    </Link>
  );
}
