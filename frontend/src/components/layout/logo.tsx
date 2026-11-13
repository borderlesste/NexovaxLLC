import Link from 'next/link';
import { cn } from '@/lib/utils';

/** NEXOVAX brand mark (official logo artwork). */
export function LogoMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/nexovax-mark.png"
      srcSet="/brand/nexovax-mark.png 1x, /brand/nexovax-mark@2x.png 2x"
      alt=""
      aria-hidden
      className={cn('size-10 shrink-0 object-contain', className)}
    />
  );
}

export function Logo({ subtitle = 'Marketplace', href = '/', invert = false, compact = false }: { subtitle?: string; href?: string; invert?: boolean; compact?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="NEXOVAX">
      <LogoMark />
      {!compact && (
        <span className="whitespace-nowrap leading-tight">
          <span className={cn('block text-lg font-black tracking-[0.08em]', invert ? 'text-white' : 'text-ink')}>
            NEXO<span className="text-accent-500">VAX</span>
          </span>
          <span className={cn('block text-[12px] font-medium', invert ? 'text-brand-200' : 'text-muted')}>{subtitle}</span>
        </span>
      )}
    </Link>
  );
}
