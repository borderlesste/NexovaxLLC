'use client';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...p}>
      {children}
    </div>
  );
}

const tx = (v: React.ReactNode) => (typeof v === 'string' ? t(v) : v);

export function CardHeader({ title, subtitle, icon, action, className }: { title: React.ReactNode; subtitle?: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="flex items-start gap-3">
        {icon && <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 [&_svg]:size-5">{icon}</div>}
        <div>
          <h3 className="text-base font-bold text-ink">{tx(title)}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{tx(subtitle)}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, icon, change, hint, tone = 'brand' }: { label: string; value: React.ReactNode; icon?: React.ReactNode; change?: number | null; hint?: string; tone?: 'brand' | 'amber' | 'green' | 'red' }) {
  const toneCls = { brand: 'bg-brand-50 text-brand-600', amber: 'bg-amber-50 text-amber-600', green: 'bg-emerald-50 text-emerald-600', red: 'bg-red-50 text-red-600' }[tone];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted">{t(label)}</p>
        {icon && <div className={cn('grid size-10 place-items-center rounded-xl [&_svg]:size-5', toneCls)}>{icon}</div>}
      </div>
      <p className="mt-2 text-2xl font-extrabold tracking-tight text-ink sm:text-[28px]">{value}</p>
      {(change !== undefined || hint) && (
        <p className="mt-1 text-xs text-muted">
          {change !== undefined && change !== null && (
            <span className={cn('mr-1 font-semibold', change >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {change > 0 ? '+' : ''}
              {change.toFixed(1)} %
            </span>
          )}
          {hint ? t(hint) : null}
        </p>
      )}
    </Card>
  );
}
