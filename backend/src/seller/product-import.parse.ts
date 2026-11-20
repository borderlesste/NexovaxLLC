/**
 * Spreadsheet parsing for the seller product import: CSV (any of , ; or tab, UTF-8 or Windows-1252)
 * and Excel (.xlsx). Produces one ImportRow per data row, keyed by the template's columns, with
 * every cell as trimmed text. Business validation happens in ProductImportService.
 */

export const IMPORT_MAX_ROWS = 500;

export interface ImportRow {
  /** Spreadsheet row number (header = 1), shown to the seller in errors. */
  row: number;
  group?: string;
  title?: string;
  description?: string;
  category?: string;
  brand?: string;
  price?: string;
  compareAtPrice?: string;
  stock?: string;
  sku?: string;
  weightKg?: string;
  lengthCm?: string;
  widthCm?: string;
  heightCm?: string;
  images?: string;
  option1Name?: string;
  option1Value?: string;
  option2Name?: string;
  option2Value?: string;
}

export type ImportField = Exclude<keyof ImportRow, 'row'>;

/** Column title in the template (Spanish) for each field. Required ones carry an asterisk. */
export const IMPORT_COLUMNS: Record<ImportField, string> = {
  sku: 'SKU *',
  title: 'Nombre *',
  description: 'Descripción *',
  category: 'Categoría *',
  price: 'Precio *',
  stock: 'Stock *',
  weightKg: 'Peso (kg) *',
  lengthCm: 'Largo (cm) *',
  widthCm: 'Ancho (cm) *',
  heightCm: 'Alto (cm) *',
  images: 'Imágenes (enlaces)',
  brand: 'Marca',
  compareAtPrice: 'Precio anterior',
  group: 'Grupo',
  option1Name: 'Opción 1 nombre',
  option1Value: 'Opción 1 valor',
  option2Name: 'Opción 2 nombre',
  option2Value: 'Opción 2 valor',
};

/** Accepted header spellings (normalized with headerKey) for each field. */
const ALIASES: Record<ImportField, string[]> = {
  sku: ['sku', 'codigo', 'codigo_sku', 'referencia', 'ref'],
  title: ['nombre', 'titulo', 'nombre_del_producto', 'producto', 'title', 'name'],
  description: ['descripcion', 'description', 'detalle'],
  category: ['categoria', 'subcategoria', 'category'],
  price: ['precio', 'precio_de_venta', 'price'],
  stock: ['stock', 'cantidad', 'existencias', 'inventario', 'quantity', 'qty'],
  weightKg: ['peso_kg', 'peso', 'weight', 'weight_kg'],
  lengthCm: ['largo_cm', 'largo', 'length', 'length_cm'],
  widthCm: ['ancho_cm', 'ancho', 'width', 'width_cm'],
  heightCm: ['alto_cm', 'alto', 'height', 'height_cm'],
  images: ['imagenes_enlaces', 'imagenes', 'imagen', 'imagenes_urls', 'urls_imagenes', 'fotos', 'images', 'image', 'image_urls'],
  brand: ['marca', 'brand'],
  compareAtPrice: ['precio_anterior', 'precio_antes', 'precio_regular', 'compare_at_price', 'precio_tachado'],
  group: ['grupo', 'agrupar', 'group', 'producto_padre'],
  option1Name: ['opcion_1_nombre', 'opcion1_nombre', 'option_1_name', 'option1_name'],
  option1Value: ['opcion_1_valor', 'opcion1_valor', 'option_1_value', 'option1_value'],
  option2Name: ['opcion_2_nombre', 'opcion2_nombre', 'option_2_name', 'option2_name'],
  option2Value: ['opcion_2_valor', 'opcion2_valor', 'option_2_value', 'option2_value'],
};

const FIELD_BY_HEADER = new Map<string, ImportField>(
  (Object.entries(ALIASES) as [ImportField, string[]][]).flatMap(([field, names]) => names.map((n) => [n, field] as [string, ImportField])),
);

/** Lowercase ASCII key without accents, punctuation or the required-column asterisk. */
export function headerKey(s: string) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Text key for matching names (categories): accents, case and extra spaces ignored. */
export function textKey(s: string) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export class ImportFileError extends Error {}

/** Splits CSV text (RFC 4180 quotes) using the delimiter that appears most in the header line. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n/) === -1 ? undefined : src.search(/\r?\n/));
  const count = (d: string) => firstLine.split(d).length - 1;
  const delimiter = [';', '\t', ','].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** CSV bytes as text: UTF-8 when valid, otherwise Windows-1252 (Excel's "CSV" on Windows). */
