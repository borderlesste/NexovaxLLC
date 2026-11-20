'use client';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post, upload } from '@/lib/api';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox, Segmented } from '@/components/ui/misc';
import { t } from '@/lib/i18n';

type Row = Record<string, string | number | undefined> & { row: number };
type Item = { row: number; sku: string | null; title: string | null; action: 'CREATE' | 'UPDATE' | null; productKey: string | null; variants: number; images: number; errors: string[]; warnings: string[] };
type Preview = { rows: Row[]; unknownColumns: string[]; items: Item[]; summary: { rows: number; newProducts: number; updates: number; errors: number } };
type Result = { row: number; sku: string | null; status: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'ERROR'; productId: string | null; productStatus: string | null; errors: string[]; warnings: string[] };

/** Template columns, in order (titles must match what the API accepts). */
const COLUMNS: { title: string; width: number; help: string; example: string }[] = [
  { title: 'SKU *', width: 16, help: 'Código único del producto o variante en tu tienda. Si ya existe, solo se actualizan precio y stock.', example: 'CAM-LINO-S' },
  { title: 'Nombre *', width: 34, help: 'Nombre del producto (3 a 140 caracteres).', example: 'Camisa de lino manga corta' },
  { title: 'Descripción *', width: 50, help: 'Descripción para el cliente (mínimo 10 caracteres).', example: 'Camisa fresca de lino 100 %, ideal para el verano.' },
  { title: 'Categoría *', width: 34, help: 'Copia la ruta exacta de la hoja Categorías, por ejemplo «Ropa > Camisas».', example: '' },
  { title: 'Precio *', width: 12, help: 'Precio de venta, por ejemplo 25.90.', example: '25.90' },
  { title: 'Stock *', width: 10, help: 'Unidades disponibles (número entero).', example: '10' },
  { title: 'Peso (kg) *', width: 12, help: 'Peso del paquete en kilos, por ejemplo 0.3.', example: '0.3' },
  { title: 'Largo (cm) *', width: 12, help: 'Medidas del paquete en centímetros.', example: '30' },
  { title: 'Ancho (cm) *', width: 12, help: 'Medidas del paquete en centímetros.', example: '20' },
  { title: 'Alto (cm) *', width: 12, help: 'Medidas del paquete en centímetros.', example: '3' },
  { title: 'Imágenes (enlaces)', width: 40, help: 'Enlaces públicos a las fotos (https://…), separados por espacio o coma. Máximo 8. Sirven enlaces de Google Drive compartidos con «cualquier persona con el enlace».', example: 'https://ejemplo.com/camisa-frente.jpg https://ejemplo.com/camisa-espalda.jpg' },
  { title: 'Marca', width: 16, help: 'Opcional.', example: 'Costa Linen' },
  { title: 'Precio anterior', width: 14, help: 'Opcional: precio tachado, mayor que el precio de venta.', example: '32.00' },
  { title: 'Grupo', width: 18, help: 'Opcional: escribe el mismo texto en varias filas para que sean variantes (tallas, colores) de un solo producto. Nombre, descripción, categoría e imágenes se toman de la primera fila del grupo.', example: 'Camisa lino' },
  { title: 'Opción 1 nombre', width: 16, help: 'Con Grupo: nombre de la opción, por ejemplo Talla.', example: 'Talla' },
  { title: 'Opción 1 valor', width: 14, help: 'Con Grupo: valor de esta fila, por ejemplo S.', example: 'S' },
  { title: 'Opción 2 nombre', width: 16, help: 'Opcional: segunda opción, por ejemplo Color.', example: '' },
  { title: 'Opción 2 valor', width: 14, help: 'Valor de la segunda opción en esta fila.', example: '' },
];

function leafPaths(cats: any[], parents: string[] = []): string[] {
  return cats.flatMap((c) => (c.children?.length ? leafPaths(c.children, [...parents, c.name]) : [[...parents, c.name].join(' > ')]));
}

