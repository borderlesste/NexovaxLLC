'use client';
import { forwardRef, useRef, useState } from 'react';
import { CHECKS, RULE_HINT, RULES, shiftMoney, type FieldRule } from '@/lib/field-rules';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  icon?: React.ReactNode;
  suffix?: React.ReactNode;
  /** Restricts what the field accepts (typing and pasting) to data of that kind. */
  rule?: FieldRule;
};

/** Sets a controlled input's value as if the user typed it (React's onChange fires). */
function setNativeValue(el: HTMLInputElement, value: string) {
  if (el.value === value) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, icon, suffix, rule, onChange, onBlur, onFocus, onPaste, ...props }, ref) => {
  const def = rule ? RULES[rule] : undefined;
  const [invalid, setInvalid] = useState(false);
  const check = rule ? CHECKS[rule] : undefined;
  const local = useRef<HTMLInputElement | null>(null);
  const setRef = (el: HTMLInputElement | null) => {
    local.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };
  const caretToEnd = (el: HTMLInputElement) => requestAnimationFrame(() => el.setSelectionRange?.(el.value.length, el.value.length));
  return (
    <div className="relative flex items-center">
      {icon && <span className="pointer-events-none absolute left-3 text-muted [&_svg]:size-4">{icon}</span>}
      <input
        ref={setRef}
        type={def?.type}
        inputMode={def?.inputMode}
        maxLength={def?.maxLength}
        autoComplete={def?.autoComplete}
        autoCapitalize={def?.autoCapitalize}
        data-rule={rule}
        aria-invalid={invalid || undefined}
        title={invalid && rule && RULE_HINT[rule] ? t(RULE_HINT[rule]!) : undefined}
        className={cn(
          'h-10 w-full rounded-lg border border-line bg-white px-3 text-sm placeholder:text-muted/70 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-surface disabled:text-muted',
          icon && 'pl-9',
          suffix && 'pr-10',
          invalid && 'border-red-400 focus:border-red-400 focus:ring-red-100',
          className,
        )}
        {...props}
        onFocus={(e) => {
          // a stored amount like "20" becomes "20.00" so new digits shift in from the right
          if (def?.shift && e.target.value && !e.target.value.includes('.')) setNativeValue(e.target, Number(e.target.value).toFixed(2));
          if (def?.shift) caretToEnd(e.target);
          onFocus?.(e);
        }}
        onPaste={(e) => {
          if (def?.shift) {
            // pasted amounts are read literally: "20" → 20.00, "19,99" → 19.99
            const n = parseFloat(e.clipboardData.getData('text').replace(',', '.').replace(/[^\d.]/g, ''));
            e.preventDefault();
            if (!isNaN(n)) setNativeValue(e.currentTarget, n.toFixed(2));
          }
          onPaste?.(e);
        }}
        onChange={(e) => {
          if (def) {
            const clean = def.shift ? shiftMoney(e.target.value) : def.filter(e.target.value);
            if (def.shift) caretToEnd(e.target);
            if (clean !== e.target.value) e.target.value = clean;
            if (invalid && (!check || !clean || check(clean))) setInvalid(false);
          }
          onChange?.(e);
        }}
        onBlur={(e) => {
          if (def?.format) setNativeValue(e.target, def.format(e.target.value));
          if (check) setInvalid(!!e.target.value.trim() && !check(e.target.value.trim()));
          onBlur?.(e);
        }}
      />
      {suffix && <span className="absolute right-3 text-sm text-muted">{suffix}</span>}
      {invalid && rule && RULE_HINT[rule] && <span role="alert" className="absolute -bottom-4 left-0 text-[11px] leading-none text-red-600">{t(RULE_HINT[rule]!)}</span>}
    </div>
  );
});
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
