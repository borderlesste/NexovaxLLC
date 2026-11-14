'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check, FileText, Globe, ImageIcon, Info, Layers, Link2, Plus, Save, SlidersHorizontal, Star, Tag, Trash2, Truck, UploadCloud, Wand2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, post, put, upload } from '@/lib/api';
import { cn, money, currencySymbol } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { getLocale, t } from '@/lib/i18n';
import { ShippingDimensions } from '@/components/seller/shipping-dimensions';

interface Opt { name: string; values: { label: string; swatch?: string | null }[] }
interface Var { id?: string; key: string; optionValues: Record<string, string>; sku: string; price: string; compareAtPrice: string; stock: string; active: boolean }

const COLOR_SWATCH: Record<string, string> = { negro: '#111111', blanco: '#ffffff', azul: '#2563eb', rojo: '#dc2626', verde: '#16a34a', gris: '#9ca3af', morado: '#6d28d9', rosado: '#ec4899', amarillo: '#facc15', naranja: '#f97316', marrón: '#7c4a1d', beige: '#e7d9c4' };

function combos(options: Opt[]): Record<string, string>[] {
  const valid = options.filter((o) => o.name.trim() && o.values.length);
  if (!valid.length) return [{}];
  return valid.reduce<Record<string, string>[]>((acc, o) => acc.flatMap((a) => o.values.map((v) => ({ ...a, [o.name]: v.label }))), [{}]);
}
const keyOf = (ov: Record<string, string>) => Object.entries(ov).sort().map(([k, v]) => `${k}=${v}`).join('|') || 'default';
const skuPart = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);

