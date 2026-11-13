'use client';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { getIntlLocale, t } from '@/lib/i18n';

const tx = (v: React.ReactNode) => (typeof v === 'string' ? t(v) : v);


export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-brand-600', className)} />;
}

export function PageLoader() {
  return (
    <div className="grid min-h-[40vh] place-items-center">
      <Spinner className="size-8" />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-brand-50/70', className)} />;
}

export function Empty({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-500 [&_svg]:size-7">{icon ?? <Inbox />}</div>
      <p className="text-base font-bold">{t(title)}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{t(description)}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {t(message)}
      {onRetry && (
        <button onClick={onRetry} className="ml-2 font-semibold underline">
          {t('Reintentar')}
        </button>
      )}
    </div>
  );
}

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...p }: TabsPrimitive.TabsListProps) {
  return <TabsPrimitive.List className={cn('flex gap-1 overflow-x-auto border-b border-line scrollbar-thin', className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: TabsPrimitive.TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-sm font-semibold text-muted transition hover:text-ink data-[state=active]:border-brand-600 data-[state=active]:text-brand-700',
        className,
      )}
      {...p}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

/** Simple pill tabs driven by state (used for filters). */
export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto border-b border-line scrollbar-thin', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            '-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition',
            value === o.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {tx(o.label)}
          {o.count !== undefined && <span className={cn('rounded-full px-2 py-0.5 text-[11px]', value === o.value ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-muted')}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pills<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition', value === o.value ? 'bg-brand-50 text-brand-700' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: { open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-2xl',
            { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <DialogPrimitive.Title className="text-lg font-bold">{tx(title)}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="mt-0.5 text-sm text-muted">{tx(description)}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded-lg p-1 text-muted hover:bg-surface" aria-label={t('Cerrar')}>
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Switch({ checked, onCheckedChange, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className="relative h-6 w-11 shrink-0 rounded-full bg-gray-300 transition data-[state=checked]:bg-brand-600 disabled:opacity-50"
    >
      <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition data-[state=checked]:translate-x-[22px]" />
    </SwitchPrimitive.Root>
  );
}

export function Pagination({ page, pageSize, total, onPage, label = 'resultados' }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; label?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const nums: (number | '…')[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm text-muted">
      <span>
        {t('Mostrando')} <b className="text-ink">{from}–{to}</b> {t('de')} <b className="text-ink">{total.toLocaleString(getIntlLocale())}</b> {t(label)}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft /> {t('Anterior')}
          </Button>
          {nums.map((n, i) =>
            n === '…' ? (
              <span key={i} className="px-1">…</span>
            ) : (
              <button key={i} onClick={() => onPage(n)} className={cn('size-8 rounded-lg border text-xs font-semibold', n === page ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line bg-white text-ink hover:bg-surface')}>
                {n}
              </button>
            ),
          )}
          <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            {t('Siguiente')} <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; className?: string }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded border-line accent-brand-600" />
      {tx(label)}
    </label>
  );
}

export function Avatar({ name, src, size = 36, className }: { name?: string | null; src?: string | null; size?: number; className?: string }) {
  const ini = (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
  if (src) return <img src={src} alt={name ?? ''} style={{ width: size, height: size }} className={cn('rounded-full object-cover', className)} />;
  return (
    <div style={{ width: size, height: size, fontSize: size * 0.36 }} className={cn('grid shrink-0 place-items-center rounded-full bg-brand-100 font-bold text-brand-700', className)}>
      {ini}
    </div>
  );
}
