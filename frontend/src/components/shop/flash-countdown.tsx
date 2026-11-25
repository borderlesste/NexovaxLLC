'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Countdown to the end of a store's flash deal (a real end: the regular price comes back then).
 * Renders nothing on the server (avoids a time mismatch) and refreshes the page when it reaches zero.
 */
export function FlashCountdown({ endsAt, compact, className }: { endsAt: string; compact?: boolean; className?: string }) {
  const router = useRouter();
  const end = Date.parse(endsAt);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = now === null ? null : Math.max(0, Math.floor((end - now) / 1000));
  useEffect(() => {
    if (left === 0) router.refresh();
  }, [left, router]);
  if (left === null || left === 0) return null;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const clock = `${d > 0 ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-md bg-red-600 font-bold tabular-nums text-white', compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2.5 py-1 text-sm', className)}
      role="timer"
      aria-label={t('Oferta relámpago, termina en {a}', { a: clock })}
      data-flash-countdown
    >
      <Zap className={compact ? 'size-3' : 'size-4'} fill="currentColor" /> {compact ? clock : <>{t('Termina en')} {clock}</>}
    </span>
  );
}