export function ProductEditor({ productId }: { productId?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ['seller-product', productId], queryFn: () => get(`/seller/products/${productId}`), enabled: !!productId });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get('/categories'), staleTime: 300_000 });
  const [loaded, setLoaded] = useState(!productId);
  const [f, setF] = useState({ title: '', parentCategoryId: '', categoryId: '', brandName: '', shortDescription: '', description: '', slug: '', metaTitle: '', metaDescription: '' });
  const [options, setOptions] = useState<Opt[]>([]);
  const [variants, setVariants] = useState<Var[]>([{ key: 'default', optionValues: {}, sku: '', price: '', compareAtPrice: '', stock: '0', active: true }]);
  const [ship, setShip] = useState({ weightKg: '', lengthCm: '', widthCm: '', heightCm: '' });
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<null | 'draft' | 'submit'>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const product = existing.data;

  // hydrate
  useEffect(() => {
    if (!product || !cats.data || loaded) return;
    const parent = cats.data.find((c: any) => c.id === product.categoryId || c.children.some((k: any) => k.id === product.categoryId));
    setF({
      title: product.title, parentCategoryId: parent?.id ?? '', categoryId: product.categoryId, brandName: product.brandName ?? '', shortDescription: product.shortDescription ?? '',
      description: product.description ?? '', slug: product.seo.slug ?? '', metaTitle: product.seo.metaTitle ?? '', metaDescription: product.seo.metaDescription ?? '',
    });
    setOptions(product.options.map((o: any) => ({ name: o.name, values: o.values.map((v: any) => ({ label: v.label, swatch: v.swatch })) })));
    setVariants(product.variants.map((v: any) => ({
      id: v.id, key: keyOf(v.optionValues), optionValues: v.optionValues, sku: v.sku, price: v.price ? String(Number(v.price)) : '', compareAtPrice: v.compareAtPrice ? String(Number(v.compareAtPrice)) : '', stock: String(v.stock), active: true,
    })));
    const v0 = product.variants[0];
    if (v0) setShip({ weightKg: v0.weightKg ? String(Number(v0.weightKg)) : '', lengthCm: v0.lengthCm ? String(Number(v0.lengthCm)) : '', widthCm: v0.widthCm ? String(Number(v0.widthCm)) : '', heightCm: v0.heightCm ? String(Number(v0.heightCm)) : '' });
    setAttrs(Object.fromEntries(product.attributes.map((a: any) => [a.definition_id, a.value])));
    setLoaded(true);
  }, [product, cats.data, loaded]);

  const parent = cats.data?.find((c: any) => c.id === f.parentCategoryId);
  const effectiveCategory = f.categoryId || f.parentCategoryId;
  const attrDefs = useQuery({ queryKey: ['attr-defs', effectiveCategory], queryFn: () => get(`/seller/categories/${effectiveCategory}/attributes`), enabled: !!effectiveCategory });
  const templates = useQuery({ queryKey: ['variant-templates', effectiveCategory], queryFn: () => get(`/seller/categories/${effectiveCategory}/variant-templates`), enabled: !!effectiveCategory });

  // regenerate variant rows from options, preserving data
  const regenerate = (opts: Opt[]) => {
    const all = combos(opts);
    const base = f.title ? skuPart(f.title) + '-' + String(Math.floor(Math.random() * 900) + 100) : 'SKU';
    setVariants((prev) => {
      const byKey = new Map(prev.map((v) => [v.key, v]));
      const first = prev[0];
      return all.map((ov) => {
        const k = keyOf(ov);
        const ex = byKey.get(k);
        if (ex) return ex;
        const suffix = Object.values(ov).map(skuPart).join('-');
        return { key: k, optionValues: ov, sku: `${first?.sku?.split('-').slice(0, 2).join('-') || base}${suffix ? '-' + suffix : ''}`, price: first?.price ?? '', compareAtPrice: first?.compareAtPrice ?? '', stock: '0', active: true };
      });
    });
  };
  const setOpts = (o: Opt[]) => {
    setOptions(o);
    regenerate(o);
  };
  const [newValue, setNewValue] = useState<Record<number, string>>({});

  const payload = (action: 'SAVE_DRAFT' | 'SUBMIT') => ({
    title: f.title,
    categoryId: effectiveCategory,
    brandName: f.brandName || null,
    shortDescription: f.shortDescription || null,
    description: f.description,
    options: options.filter((o) => o.name.trim() && o.values.length),
    variants: variants.filter((v) => v.active).map((v) => ({
      id: v.id, sku: v.sku, optionValues: v.optionValues, price: Number(v.price), compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : null, stock: Number(v.stock || 0),
      weightKg: ship.weightKg ? Number(ship.weightKg) : null, lengthCm: ship.lengthCm ? Number(ship.lengthCm) : null, widthCm: ship.widthCm ? Number(ship.widthCm) : null, heightCm: ship.heightCm ? Number(ship.heightCm) : null,
    })),
    attributes: Object.entries(attrs).filter(([id, v]) => v?.toString().trim() && (!attrDefs.data || attrDefs.data.some((d: any) => d.id === id))).map(([definitionId, value]) => ({ definitionId, value: String(value) })),
    seo: { slug: f.slug || undefined, metaTitle: f.metaTitle || undefined, metaDescription: f.metaDescription || undefined },
    action,
  });

  const save = async (action: 'SAVE_DRAFT' | 'SUBMIT') => {
    if (!f.title.trim() || !effectiveCategory || f.description.trim().length < 10) return toast.error(t('Completa nombre, categoría y una descripción (mínimo 10 caracteres).'));
    if (variants.some((v) => v.active && (!v.sku.trim() || !(Number(v.price) > 0)))) return toast.error(t('Cada variante necesita SKU y precio mayor que cero.'));
    if (![ship.weightKg, ship.lengthCm, ship.widthCm, ship.heightCm].every((x) => Number(x) > 0)) return toast.error(t('Indica el peso y las dimensiones del paquete (sección Envío y dimensiones).'));
    setSaving(action === 'SUBMIT' ? 'submit' : 'draft');
    try {
      const r = productId ? await put(`/seller/products/${productId}`, payload(action)) : await post('/seller/products', payload(action));
      qc.invalidateQueries({ queryKey: ['seller-products'] });
      qc.setQueryData(['seller-product', r.id], r);
      toast.success(action === 'SUBMIT' ? (r.status === 'ACTIVE' ? 'Producto publicado.' : t('Producto enviado a revisión.')) : 'Borrador guardado.');
      if (!productId) router.replace(`/vendedor/productos/${r.id}/editar`);
      else existing.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!productId) return toast.info(t('Guarda el borrador primero para poder subir imágenes.'));
    const form = new FormData();
    Array.from(files).forEach((file) => form.append('files', file));
    setUploading(true);
    try {
      const r = await upload(`/seller/products/${productId}/media`, form);
      qc.setQueryData(['seller-product', productId], r);
      toast.success(t('Imágenes subidas.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const mediaAction = async (mediaId: string, kind: 'primary' | 'delete') => {
    try {
      const r = kind === 'primary' ? await post(`/seller/products/${productId}/media/${mediaId}/primary`) : await del(`/seller/products/${productId}/media/${mediaId}`);
      qc.setQueryData(['seller-product', productId], r);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const activeCount = variants.filter((v) => v.active).length;
  const media = (existing.data ?? product)?.media ?? [];
  const single = !options.some((o) => o.name.trim() && o.values.length);

  if (productId && !loaded) return <div className="grid min-h-[50vh] place-items-center text-muted">{t('Cargando producto…')}</div>;

  return (
    <>
      <PageHeader crumbs={[{ label: t('Productos'), href: '/vendedor/productos' }, { label: productId ? t('Editar producto') : t('Crear producto') }]}
        title={productId ? t('Editar producto') : t('Crear producto')}
        description={t('Completa la información, configura sus variantes y publícalo.')}
        actions={<>
          {product && <StatusBadge status={product.status} className="self-center" />}
          <Button variant="secondary" onClick={() => save('SAVE_DRAFT')} loading={saving === 'draft'}><Save /> {t('Guardar borrador')}</Button>
          <Button onClick={() => save('SUBMIT')} loading={saving === 'submit'}><Check /> {t('Publicar')}</Button>
        </>} />
      {product?.lastReview?.status && ['REJECTED', 'CHANGES_REQUESTED'].includes(product.lastReview.status) && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><b>{t('Moderación:')}</b> {product.lastReview.decision_reason}</div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader icon={<Info />} title={t('Información básica')} subtitle={t('Datos principales del producto.')} />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <Field label={t('Nombre del producto')} required className="sm:col-span-3"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t('Ej. Zapatillas deportivas running')} maxLength={140} /></Field>
              <Field label={t('Categoría')} required>
                <Select value={f.parentCategoryId} onChange={(e) => setF({ ...f, parentCategoryId: e.target.value, categoryId: '' })}>
                  <option value="">{t('Selecciona una categoría')}</option>{cats.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label={t('Subcategoría')} required={!!parent?.children.length}>
                <Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} disabled={!parent?.children.length}>
                  <option value="">{t('Selecciona una subcategoría')}</option>{parent?.children.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label={t('Marca')}><Input rule="businessName" value={f.brandName} onChange={(e) => setF({ ...f, brandName: e.target.value })} placeholder={t('Ej. Nike, Adidas, Xiaomi')} /></Field>
              <Field label={t('Descripción corta')} className="sm:col-span-3"><Input value={f.shortDescription} onChange={(e) => setF({ ...f, shortDescription: e.target.value })} placeholder={t('Resumen que aparece bajo el título')} maxLength={300} /></Field>
              <Field label={t('Descripción del producto')} required className="sm:col-span-3">
                <Textarea rows={6} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={5000} placeholder={t('Describe tu producto de forma clara y detallada. Incluye sus características, beneficios, materiales, uso recomendado, etc.')} />
                <p className="mt-1 text-right text-xs text-muted">{f.description.length} {t('/ 5,000 caracteres')}</p>
              </Field>
            </div>
          </Card>

          {attrDefs.data?.length ? (
            <Card>
              <CardHeader icon={<SlidersHorizontal />} title={t('Atributos')} subtitle={t('Atributos asociados a la categoría seleccionada.')} />
              <AttributeFields defs={attrDefs.data} values={attrs} onChange={(id, v) => setAttrs((cur) => ({ ...cur, [id]: v }))} />
            </Card>
          ) : null}

          <Card>
            <CardHeader icon={<Tag />} title={t('Variantes')} subtitle={t('Configura las opciones del producto (talla, color, etc.) para generar combinaciones con SKU.')} />
            <div className="space-y-4 p-5">
              {options.map((o, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                  <Input value={o.name} placeholder={t('Ej. Talla')} onChange={(e) => { const n = [...options]; n[i] = { ...o, name: e.target.value }; setOpts(n); }} />
                  <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1">
                    {o.values.map((v, j) => (
                      <span key={j} className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-800">
                        {v.swatch && <span className="size-3 rounded-full border border-black/10" style={{ background: v.swatch }} />} {v.label}
                        <button onClick={() => { const n = [...options]; n[i] = { ...o, values: o.values.filter((_, k) => k !== j) }; setOpts(n); }} aria-label={t('Quitar')}><X className="size-3" /></button>
                      </span>
                    ))}
                    <input className="min-w-24 flex-1 text-sm outline-none" placeholder={t('Escribe y presiona Enter')} value={newValue[i] ?? ''}
                      onChange={(e) => setNewValue({ ...newValue, [i]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ',') return;
                        e.preventDefault();
                        const label = (newValue[i] ?? '').trim();
                        if (!label || o.values.some((v) => v.label.toLowerCase() === label.toLowerCase())) return;
                        const swatch = /color/i.test(o.name) ? COLOR_SWATCH[label.toLowerCase()] ?? null : null;
                        const n = [...options];
                        n[i] = { ...o, values: [...o.values, { label, swatch }] };
                        setOpts(n);
                        setNewValue({ ...newValue, [i]: '' });
                      }} />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setOpts(options.filter((_, k) => k !== i))} aria-label={t('Eliminar opción')}><Trash2 /></Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                {options.length < 3 && <Button variant="outline" size="sm" onClick={() => setOptions([...options, { name: '', values: [] }])}><Plus /> {t('Agregar opción de variante')}</Button>}
                {templates.data?.map((lbl: any) => (
                  <Button key={lbl.code} variant="soft" size="sm" onClick={() => !options.some((o) => o.name === lbl.name) && setOpts([...options, { name: lbl.name, values: (lbl.values ?? []).map((v: any) => ({ label: typeof v === 'string' ? v : v.label ?? v.value, swatch: v.swatch ?? null })) }])}>
                    <Wand2 /> {t('Usar plantilla “')}{lbl.name}”
                  </Button>
                ))}
              </div>
              {!single && <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800"><b>{t('Combinaciones generadas:')}</b> {activeCount} {t('variantes.')}</p>}
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-3 py-2">{t('Variante')}</th><th>{t('SKU')}</th><th>{`${t('Precio')} (${currencySymbol()})`}</th><th>{t('Precio anterior')}</th><th>{t('Stock')}</th><th>{t('Activa')}</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {variants.map((v, i) => (
                      <tr key={v.key} className={cn(!v.active && 'opacity-50')}>
                        <td className="px-3 py-2 font-semibold">{Object.values(v.optionValues).join(' / ') || t('Única')}</td>
                        <td className="py-2 pr-2"><Input rule="sku" className="h-9" value={v.sku} onChange={(e) => setVariants(variants.map((x, k) => k === i ? { ...x, sku: e.target.value.toUpperCase() } : x))} /></td>
                        <td className="py-2 pr-2"><Input rule="money" className="h-9" value={v.price} onChange={(e) => setVariants(variants.map((x, k) => k === i ? { ...x, price: e.target.value.replace(/[^\d.]/g, '') } : x))} placeholder="0.00" /></td>
                        <td className="py-2 pr-2"><Input rule="money" className="h-9" value={v.compareAtPrice} onChange={(e) => setVariants(variants.map((x, k) => k === i ? { ...x, compareAtPrice: e.target.value.replace(/[^\d.]/g, '') } : x))} placeholder={t('Opcional')} /></td>
                        <td className="py-2 pr-2"><Input rule="integer" className="h-9 w-24" inputMode="numeric" value={v.stock} onChange={(e) => setVariants(variants.map((x, k) => k === i ? { ...x, stock: e.target.value.replace(/\D/g, '') } : x))} /></td>
                        <td className="py-2 pr-3"><input type="checkbox" checked={v.active} onChange={(e) => setVariants(variants.map((x, k) => k === i ? { ...x, active: e.target.checked } : x))} className="size-4 accent-brand-600" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {variants.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => setVariants(variants.map((v) => ({ ...v, price: variants[0].price, compareAtPrice: variants[0].compareAtPrice })))}>
                  {t('Aplicar el precio de la primera variante a todas')}
                </Button>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader icon={<ImageIcon />} title={t('Medios del producto')} subtitle={t('Imagen principal y galería (máx. 8).')} />
            <div className="p-5">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden onChange={(e) => onFiles(e.target.files)} />
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="col-span-2 row-span-2 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/40 p-4 text-center text-sm hover:bg-brand-50"
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}>
                  <UploadCloud className="size-9 text-brand-600" />
                  <b className="mt-2">{uploading ? 'Subiendo…' : t('Sube las imágenes')}</b>
                  <span className="text-xs text-muted">{t('Arrastra y suelta o selecciona. JPG, PNG o WebP. Máx. 8 MB.')}</span>
                  {!productId && <span className="mt-1 text-xs font-semibold text-amber-700">{t('Guarda el borrador para habilitar.')}</span>}
                </button>
                {media.map((m: any) => (
                  <div key={m.id} className={cn('group relative overflow-hidden rounded-xl border-2 bg-surface', m.isPrimary ? 'border-brand-600' : 'border-line')}>
                    <img src={m.url} alt="" className="aspect-square w-full object-contain" />
                    <div className="absolute inset-x-0 bottom-0 flex justify-between bg-white/90 p-1 opacity-0 transition group-hover:opacity-100">
                      <button onClick={() => mediaAction(m.id, 'primary')} title={t('Principal')} aria-label={t('Principal')}><Star className={cn('size-4', m.isPrimary && 'fill-amber-400 text-amber-400')} /></button>
                      <button onClick={() => mediaAction(m.id, 'delete')} title={t('Eliminar')} aria-label={t('Eliminar')}><Trash2 className="size-4 text-red-600" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Truck />} title={t('Envío y dimensiones')} subtitle={t('Información para el cálculo y la gestión del envío.')} />
            <ShippingDimensions value={ship} onChange={setShip} />
          </Card>

          <Card>
            <CardHeader icon={<Layers />} title={t('Organización y estado')} subtitle={t('Visibilidad y estado del producto en el marketplace.')} />
            <div className="space-y-3 p-5 text-sm">
              <div className="flex items-center justify-between"><span>{t('Estado actual')}</span>{product ? <StatusBadge status={product.status} /> : <StatusBadge status="DRAFT" />}</div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-2"><Globe className="size-4 text-muted" /> {t('Visibilidad')}</span><b>{t('Pública al aprobarse')}</b></div>
              <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">{t('“Publicar” envía el producto a moderación. Una vez aprobado aparecerá en el catálogo. Los cambios de precio y stock se aplican de inmediato.')}</p>
              {variants[0]?.price && <p className="text-xs text-muted">{t('Precio desde:')}{' '}<b className="text-ink">{money(Math.min(...variants.filter((v) => v.active && v.price).map((v) => Number(v.price))))}</b></p>}
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Link2 />} title={t('SEO / Enlace')} subtitle={t('Mejora el posicionamiento y el enlace del producto.')} />
            <div className="grid gap-4 p-5">
              <Field label={t('Slug / URL amigable')}><Input rule="slug" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder={t('zapatillas-running')} /><p className="mt-1 text-xs text-muted">{t('/producto/')}{f.slug || '…'}</p></Field>
              <Field label={t('Meta título')}><Input value={f.metaTitle} onChange={(e) => setF({ ...f, metaTitle: e.target.value })} maxLength={60} /><p className="mt-1 text-right text-xs text-muted">{f.metaTitle.length} / 60</p></Field>
              <Field label={t('Meta descripción')}><Textarea rows={2} value={f.metaDescription} onChange={(e) => setF({ ...f, metaDescription: e.target.value })} maxLength={160} /><p className="mt-1 text-right text-xs text-muted">{f.metaDescription.length} / 160</p></Field>
            </div>
          </Card>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => save('SAVE_DRAFT')} loading={saving === 'draft'}><FileText /> {t('Guardar borrador')}</Button>
        <Button onClick={() => save('SUBMIT')} loading={saving === 'submit'}><Check /> {t('Publicar')}</Button>
      </div>
    </>
  );
}

export default ProductEditor;

type AttrOption = { value: string; label: string; labelEn?: string };
type AttrDef = { id: string; name: string; unit?: string | null; required: boolean; dataType: string; input: 'select' | 'combobox' | 'text' | 'number' | 'boolean'; options: AttrOption[]; suggestions: string[] };
const VISIBLE_ATTRS = 9;

/**
 * Category attributes: closed lists render as a select, open lists as an input
 * with the catalog options plus values other sellers already used, and numbers /
 * yes-no by type. Values the API rejects come back as field errors.
 */
function AttributeFields({ defs, values, onChange }: { defs: AttrDef[]; values: Record<string, string>; onChange: (id: string, v: string) => void }) {
  const [all, setAll] = useState(false);
  const en = getLocale() === 'en';
  const label = (o: AttrOption) => (en ? o.labelEn || o.label : o.label);
  // Keep every attribute that already has a value visible.
  const shown = all ? defs : defs.filter((d, i) => i < VISIBLE_ATTRS || d.required || values[d.id]);
  return (
    <div className="p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        {shown.map((a) => {
          const v = values[a.id] ?? '';
          const field = `${a.name}${a.unit ? ` (${a.unit})` : ''}`;
          let control: React.ReactNode;
          if (a.input === 'select') {
            const known = !v || a.options.some((o) => o.value === v);
            control = (
              <Select value={v} onChange={(e) => onChange(a.id, e.target.value)} data-attr={a.id}>
                <option value="">{t('Selecciona')}</option>
                {!known && <option value={v}>{v}</option>}
                {a.options.map((o) => <option key={o.value} value={o.value}>{label(o)}</option>)}
              </Select>
            );
          } else if (a.input === 'boolean') {
            control = (
              <Select value={v} onChange={(e) => onChange(a.id, e.target.value)} data-attr={a.id}>
                <option value="">—</option><option value="true">{t('Sí')}</option><option value="false">{t('No')}</option>
              </Select>
            );
          } else if (a.input === 'number') {
            control = <Input rule="decimal" value={v} onChange={(e) => onChange(a.id, e.target.value)} data-attr={a.id} />;
          } else {
            // open list: show the label of a stored option code; typed text is matched to an option by the API
            const opt = a.options.find((o) => o.value === v);
            const listId = `attr-${a.id}`;
            const choices = a.input === 'combobox' ? [...a.options.map(label), ...a.suggestions] : [];
            control = (
              <>
                <Input list={choices.length ? listId : undefined} value={opt ? label(opt) : v} maxLength={200} autoComplete="off" data-attr={a.id}
                  placeholder={choices.length ? t('Elige o escribe') : undefined} onChange={(e) => onChange(a.id, e.target.value)} />
                {choices.length > 0 && <datalist id={listId}>{[...new Set(choices)].map((c) => <option key={c} value={c} />)}</datalist>}
              </>
            );
          }
          return <Field key={a.id} label={field} required={a.required}>{control}</Field>;
        })}
      </div>
      {defs.length > shown.length || all ? (
        <button type="button" onClick={() => setAll((x) => !x)} className="mt-4 text-sm font-semibold text-brand-700 hover:underline">
          {all ? t('Mostrar menos atributos') : t('Mostrar todos los atributos ({n})', { n: defs.length })}
        </button>
      ) : null}
    </div>
  );
}
