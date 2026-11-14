'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, put } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, PageLoader } from '@/components/ui/misc';
import { t } from '@/lib/i18n';

type Opt = { value?: string; label: string; labelEn?: string };
type Attr = {
  id: string; code: string; name: string; dataType: string; unit?: string | null; required: boolean; inherited: boolean; fromCategory: string | null;
  input: 'select' | 'combobox' | 'text' | 'number' | 'boolean'; options: Opt[]; usedValues: number;
};

const MODE_LABEL: Record<string, string> = { select: 'Lista cerrada', combobox: 'Lista abierta', text: 'Texto libre', number: 'Número', boolean: 'Sí / No' };

/** Admin: input mode and options of the attributes a category uses (options are shared by every category). */
export function CategoryAttributesDialog({ category, canEdit, onClose }: { category: { id: string; name: string }; canEdit: boolean; onClose: () => void }) {
  const q = useQuery<Attr[]>({ queryKey: ['admin-category-attrs', category.id], queryFn: () => get(`/admin/categories/${category.id}/attributes`) });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('Atributos de {c}', { c: category.name })} size="lg"
      description={t('Define cómo eligen los vendedores cada valor. Las opciones se comparten con todas las categorías que usan el atributo.')}>
      {q.isLoading ? <PageLoader /> : !q.data?.length ? (
        <p className="py-6 text-center text-sm text-muted">{t('Esta categoría no tiene atributos.')}</p>
      ) : (
        <div className="max-h-[60vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {q.data.map((a) => (
            <div key={a.id}>
              <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface">
                {open === a.id ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
                <span className="flex-1">
                  <b className="text-sm">{a.name}{a.unit ? ` (${a.unit})` : ''}</b>
                  {a.inherited && <span className="ml-2 text-xs text-muted">{t('heredado de {c}', { c: a.fromCategory ?? '' })}</span>}
                </span>
                {a.required && <Badge tone="amber">{t('Obligatorio')}</Badge>}
                <Badge tone={a.input === 'select' ? 'violet' : a.input === 'combobox' ? 'blue' : 'gray'}>{t(MODE_LABEL[a.input])}</Badge>
                {a.options.length > 0 && <span className="w-20 text-right text-xs text-muted">{t('{n} opciones', { n: a.options.length })}</span>}
              </button>
              {open === a.id && <AttributeEditor attr={a} canEdit={canEdit} categoryId={category.id} />}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function AttributeEditor({ attr, canEdit, categoryId }: { attr: Attr; canEdit: boolean; categoryId: string }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState(attr.input);
  const [opts, setOpts] = useState<Opt[]>(attr.options.length ? attr.options : []);
  const [busy, setBusy] = useState(false);
  if (attr.dataType !== 'TEXT')
    return <p className="px-11 pb-4 text-sm text-muted">{attr.dataType === 'NUMBER' ? t('Los vendedores ingresan un número.') : t('Los vendedores eligen Sí o No.')}</p>;
  const save = async () => {
    setBusy(true);
    try {
      await put(`/admin/attributes/${attr.id}`, { input: mode, options: mode === 'text' ? [] : opts.filter((o) => o.label.trim()) });
      toast.success(t('Atributo actualizado.'));
      qc.invalidateQueries({ queryKey: ['admin-category-attrs', categoryId] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const setOpt = (i: number, k: 'label' | 'labelEn', v: string) => setOpts(opts.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
  return (
    <div className="space-y-3 bg-surface/50 px-11 pb-5 pt-1">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={mode} onChange={(e) => setMode(e.target.value as Attr['input'])} disabled={!canEdit} className="w-80" aria-label={t('Tipo de campo')}>
          <option value="select">{t('Lista cerrada (solo opciones)')}</option>
          <option value="combobox">{t('Lista abierta (opciones o texto)')}</option>
          <option value="text">{t('Texto libre')}</option>
        </Select>
        <span className="text-xs text-muted">{t('Usado en {n} productos', { n: attr.usedValues })}</span>
      </div>
      {mode !== 'text' && (
        <>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-semibold text-muted"><span>{t('Opción (español)')}</span><span>{t('Opción (inglés)')}</span><span /></div>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {opts.map((o, i) => (
              <div key={o.value ?? `new-${i}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input value={o.label} onChange={(e) => setOpt(i, 'label', e.target.value)} disabled={!canEdit} maxLength={60} />
                <Input value={o.labelEn ?? ''} onChange={(e) => setOpt(i, 'labelEn', e.target.value)} disabled={!canEdit} maxLength={60} />
                <Button variant="ghost" size="icon" onClick={() => setOpts(opts.filter((_, j) => j !== i))} disabled={!canEdit} aria-label={t('Eliminar')}><Trash2 /></Button>
              </div>
            ))}
          </div>
          {canEdit && <Button variant="secondary" size="sm" onClick={() => setOpts([...opts, { label: '', labelEn: '' }])}><Plus /> {t('Agregar opción')}</Button>}
        </>
      )}
      {canEdit && <div className="flex justify-end"><Button onClick={save} loading={busy}>{t('Guardar atributo')}</Button></div>}
    </div>
  );
}