async function downloadTemplate(categories: any[]) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const head = COLUMNS.map((c) => ({ value: c.title, fontWeight: 'bold' as const, backgroundColor: '#EDE9FE' }));
  const paths = leafPaths(categories).sort((a, b) => a.localeCompare(b));
  const example = COLUMNS.map((c) => (c.title === 'Categoría *' ? paths.find((p) => /camis/i.test(p)) ?? paths[0] ?? '' : c.example));
  const example2 = example.map((v, i) => (COLUMNS[i].title === 'SKU *' ? 'CAM-LINO-M' : COLUMNS[i].title === 'Opción 1 valor' ? 'M' : COLUMNS[i].title === 'Stock *' ? '6' : v));
  const blob = await writeXlsxFile([
    { sheet: t('Productos'), data: [head], columns: COLUMNS.map((c) => ({ width: c.width })), stickyRowsCount: 1 },
    {
      sheet: t('Instrucciones'),
      data: [
        [{ value: t('Columna'), fontWeight: 'bold' }, { value: t('Qué escribir'), fontWeight: 'bold' }],
        ...COLUMNS.map((c) => [c.title, t(c.help)]),
        [],
        [t('Las columnas con * son obligatorias. Una fila es un producto, salvo que uses Grupo para crear variantes.')],
        [t('Escribe tus productos en la hoja «Productos» (la primera) y sube el archivo como .xlsx o CSV.')],
      ],
      columns: [{ width: 22 }, { width: 110 }],
    },
    { sheet: t('Ejemplo'), data: [head, example, example2], columns: COLUMNS.map((c) => ({ width: c.width })), stickyRowsCount: 1 },
    { sheet: t('Categorías'), data: [[{ value: t('Categoría (copia este texto)'), fontWeight: 'bold' }], ...paths.map((p) => [p])], columns: [{ width: 60 }] },
  ]).toBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'plantilla-productos-nexovax.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Splits the importable rows into small requests: whole products (all rows of a Grupo) together. */
function batches(preview: Preview): Row[][] {
  const ok = new Map(preview.items.filter((i) => !i.errors.length).map((i) => [i.row, i]));
  const units = new Map<string, Row[]>();
  for (const r of preview.rows) {
    const it = ok.get(r.row);
    if (!it) continue;
    const key = it.action === 'CREATE' ? `c:${it.productKey}` : `u:${r.row}`;
    units.set(key, [...(units.get(key) ?? []), r]);
  }
  const out: Row[][] = [];
  let cur: Row[] = [];
  let creates = 0;
  for (const [key, rows] of units) {
    const isCreate = key.startsWith('c:');
    if (cur.length && (cur.length + rows.length > 50 || (isCreate && creates >= 3))) {
      out.push(cur);
      cur = [];
      creates = 0;
    }
    cur.push(...rows);
    if (isCreate) creates++;
  }
  if (cur.length) out.push(cur);
  return out;
}

const STATUS: Record<Result['status'], { label: string; tone: 'green' | 'blue' | 'gray' | 'red' }> = {
  CREATED: { label: 'Creado', tone: 'green' },
  UPDATED: { label: 'Actualizado', tone: 'blue' },
  UNCHANGED: { label: 'Sin cambios', tone: 'gray' },
  ERROR: { label: 'Error', tone: 'red' },
};

const PRODUCT_STATUS: Record<string, string> = { DRAFT: 'Borrador', PENDING_REVIEW: 'En revisión', ACTIVE: 'Publicado', PAUSED: 'Pausado', REJECTED: 'Rechazado' };

function Messages({ errors, warnings }: { errors: string[]; warnings: string[] }) {
  if (!errors.length && !warnings.length) return <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-4" /> {t('Listo')}</span>;
  return (
    <ul className="space-y-1 text-xs">
      {errors.map((e, i) => <li key={`e${i}`} className="flex gap-1 text-red-600"><XCircle className="mt-0.5 size-3.5 shrink-0" />{e}</li>)}
      {warnings.map((w, i) => <li key={`w${i}`} className="flex gap-1 text-amber-700"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{w}</li>)}
    </ul>
  );
}

