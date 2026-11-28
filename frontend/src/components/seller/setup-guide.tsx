'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Rocket, X } from 'lucide-react';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type Step = { code: string; done: boolean };

const STEPS: Record<string, { title: string; hint: string; href: string }> = {
  LOGO: { title: 'Sube el logo de tu tienda', hint: 'Los clientes confían más en una tienda con imagen propia.', href: '/vendedor/configuracion' },
  ABOUT: { title: 'Describe tu tienda', hint: 'Cuenta en una frase qué vendes; aparece en tu página pública.', href: '/vendedor/configuracion' },
  SHIP_FROM: { title: 'Confirma tu dirección de despacho', hint: 'Desde ahí se calculan los envíos y las etiquetas.', href: '/vendedor/configuracion' },
  PRODUCT: { title: 'Crea tu primer producto', hint: 'Con fotos, precio e inventario. También puedes importarlos desde un archivo.', href: '/vendedor/productos/nuevo' },
  PUBLISHED: { title: 'Publica un producto en el catálogo', hint: 'Un producto publicado ya puede venderse.', href: '/vendedor/productos' },
  PAYOUT: { title: 'Agrega una cuenta de cobro', hint: 'Para recibir el dinero de tus ventas.', href: '/vendedor/metodos-cobro' },
};

const hiddenKey = (id: string) => `nx_setup_hidden_${id}`;

/** «First steps» card on the seller dashboard. Only the owner sees it, and it disappears once every step is done. */
export function SellerSetupGuide() {
  const { seller } = useAuth();
  const owner = !!seller?.isOwner;
  const q = useQuery({ queryKey: ['seller-setup-steps', seller?.id], queryFn: () => get<{ steps: Step[]; done: number; total: number }>('/seller/setup-steps'), enabled: owner });
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    if (!seller) return;
    try { setHidden(window.localStorage.getItem(hiddenKey(seller.id)) === '1'); } catch { setHidden(false); }
  }, [seller]);
  if (!owner || !q.data || hidden || q.data.done >= q.data.total) return null;
  const hide = () => {
    setHidden(true);
    try { window.localStorage.setItem(hiddenKey(seller!.id), '1'); } catch { /* storage blocked */ }
  };
  const next = q.data.steps.find((s) => !s.done)?.code;
  const pct = Math.round((q.data.done / q.data.total) * 100);
  return (
    <div className="card mb-5 p-5 sm:p-6" data-setup-guide>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><Rocket className="size-5" /></span>
          <div>
            <h2 className="text-lg font-bold">{t('Primeros pasos de tu tienda')}</h2>
            <p className="text-sm text-muted">{t('{a} de {b} listos. Completa estos pasos para empezar a vender.', { a: q.data.done, b: q.data.total })}</p>
          </div>
        </div>
        <button type="button" onClick={hide} className="rounded-lg p-2 text-muted hover:bg-surface" aria-label={t('Ocultar guía')} title={t('Ocultar guía')}><X className="size-4" /></button>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('Progreso')}>
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
        {q.data.steps.map((s) => {
          const m = STEPS[s.code];
          if (!m) return null;
          return (
            <li key={s.code} data-step={s.code} data-done={s.done ? '1' : '0'}>
              <Link href={m.href} className={cn('flex items-center gap-3 rounded-xl border px-4 py-3 transition hover:bg-surface', s.code === next ? 'border-brand-600' : 'border-line')}>
                <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border', s.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line')}>{s.done && <Check className="size-4" />}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm font-semibold', s.done && 'text-muted line-through')}>{t(m.title)}</span>
                  {!s.done && <span className="block text-xs text-muted">{t(m.hint)}</span>}
                </span>
                {!s.done && <ChevronRight className="size-4 shrink-0 text-muted" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
