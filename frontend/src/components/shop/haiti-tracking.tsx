import { cn } from '@/lib/utils';

/**
 * "Haiti Tracking by Nexovax" brand: emblem (map of Haiti + pin with the coat of arms, on transparent
 * background) and the wordmark as live text, so it stays readable on the dark banner. Brand name: never translated.
 */
export function HaitiTrackingMark({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)} aria-label="Haiti Tracking by Nexovax">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/haiti-tracking-emblem.webp"
        srcSet="/brand/haiti-tracking-emblem.webp 1x, /brand/haiti-tracking-emblem@2x.webp 2x"
        alt=""
        aria-hidden
        className={cn('shrink-0 object-contain', size === 'sm' ? 'h-9 w-[68px]' : 'h-14 w-[106px] sm:h-16 sm:w-[122px]')}
      />
      <span className="leading-none" aria-hidden>
        <span className={cn('block font-black tracking-tight text-white', size === 'sm' ? 'text-base' : 'text-xl sm:text-2xl')}>Haiti Tracking</span>
        <span className={cn('mt-1 flex items-center gap-1.5 font-bold text-white/85', size === 'sm' ? 'text-[10px]' : 'text-xs')}>
          <span className="h-0.5 w-4 rounded-full bg-[#d21034]" /> by Nexovax <span className="h-0.5 w-4 rounded-full bg-[#d21034]" />
        </span>
      </span>
    </span>
  );
}

/** Dark banner over the photo of the Haitian coast, with the Haiti Tracking mark. */
export function HaitiBanner({ className, children, size = 'md', priority = false }: { className?: string; children?: React.ReactNode; size?: 'sm' | 'md'; priority?: boolean }) {
  return (
    <div className={cn('relative isolate overflow-hidden rounded-xl bg-[#00113a] text-white', className)} data-haiti-banner>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/haiti-coast-800.webp"
        srcSet="/brand/haiti-coast-800.webp 800w, /brand/haiti-coast.webp 1536w"
        sizes={size === 'sm' ? '(min-width: 1024px) 700px, 100vw' : '(min-width: 1400px) 1400px, 100vw'}
        alt=""
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        className="absolute inset-0 -z-10 size-full object-cover object-[center_65%]"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#00113a]/95 via-[#00113a]/75 to-[#00113a]/15" />
      <div className={cn('flex flex-col gap-3', size === 'sm' ? 'p-3.5' : 'p-5 sm:p-7')}>
        <HaitiTrackingMark size={size} />
        {children}
      </div>
    </div>
  );
}
