'use client';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode; suffix?: React.ReactNode }>(
  ({ className, icon, suffix, ...props }, ref) => (
    <div className="relative flex items-center">
      {icon && <span className="pointer-events-none absolute left-3 text-muted [&_svg]:size-4">{icon}</span>}
      <input
        ref={ref}
        className={cn(
          'h-10 w-full rounded-lg border border-line bg-white px-3 text-sm placeholder:text-muted/70 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-surface disabled:text-muted',
          icon && 'pl-9',
          suffix && 'pr-10',
          className,
        )}
        {...props}
      />
      {suffix && <span className="absolute right-3 text-sm text-muted">{suffix}</span>}
    </div>
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'min-h-24 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm placeholder:text-muted/70 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-10 w-full appearance-none rounded-lg border border-line bg-white bg-[length:16px] bg-[right_10px_center] bg-no-repeat px-3 pr-9 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100',
      "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b6785' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

export function Label({ children, required, hint, className }: { children: React.ReactNode; required?: boolean; hint?: React.ReactNode; className?: string }) {
  return (
    <label className={cn('mb-1.5 block text-sm font-semibold text-ink', className)}>
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
      {hint && <span className="ml-1 font-normal text-muted">{hint}</span>}
    </label>
  );
}

export function Field({ label, required, hint, error, children, className }: { label?: React.ReactNode; required?: boolean; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      {label && <Label required={required} hint={typeof hint === 'string' ? t(hint) : hint}>{typeof label === 'string' ? t(label) : label}</Label>}
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
