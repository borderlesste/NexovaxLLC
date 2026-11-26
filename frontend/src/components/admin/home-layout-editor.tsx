'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronDown, LayoutTemplate, RotateCcw } from 'lucide-react';
import { get } from '@/lib/api';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/misc';

export interface HomeSection {
  key: string;
  enabled: boolean;
  title: string; titleEn?: string; titleFr?: string; titleHt?: string;
  limit: number;
  days?: number;
  rows?: number;
  categories?: string[];
  minRating?: number;
  minDiscount?: number;
  maxHours?: number;
  maxPerSeller?: number;
  thresholds?: number[];
}
export interface HomeLayout { avoidRepeats: boolean; sections: HomeSection[] }

/** Name, default title and what each section shows (the API keeps the same keys in home-layout.ts). */
const META: Record<string, { name: string; desc: string; limit?: [string, number, number] }> = {
  categories: { name: 'Explora por categorías', desc: 'Accesos a las categorías principales.', limit: ['Categorías mostradas', 3, 19] },
  recommended: { name: 'Recomendado para ti', desc: 'Según lo que vio y guardó el visitante (con su consentimiento); si no, lo más popular.', limit: ['Productos', 4, 24] },
  flash_deals: { name: 'Ofertas relámpago', desc: 'Rebajas que cada tienda crea con su descuento, inicio y fin, con cuenta regresiva real. Aquí fijas las reglas; abajo puedes retirar ofertas.', limit: ['Productos', 2, 24] },
  best_sellers: { name: 'Más vendidos', desc: 'Lo más comprado en los últimos días (pedidos pagados, sin cancelados).', limit: ['Productos', 4, 24] },
  featured: { name: 'Productos destacados', desc: 'Los que el equipo destacó en Productos; mientras no haya, los más populares. Requiere «Producto destacado» activo en General.', limit: ['Productos', 4, 24] },
  new_arrivals: { name: 'Novedades', desc: 'Productos recién publicados.', limit: ['Productos', 4, 24] },
  recently_viewed: { name: 'Vistos recientemente', desc: 'Lo último que el visitante abrió en este navegador. Solo se guarda en su navegador y puede borrarlo.', limit: ['Productos', 4, 24] },
  deals: { name: 'Ofertas de la semana', desc: 'Productos con precio rebajado.', limit: ['Productos', 2, 24] },
  category_rows: { name: 'Lo mejor de cada categoría', desc: 'Una fila por categoría con «Ver todo». Usa {category} en el título para el nombre de la categoría.', limit: ['Productos por fila', 2, 12] },
  top_stores: { name: 'Tiendas destacadas', desc: 'Tiendas activas con productos, mejor valoradas primero.', limit: ['Tiendas', 2, 16] },
  preorders: { name: 'Próximamente', desc: 'Productos agotados con preorden abierta (reserva sin pago).', limit: ['Productos', 2, 24] },
  price_ranges: { name: 'Por rango de precio', desc: 'Pestañas «Menos de …» con productos de cada rango.', limit: ['Productos por rango', 2, 12] },
  seller_banner: { name: 'Banner para vendedores', desc: 'Invita a abrir una tienda.' },
  haiti_banner: { name: 'Banner Haiti Tracking', desc: 'Logo «Haiti Tracking by Nexovax» sobre la foto de la costa de Haití, con enlaces al catálogo y a la política de envíos.' },
  guarantees: { name: 'Garantías de compra', desc: 'Costos claros, protección al comprador, vendedores identificados y atención.' },
};
/** Sections whose title the visitor sees with a default when left empty. */
const DEFAULT_TITLE: Record<string, string> = {
  ...Object.fromEntries(Object.entries(META).map(([k, m]) => [k, m.name])),
  category_rows: 'Lo mejor en {category}',
  preorders: 'Próximamente',
  seller_banner: '¿Tienes una marca o tienda? Llega a compradores globales',
  guarantees: 'Tu compra, respaldada de principio a fin',
  haiti_banner: 'Compra en línea y sigue tu paquete hasta Haití',
};

function flatten(cs: any[], depth = 0): { slug: string; name: string; depth: number; count: number }[] {
  return cs.flatMap((c) => [{ slug: c.slug, name: c.name, depth, count: c.productCount }, ...flatten(c.children ?? [], depth + 1)]);
}

