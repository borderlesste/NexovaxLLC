import { cn } from '@/lib/utils';
import { statusInfo, type Tone } from '@/lib/status';

const tones: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-red-50 text-red-600 ring-red-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-brand-50 text-brand-700 ring-brand-200',
  gray: 'bg-gray-100 text-gray-600 ring-gray-200',
};

export function Badge({ tone = 'violet', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', tones[tone], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status, label, className }: { status?: string | null; label?: string; className?: string }) {
  const [text, tone] = statusInfo(status);
  return <Badge tone={tone} className={className}>{label ?? text}</Badge>;
}
