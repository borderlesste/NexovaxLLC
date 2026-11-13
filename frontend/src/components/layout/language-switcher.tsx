'use client';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check, Globe } from 'lucide-react';
import { put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getLocale, switchLocale, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const OPTIONS: { code: Locale; label: string }[] = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
];

export function LanguageSwitcher({ className }: { className?: string }) {
  const { me } = useAuth();
  const current = getLocale();
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className={cn('flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-semibold hover:bg-brand-50', className)} aria-label="Idioma / Language">
        <Globe className="size-4" /> {current.toUpperCase()}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={8} className="z-50 w-40 rounded-xl border border-line bg-white p-1 shadow-xl">
          {OPTIONS.map((o) => (
            <Dropdown.Item
              key={o.code}
              className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm outline-none hover:bg-brand-50 focus:bg-brand-50"
              onSelect={() => o.code !== current && switchLocale(o.code, me ? (l) => put('/me/locale', { locale: l }) : undefined)}
            >
              {o.label} {o.code === current && <Check className="size-4 text-brand-600" />}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