export function decodeCsv(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

const cellText = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  return String(v).trim();
};

/**
 * Turns a sheet (header row + data rows) into ImportRows. The header row is the first row that
 * names an SKU or Nombre column, so a title line above the table is tolerated.
 */
export function rowsFromSheet(sheet: unknown[][]): { rows: ImportRow[]; unknownColumns: string[] } {
  const headerIndex = sheet.findIndex((r) =>
    (r ?? []).some((c) => {
      const f = FIELD_BY_HEADER.get(headerKey(cellText(c)));
      return f === 'sku' || f === 'title';
    }),
  );
  if (headerIndex < 0) throw new ImportFileError('No encontramos la fila de encabezados. Usa la plantilla: la primera fila debe tener las columnas SKU, Nombre, Precio, etc.');
  const header = sheet[headerIndex].map((c) => cellText(c));
  const fields: (ImportField | null)[] = header.map((h) => FIELD_BY_HEADER.get(headerKey(h)) ?? null);
  const unknownColumns = header.filter((h, i) => h && !fields[i]);
  const missing = (['sku', 'title', 'price', 'stock'] as ImportField[]).filter((f) => !fields.includes(f));
  if (missing.length)
    throw new ImportFileError(`Faltan columnas obligatorias: ${missing.map((f) => IMPORT_COLUMNS[f].replace(' *', '')).join(', ')}.`);
  const rows: ImportRow[] = [];
  for (let i = headerIndex + 1; i < sheet.length; i++) {
    const cells = sheet[i] ?? [];
    const r: ImportRow = { row: i + 1 };
    let any = false;
    fields.forEach((f, j) => {
      if (!f) return;
      const v = cellText(cells[j]);
      if (!v) return;
      any = true;
      r[f] = r[f] ? `${r[f]} ${v}` : v;
    });
    if (any) rows.push(r);
  }
  if (!rows.length) throw new ImportFileError('El archivo no tiene productos debajo de los encabezados.');
  if (rows.length > IMPORT_MAX_ROWS) throw new ImportFileError(`El archivo tiene ${rows.length} filas; el máximo por importación es ${IMPORT_MAX_ROWS}. Divídelo en varios archivos.`);
  return { rows, unknownColumns };
}

/**
 * Parses a price written by people: "$1,299.50", "1.299,50", "1299", "RD$ 850".
 * Returns a plain decimal string ("1299.50") or null when it is not a number.
 */
export function parseMoney(input: string | undefined | null): string | null {
  if (input == null) return null;
  let s = String(input).replace(/[^\d.,-]/g, '');
  if (!s || s.startsWith('-')) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    // "12,50" is a decimal comma; "1,299" or "1,299,000" are thousands.
    s = /^\d+,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.split(',').join('');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.299" or "1.299.000": dot as thousands separator (prices never have three decimals).
    s = s.split('.').join('');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

/** Whole number from a cell ("12", "12.0", "1,200"); null when it is not one. */
export function parseCount(input: string | undefined | null): number | null {
  if (input == null || String(input).trim() === '') return null;
  const s = String(input).trim().replace(/[\s,]/g, '').replace(/\.0+$/, '');
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

/** Positive measure (kg or cm) with a decimal point or comma; null when invalid. */
export function parseMeasure(input: string | undefined | null): number | null {
  if (input == null || String(input).trim() === '') return null;
  const s = String(input).trim().replace(/\s*(kg|cm|g|lb)$/i, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? Math.round(n * 1000) / 1000 : null;
}

/** Image links in one cell, separated by spaces, commas, semicolons, pipes or line breaks. */
export function splitImageUrls(cell: string | undefined): string[] {
  if (!cell) return [];
  return [...new Set(cell.split(/[\s,;|]+/).map((u) => u.trim()).filter(Boolean))];
}

/**
 * Turns common share links into direct downloads: Google Drive file/open links and Dropbox
 * "?dl=0" links. Returns null for anything that is not an http(s) URL.
 */
export function normalizeImageUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (host === 'drive.google.com') {
    const id = u.pathname.match(/\/file\/d\/([\w-]{10,})/)?.[1] ?? u.searchParams.get('id');
    if (id && /^[\w-]{10,}$/.test(id)) return `https://drive.google.com/uc?export=download&id=${id}`;
  }
  if (host === 'www.dropbox.com' || host === 'dropbox.com') {
    u.searchParams.delete('dl');
    u.searchParams.set('raw', '1');
    return u.toString();
  }
  return u.toString();
}