function SectionOptions({ s, set }: { s: HomeSection; set: (patch: Partial<HomeSection>) => void }) {
  const m = META[s.key];
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get<any[]>('/categories'), enabled: s.key === 'category_rows', staleTime: 300_000 });
  const [thr, setThr] = useState((s.thresholds ?? []).join(', '));
  const num = (v: string) => (v === '' ? 0 : Number(v.replace(/[^\d.]/g, '')));
  return (
    <div className="grid grid-cols-1 gap-4 border-t border-line bg-surface/40 p-4 sm:grid-cols-2">
      <Field label={t('Título (español)')} hint={t('Vacío: «{a}»', { a: t(DEFAULT_TITLE[s.key] ?? '') })}>
        <Input value={s.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label={t('Título (inglés)')}><Input value={s.titleEn ?? ''} maxLength={80} onChange={(e) => set({ titleEn: e.target.value })} /></Field>
      <Field label={t('Título (francés)')}><Input value={s.titleFr ?? ''} maxLength={80} onChange={(e) => set({ titleFr: e.target.value })} /></Field>
      <Field label={t('Título (criollo haitiano)')}><Input value={s.titleHt ?? ''} maxLength={80} onChange={(e) => set({ titleHt: e.target.value })} /></Field>
      {m?.limit && (
        <Field label={t(m.limit[0])} hint={t('Entre {a} y {b}', { a: m.limit[1], b: m.limit[2] })}>
          <Input inputMode="numeric" value={String(s.limit)} onChange={(e) => set({ limit: num(e.target.value) })} data-home-limit={s.key} />
        </Field>
      )}
      {s.key === 'best_sellers' && (
        <Field label={t('Días de ventas')} hint={t('Ventas de los últimos N días')}>
          <Input inputMode="numeric" value={String(s.days ?? 30)} onChange={(e) => set({ days: num(e.target.value) })} />
        </Field>
      )}
      {s.key === 'new_arrivals' && (
        <Field label={t('Publicados en los últimos (días)')} hint={t('0 = sin límite')}>
          <Input inputMode="numeric" value={String(s.days ?? 0)} onChange={(e) => set({ days: num(e.target.value) })} />
        </Field>
      )}
      {s.key === 'top_stores' && (
        <Field label={t('Valoración mínima')} hint={t('De 0 a 5; 0 = todas')}>
          <Input inputMode="decimal" value={String(s.minRating ?? 0)} onChange={(e) => set({ minRating: num(e.target.value) })} />
        </Field>
      )}
      {s.key === 'flash_deals' && (
        <>
          <Field label={t('Descuento mínimo')} hint={t('Lo mínimo que una tienda debe rebajar')}>
            <Input inputMode="numeric" suffix="%" value={String(s.minDiscount ?? 10)} onChange={(e) => set({ minDiscount: num(e.target.value) })} data-flash-min />
          </Field>
          <Field label={t('Duración máxima (horas)')} hint={t('De 1 a 336')}>
            <Input inputMode="numeric" value={String(s.maxHours ?? 72)} onChange={(e) => set({ maxHours: num(e.target.value) })} />
          </Field>
          <Field label={t('Ofertas por tienda a la vez')} hint={t('Activas o programadas')}>
            <Input inputMode="numeric" value={String(s.maxPerSeller ?? 10)} onChange={(e) => set({ maxPerSeller: num(e.target.value) })} />
          </Field>
          <p className="rounded-xl bg-surface p-3 text-xs text-muted sm:col-span-2">{t('Si desactivas esta sección, las tiendas no pueden crear ofertas nuevas; las que ya están en curso terminan a su hora.')}</p>
        </>
      )}
      {s.key === 'price_ranges' && (
        <Field label={t('Montos «Menos de»')} hint={t('Separados por comas, en la moneda del marketplace (hasta 6)')}>
          <Input
            value={thr}
            onChange={(e) => setThr(e.target.value)}
            onBlur={() => set({ thresholds: thr.split(/[,;\s]+/).map(Number).filter((n) => n > 0).slice(0, 6) })}
            data-price-thresholds
          />
        </Field>
      )}
      {s.key === 'category_rows' && (
        <>
          <Field label={t('Número de filas')} hint={t('De 1 a 12')}>
            <Input inputMode="numeric" value={String(s.rows ?? 4)} onChange={(e) => set({ rows: num(e.target.value) })} />
          </Field>
          <div className="sm:col-span-2">
            <p className="text-sm font-semibold">{t('Categorías')}</p>
            <p className="mb-2 text-xs text-muted">{t('Sin ninguna marcada se usan las categorías principales con más productos. Se muestran en el orden en que las marcas.')}</p>
            <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-xl border border-line bg-white p-2 sm:grid-cols-2">
              {flatten(cats.data ?? []).map((c) => {
                const i = (s.categories ?? []).indexOf(c.slug);
                return (
                  <label key={c.slug} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface" style={{ paddingLeft: 8 + c.depth * 14 }}>
                    <input
                      type="checkbox"
                      checked={i >= 0}
                      onChange={(e) => set({ categories: e.target.checked ? [...(s.categories ?? []), c.slug] : (s.categories ?? []).filter((x) => x !== c.slug) })}
                    />
                    <span className="flex-1 truncate">{t(c.name)}</span>
                    {i >= 0 && <Badge tone="violet">{i + 1}</Badge>}
                    <span className="text-xs text-muted">{c.count}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Admin → Configuración → Portada: order, enable and tune every home page section. */
export function HomeLayoutEditor({ value, onChange, defaults }: { value?: HomeLayout; onChange: (v: HomeLayout) => void; defaults?: HomeLayout }) {
  const v: HomeLayout = value ?? defaults ?? { avoidRepeats: true, sections: [] };
  const [open, setOpen] = useState<string | null>(null);
  const setSection = (key: string, patch: Partial<HomeSection>) => onChange({ ...v, sections: v.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= v.sections.length) return;
    const next = [...v.sections];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...v, sections: next });
  };
  const active = v.sections.filter((s) => s.enabled).length;
  return (
    <Card data-home-layout-editor>
      <CardHeader
        icon={<LayoutTemplate />}
        title={t('Secciones de la portada')}
        subtitle={t('Activa, ordena y ajusta cada sección de la página de inicio. Las secciones sin contenido se ocultan solas. Los cambios se ven en la portada en menos de un minuto.')}
        action={defaults && <Button variant="secondary" size="sm" onClick={() => onChange(structuredClone(defaults))}><RotateCcw /> {t('Restablecer')}</Button>}
      />
      <div className="space-y-3 p-5">
        <div className="flex items-start gap-3 rounded-xl border border-line p-4">
          <span className="flex-1">
            <b className="block text-sm">{t('Evitar productos repetidos')}</b>
            <span className="text-xs text-muted">{t('Si un producto ya aparece en una sección de arriba, se salta en las de abajo (mientras la sección siga teniendo suficientes productos).')}</span>
          </span>
          <Switch checked={v.avoidRepeats} onCheckedChange={(x) => onChange({ ...v, avoidRepeats: x })} />
        </div>
        <p className="text-xs text-muted">{t('{a} de {b} secciones activas. El encabezado y la barra de confianza siempre van arriba.', { a: active, b: v.sections.length })}</p>
        <ol className="space-y-2">
          {v.sections.map((s, i) => {
            const m = META[s.key] ?? { name: s.key, desc: '' };
            const isOpen = open === s.key;
            return (
              <li key={s.key} className={cn('overflow-hidden rounded-xl border border-line bg-white', !s.enabled && 'opacity-70')} data-home-section-row={s.key}>
                <div className="flex items-center gap-2 p-3">
                  <span className="flex flex-col">
                    <button type="button" className="rounded p-0.5 text-muted hover:bg-surface hover:text-ink disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('Subir')}><ArrowUp className="size-4" /></button>
                    <button type="button" className="rounded p-0.5 text-muted hover:bg-surface hover:text-ink disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === v.sections.length - 1} aria-label={t('Bajar')}><ArrowDown className="size-4" /></button>
                  </span>
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(isOpen ? null : s.key)}>
                    <b className="block truncate text-sm">{s.title || t(m.name)}</b>
                    <span className="line-clamp-1 text-xs text-muted">{t(m.desc)}</span>
                  </button>
                  <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-surface" onClick={() => setOpen(isOpen ? null : s.key)} aria-label={t('Opciones')}>
                    <ChevronDown className={cn('size-4 transition', isOpen && 'rotate-180')} />
                  </button>
                  <Switch checked={s.enabled} onCheckedChange={(x) => setSection(s.key, { enabled: x })} />
                </div>
                {isOpen && <SectionOptions s={s} set={(patch) => setSection(s.key, patch)} />}
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}
