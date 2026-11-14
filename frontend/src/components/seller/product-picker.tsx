'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { get } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';

/**
 * "All my products" or a chosen subset (coupons, affiliate program).
 * An empty selection with mode "all" means every product of the store.
 */
export function ProductPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [mode, setMode] = useState<'all' | 'some'>(value.length ? 'some' : 'all');
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['seller-products-picker', search],
    queryFn: () => get<any>(`/seller/products?status=ACTIVE&pageSize=100&search=${encodeURIComponent(search)}`),
    enabled: mode === 'some',
  });
  const toggle = (id: string, on: boolean) => onChange(on ? [...new Set([...value, id])] : value.filter((x) => x !== id));
  return (
    <div className="space-y-2" data-product-picker>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" checked={mode === 'all'} onChange={() => { setMode('all'); onChange([]); }} /> {t('Todos mis productos')}</label>
        <label className="flex items-center gap-2"><input type="radio" checked={mode === 'some'} onChange={() => setMode('some')} data-picker-some /> {t('Solo algunos productos')}</label>
      </div>
      {mode === 'some' && (
        <div className="rounded-xl border border-line">
          <div className="border-b border-line p-2"><Input icon={<Search />} placeholder={t('Buscar producto…')} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="max-h-56 space-y-1 overflow-y-auto p-2">
            {(q.data?.items ?? []).map((p: any) => (
              <Checkbox key={p.id} checked={value.includes(p.id)} onChange={(v) => toggle(p.id, v)} label={<span className="text-sm">{p.title}</span>} />
            ))}
            {q.data && !q.data.items.length && <p className="p-2 text-sm text-muted">{t('No hay productos publicados que coincidan.')}</p>}
          </div>
          <p className="border-t border-line px-3 py-2 text-xs text-muted">{t('{n} producto(s) seleccionado(s).', { n: value.length })}</p>
        </div>
      )}
    </div>
  );
}