export default function ImportProducts() {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get('/categories'), staleTime: 300_000 });
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filter, setFilter] = useState<'all' | 'errors'>('all');
  const [submit, setSubmit] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    setPreview(null);
    setResults(null);
    setFileName('');
    setFilter('all');
    if (input.current) input.current.value = '';
  };

  const read = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(xlsx|csv)$/i.test(file.name)) return toast.error(t('Sube un archivo .xlsx o .csv.'));
    if (file.size > 5 * 1024 * 1024) return toast.error(t('El archivo supera 5 MB.'));
    setReading(true);
    setResults(null);
    setFileName(file.name);
    try {
      const form = new FormData();
      form.append('file', file);
      const p = await upload<Preview>('/seller/products/import/preview', form);
      setPreview(p);
      setFilter(p.summary.errors ? 'errors' : 'all');
    } catch (e) {
      setPreview(null);
      toast.error(errorMessage(e));
    } finally {
      setReading(false);
    }
  };

  const plan = useMemo(() => (preview ? batches(preview) : []), [preview]);
  const importable = preview ? preview.summary.newProducts + preview.summary.updates : 0;

  const run = async () => {
    if (!preview || !plan.length) return;
    const total = plan.reduce((a, b) => a + b.length, 0);
    const all: Result[] = [];
    setProgress({ done: 0, total });
    try {
      for (const rows of plan) {
        try {
          const r = await post<{ results: Result[] }>('/seller/products/import/commit', { rows, submit });
          all.push(...r.results);
        } catch (e) {
          // One failed request doesn't stop the rest; its rows are reported as errors.
          all.push(...rows.map((row) => ({ row: row.row, sku: String(row.sku ?? ''), status: 'ERROR' as const, productId: null, productStatus: null, errors: [errorMessage(e)], warnings: [] })));
        }
        setProgress((p) => (p ? { ...p, done: p.done + rows.length } : p));
      }
    } finally {
      setProgress(null);
      setResults(all.sort((a, b) => a.row - b.row));
      qc.invalidateQueries({ queryKey: ['seller-products'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    }
    const failed = all.filter((r) => r.status === 'ERROR').length;
    if (failed) toast.warning(t('Importación terminada con {n} filas con error.', { n: failed }));
    else toast.success(t('Importación terminada.'));
  };

  const shown = preview ? preview.items.filter((i) => filter === 'all' || i.errors.length) : [];
  const count = (s: Result['status']) => results?.filter((r) => r.status === s).length ?? 0;

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('Mi tienda') }, { label: t('Productos'), href: '/vendedor/productos' }, { label: t('Importar') }]}
        title={t('Importar productos')}
        description={t('Crea o actualiza muchos productos a la vez desde una hoja de cálculo.')}
        actions={<Button variant="secondary" asChild><Link href="/vendedor/productos"><ArrowLeft /> {t('Volver a productos')}</Link></Button>}
      />

      {!results && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-5">
            <CardHeader className="border-0 p-0" icon={<FileSpreadsheet />} title={t('1. Descarga la plantilla')} subtitle={t('Excel con las columnas, instrucciones, un ejemplo y la lista de categorías.')} />
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
              <li>{t('Una fila por producto. Para tallas o colores, usa la columna Grupo.')}</li>
              <li>{t('Las imágenes van como enlaces públicos (https://…); las descargamos nosotros.')}</li>
              <li>{t('Si un SKU ya existe en tu tienda, solo se actualizan su precio y su stock.')}</li>
              <li>{t('También puedes subir un CSV exportado de Google Sheets u otra tienda con las mismas columnas.')}</li>
            </ul>
            <Button className="mt-4" variant="outline" loading={cats.isLoading} disabled={!cats.data} onClick={() => downloadTemplate(cats.data ?? []).catch((e) => toast.error(errorMessage(e)))}>
              <Download /> {t('Descargar plantilla (.xlsx)')}
            </Button>
          </Card>

          <Card className="p-5">
            <CardHeader className="border-0 p-0" icon={<Upload />} title={t('2. Sube tu archivo')} subtitle={t('Revisamos cada fila antes de guardar nada.')} />
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); read(e.dataTransfer.files?.[0]); }}
              className={`mt-4 flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm transition ${dragging ? 'border-brand-500 bg-brand-50' : 'border-line hover:border-brand-300 hover:bg-surface'}`}
            >
              {reading ? <RefreshCw className="size-6 animate-spin text-brand-600" /> : <FileSpreadsheet className="size-6 text-brand-600" />}
              <b>{reading ? t('Revisando {file}…', { file: fileName }) : fileName || t('Arrastra el archivo aquí o haz clic para elegirlo')}</b>
              <span className="text-xs text-muted">{t('.xlsx o .csv, hasta 500 filas y 5 MB')}</span>
            </button>
            <input ref={input} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden" onChange={(e) => read(e.target.files?.[0])} />
          </Card>
        </div>
      )}

      {preview && !results && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard label={t('Filas leídas')} value={preview.summary.rows} icon={<FileSpreadsheet />} />
            <StatCard label={t('Productos nuevos')} value={preview.summary.newProducts} icon={<CheckCircle2 />} tone="green" />
            <StatCard label={t('Precio/stock a actualizar')} value={preview.summary.updates} icon={<RefreshCw />} />
            <StatCard label={t('Filas con errores')} value={preview.summary.errors} icon={<XCircle />} tone={preview.summary.errors ? 'red' : 'green'} />
          </div>
          {preview.unknownColumns.length > 0 && (
            <p className="mt-3 text-sm text-amber-700">{t('Columnas ignoradas (no son de la plantilla): {cols}', { cols: preview.unknownColumns.join(', ') })}</p>
          )}

          <Card className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: t('Todas'), count: preview.items.length }, { value: 'errors', label: t('Con errores'), count: preview.summary.errors }]} />
              <Button variant="secondary" size="sm" onClick={reset}>{t('Subir otro archivo')}</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-surface text-left text-xs font-semibold text-muted">
                  <tr><th className="px-5 py-3">{t('Fila')}</th><th>{t('SKU')}</th><th>{t('Producto')}</th><th>{t('Acción')}</th><th>{t('Variantes')}</th><th>{t('Imágenes')}</th><th className="pr-5">{t('Revisión')}</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((i) => (
                    <tr key={i.row} className={i.errors.length ? 'bg-red-50/40' : ''}>
                      <td className="px-5 py-3 text-muted">{i.row}</td>
                      <td className="font-mono text-xs">{i.sku ?? '—'}</td>
                      <td className="max-w-[16rem]"><span className="line-clamp-2">{i.title ?? '—'}</span></td>
                      <td>{i.action === 'UPDATE' ? <Badge tone="blue">{t('Actualizar')}</Badge> : i.action === 'CREATE' ? <Badge tone="green">{t('Nuevo')}</Badge> : '—'}</td>
                      <td>{i.action === 'CREATE' ? i.variants : '—'}</td>
                      <td>{i.action === 'CREATE' ? i.images : '—'}</td>
                      <td className="py-3 pr-5"><Messages errors={i.errors} warnings={i.warnings} /></td>
                    </tr>
                  ))}
                  {!shown.length && <tr><td colSpan={7} className="px-5 py-8 text-center text-muted">{t('No hay filas con errores.')}</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <Checkbox checked={submit} onChange={setSubmit} label={t('Enviar los productos nuevos a revisión para publicarlos')} />
              <p className="text-xs text-muted">
                {submit ? t('Los que no tengan imágenes quedarán como borradores.') : t('Todos los productos nuevos quedarán como borradores; podrás revisarlos y enviarlos desde Productos.')}
                {preview.summary.errors > 0 && ` ${t('Las filas con errores no se importan; corrígelas en el archivo y vuelve a subirlo.')}`}
              </p>
            </div>
            <Button size="lg" disabled={!importable || !!progress} loading={!!progress} onClick={run}>
              {progress ? t('Importando {done} de {total}…', { done: progress.done, total: progress.total }) : t('Importar {n} productos', { n: importable })}
            </Button>
          </Card>
          {progress && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }} />
            </div>
          )}
        </>
      )}

      {results && (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard label={t('Creados')} value={new Set(results.filter((r) => r.status === 'CREATED').map((r) => r.productId)).size} icon={<CheckCircle2 />} tone="green" />
            <StatCard label={t('Actualizados')} value={count('UPDATED')} icon={<RefreshCw />} />
            <StatCard label={t('Sin cambios')} value={count('UNCHANGED')} icon={<FileSpreadsheet />} tone="amber" />
            <StatCard label={t('Con errores')} value={count('ERROR')} icon={<XCircle />} tone={count('ERROR') ? 'red' : 'green'} />
          </div>
          <Card className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <b>{t('Resultado de la importación')}</b>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={reset}>{t('Importar otro archivo')}</Button>
                <Button size="sm" asChild><Link href="/vendedor/productos">{t('Ver mis productos')}</Link></Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-surface text-left text-xs font-semibold text-muted">
                  <tr><th className="px-5 py-3">{t('Fila')}</th><th>{t('SKU')}</th><th>{t('Resultado')}</th><th>{t('Estado del producto')}</th><th className="pr-5">{t('Detalles')}</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {results.map((r) => (
                    <tr key={r.row}>
                      <td className="px-5 py-3 text-muted">{r.row}</td>
                      <td className="font-mono text-xs">{r.productId ? <Link className="text-brand-700 hover:underline" href={`/vendedor/productos/${r.productId}/editar`}>{r.sku}</Link> : r.sku ?? '—'}</td>
                      <td><Badge tone={STATUS[r.status].tone}>{t(STATUS[r.status].label)}</Badge></td>
                      <td className="text-muted">{r.productStatus ? t(PRODUCT_STATUS[r.productStatus] ?? r.productStatus) : '—'}</td>
                      <td className="py-3 pr-5"><Messages errors={r.errors} warnings={r.warnings} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
