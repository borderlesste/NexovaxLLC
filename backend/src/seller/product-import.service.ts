import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { DbService } from '../db/db.service';
import { SettingsService } from '../settings/settings.service';
import { RequestUser } from '../auth/auth';
import { badRequest } from '../common/errors';
import { toMinor } from '../common/money';
import { fetchPublicImage, ImageFetchError } from '../common/safe-fetch';
import { colorSwatch, isColorOption } from '../common/variant-options-i18n';
import { SellerService } from './seller.service';
import { ProductDto } from './seller.controller';
import {
  decodeCsv, IMPORT_COLUMNS, ImportField, ImportFileError, ImportRow, normalizeImageUrl, parseCount, parseCsv, parseMeasure, parseMoney,
  rowsFromSheet, splitImageUrls, textKey,
} from './product-import.parse';

export type PreviewAction = 'CREATE' | 'UPDATE';

export interface PreviewItem {
  row: number;
  sku: string | null;
  title: string | null;
  action: PreviewAction | null;
  /** Rows that become one product share the key of its first row. */
  productKey: string | null;
  variants: number;
  images: number;
  errors: string[];
  warnings: string[];
}

export interface CommitResult {
  row: number;
  sku: string | null;
  status: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'ERROR';
  productId: string | null;
  productStatus: string | null;
  errors: string[];
  warnings: string[];
}

interface Category {
  id: string;
  name: string;
  path: string;
  hasChildren: boolean;
}

interface ExistingSku {
  variantId: string;
  productId: string;
  productStatus: string;
  variantStatus: string;
}

interface Plan {
  items: Map<number, PreviewItem>;
  /** Products to create: their rows (first row holds product data) and the input for saveProduct. */
  creates: { key: string; rows: ImportRow[]; dto: ProductDto | null; images: string[] }[];
  updates: { row: ImportRow; existing: ExistingSku; price: string | null; compareAt: string | null; stock: number | null }[];
}

/** Column label shown in messages, without the required-column asterisk. */
const col = (f: ImportField) => IMPORT_COLUMNS[f].replace(' *', '');

/** Column for a class-validator property path (variants.0.price → Precio). */
const PATH_COLUMN: Record<string, ImportField> = {
  title: 'title', description: 'description', categoryId: 'category', brandName: 'brand', sku: 'sku', price: 'price',
  compareAtPrice: 'compareAtPrice', stock: 'stock', weightKg: 'weightKg', lengthCm: 'lengthCm', widthCm: 'widthCm', heightCm: 'heightCm',
  name: 'option1Name', label: 'option1Value',
};

function flattenErrors(errors: ValidationError[]): string[] {
  const out: string[] = [];
  for (const e of errors) {
    const field = PATH_COLUMN[e.property];
    for (const m of Object.values(e.constraints ?? {})) {
      const english = /\b(must|should|property)\b/.test(m);
      out.push(field ? `${col(field)}: ${english ? 'valor inválido.' : m}` : english ? 'Hay un valor inválido en la fila.' : m);
    }
    if (e.children?.length) out.push(...flattenErrors(e.children));
  }
  return out;
}

const appErrorText = (e: any): string[] => {
  const r = e?.getResponse?.();
  const details: string[] = Array.isArray(r?.details) ? r.details.flatMap((d: any) => (Array.isArray(d?.errors) ? d.errors : [])) : [];
  const msg = typeof r?.message === 'string' ? r.message : typeof e?.message === 'string' ? e.message : 'Error inesperado.';
  return details.length ? details : [msg];
};

@Injectable()
export class ProductImportService {
  private readonly log = new Logger(ProductImportService.name);

  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly seller: SellerService,
  ) {}

  /** Reads an uploaded .xlsx or .csv file into rows. */
  async readFile(file: { buffer: Buffer; originalname?: string; mimetype?: string }): Promise<{ rows: ImportRow[]; unknownColumns: string[] }> {
    const name = (file.originalname ?? '').toLowerCase();
    const isZip = file.buffer.length > 4 && file.buffer.readUInt32LE(0) === 0x04034b50;
    try {
      if (isZip || name.endsWith('.xlsx')) {
        if (!isZip) throw new ImportFileError('El archivo .xlsx está dañado. Vuelve a guardarlo desde Excel o Google Sheets.');
        assertSafeZip(file.buffer);
        const { readSheet } = await import('read-excel-file/node');
        const sheet = await readSheet(file.buffer);
        return rowsFromSheet(sheet as unknown[][]);
      }
      if (name.endsWith('.xls') || file.buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])))
        throw new ImportFileError('El formato .xls (Excel 97-2003) no es compatible. Guárdalo como .xlsx o CSV.');
      return rowsFromSheet(parseCsv(decodeCsv(file.buffer)));
    } catch (e) {
      if (e instanceof ImportFileError) throw badRequest('IMPORT_FILE_INVALID', e.message);
      this.log.warn(`import file unreadable: ${(e as Error)?.message}`);
      throw badRequest('IMPORT_FILE_INVALID', 'No pudimos leer el archivo. Usa la plantilla y guárdala como .xlsx o CSV.');
    }
  }

  async preview(sellerId: string, rows: ImportRow[]) {
    const plan = await this.plan(sellerId, rows);
    const items = [...plan.items.values()].sort((a, b) => a.row - b.row);
    const ok = items.filter((i) => !i.errors.length);
    return {
      items,
      summary: {
        rows: items.length,
        newProducts: new Set(ok.filter((i) => i.action === 'CREATE').map((i) => i.productKey)).size,
        updates: ok.filter((i) => i.action === 'UPDATE').length,
        errors: items.filter((i) => i.errors.length).length,
      },
    };
  }

  /**
   * Imports a batch of rows (whole products; the panel sends a few at a time). Rows with errors
   * are skipped; everything else is created or updated. Re-running the same file is safe: SKUs
   * created the first time become price/stock updates.
   */
  async commit(user: RequestUser, sellerId: string, rows: ImportRow[], submit: boolean): Promise<CommitResult[]> {
    const plan = await this.plan(sellerId, rows);
    const results = new Map<number, CommitResult>();
    const base = (r: ImportRow, item?: PreviewItem): CommitResult => ({
      row: r.row, sku: item?.sku ?? r.sku ?? null, status: 'ERROR', productId: null, productStatus: null, errors: [...(item?.errors ?? [])], warnings: [...(item?.warnings ?? [])],
    });
    for (const r of rows) {
      const item = plan.items.get(r.row);
      if (item?.errors.length) results.set(r.row, base(r, item));
    }

    // Price and stock of existing SKUs.
    const currency = await this.settings.currency();
    for (const u of plan.updates) {
      const res = base(u.row, plan.items.get(u.row.row));
      try {
        const changed = await this.db.tx(async (c) => {
          const loc = await this.db.one(`select id from public.inventory_locations where seller_id = $1 and status = 'ACTIVE' order by fulfillment_priority limit 1`, [sellerId], c);
          const before = await this.variantState(u.existing.variantId, currency, c);
          if (u.price) await this.seller.setPrice(c, user.id, sellerId, u.existing.variantId, currency, u.price, u.compareAt);
          if (u.stock != null) await this.seller.setStock(c, user.id, sellerId, u.existing.variantId, loc!.id, u.stock, 'STOCK_CORRECTION', 'BULK_IMPORT');
          const after = await this.variantState(u.existing.variantId, currency, c);
          return before !== after;
        });
        Object.assign(res, { status: changed ? 'UPDATED' : 'UNCHANGED', productId: u.existing.productId, productStatus: u.existing.productStatus });
      } catch (e) {
        res.errors.push(...appErrorText(e));
      }
      results.set(u.row.row, res);
    }

    // New products: draft first, then images, then (optionally) review or publication.
    for (const p of plan.creates) {
      const first = p.rows[0];
      const res = base(first, plan.items.get(first.row));
      const others = p.rows.slice(1);
      try {
        const files: Express.Multer.File[] = [];
        for (const [i, url] of p.images.entries()) {
          try {
            files.push((await fetchPublicImage(url)) as unknown as Express.Multer.File);
          } catch (e) {
            res.warnings.push(`Imagen ${i + 1}: ${e instanceof ImageFetchError ? e.message : 'no se pudo descargar.'}`);
          }
        }
        const created: any = await this.seller.saveProduct(user, sellerId, { ...p.dto!, action: 'SAVE_DRAFT' });
        res.productId = created.id;
        res.productStatus = created.status;
        if (files.length) {
          try {
            await this.seller.addMedia(user, sellerId, created.id, files);
          } catch (e) {
            res.warnings.push(`Imágenes: ${appErrorText(e).join(' ')}`);
          }
        }
        if (submit) {
          try {
            const sent: any = await this.seller.saveProduct(user, sellerId, { ...p.dto!, action: 'SUBMIT' }, created.id);
            res.productStatus = sent.status;
          } catch (e) {
            res.warnings.push(`Quedó como borrador: ${appErrorText(e).join(' ')}`);
          }
        }
        res.status = 'CREATED';
      } catch (e) {
        res.errors.push(...appErrorText(e));
      }
      results.set(first.row, res);
      for (const r of others) {
        const o = base(r, plan.items.get(r.row));
        results.set(r.row, { ...o, status: res.status, productId: res.productId, productStatus: res.productStatus, errors: res.status === 'ERROR' ? res.errors : [] });
      }
    }
    return rows.map((r) => results.get(r.row) ?? base(r, plan.items.get(r.row))).sort((a, b) => a.row - b.row);
  }

  // ------------------------------------------------------------------ planning
  private async variantState(variantId: string, currency: string, c: any) {
    const r = await this.db.one<{ s: string }>(
      `select concat_ws('|',
         (select amount::text from public.variant_price_versions where variant_id = $1 and currency_code = $2 and status = 'ACTIVE' order by effective_from desc limit 1),
         (select compare_at_amount::text from public.variant_price_versions where variant_id = $1 and currency_code = $2 and status = 'ACTIVE' order by effective_from desc limit 1),
         (select sum(on_hand)::text from public.inventory_items where variant_id = $1)) as s`,
      [variantId, currency],
      c,
    );
    return r?.s ?? '';
  }

  private async categories(): Promise<{ byKey: Map<string, Category[]> }> {
    const rows = await this.db.many<{ id: string; parent_id: string | null; name: string; slug: string }>(
      `select id, parent_id, name, slug from public.categories where status = 'ACTIVE'`,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const parents = new Set(rows.map((r) => r.parent_id).filter(Boolean));
    const pathOf = (r: (typeof rows)[number]): string[] => {
      const out = [r.name];
      let p = r.parent_id ? byId.get(r.parent_id) : undefined;
      for (let i = 0; p && i < 6; i++) {
        out.unshift(p.name);
        p = p.parent_id ? byId.get(p.parent_id) : undefined;
      }
      return out;
    };
    const byKey = new Map<string, Category[]>();
    const add = (k: string, c: Category) => {
      const list = byKey.get(k) ?? [];
      if (!list.some((x) => x.id === c.id)) list.push(c);
      byKey.set(k, list);
    };
    for (const r of rows) {
      const path = pathOf(r);
      const c: Category = { id: r.id, name: r.name, path: path.join(' > '), hasChildren: parents.has(r.id) };
      add(textKey(r.name), c);
      add(textKey(r.slug), c);
      add(path.map(textKey).join('>'), c);
      if (path.length > 2) add(path.slice(-2).map(textKey).join('>'), c);
    }
    return { byKey };
  }

  private resolveCategory(byKey: Map<string, Category[]>, raw: string): { category?: Category; error?: string } {
    const key = raw.split(/\s*(?:>|»|›|\/)\s*/).map(textKey).filter(Boolean).join('>');
    const found = byKey.get(key) ?? [];
    if (!found.length) return { error: `${col('category')}: «${raw}» no existe. Copia el nombre exacto de la hoja Categorías de la plantilla.` };
    if (found.length > 1)
      return { error: `${col('category')}: «${raw}» existe en varias secciones (${found.map((f) => f.path).join('; ')}). Escribe la ruta completa, por ejemplo «${found[0].path}».` };
    const c = found[0];
    if (c.hasChildren) return { error: `${col('category')}: «${c.path}» tiene subcategorías; elige una de ellas (hoja Categorías de la plantilla).` };
    return { category: c };
  }

  private async plan(sellerId: string, rows: ImportRow[]): Promise<Plan> {
    const items = new Map<number, PreviewItem>();
    const plan: Plan = { items, creates: [], updates: [] };
    const location = await this.db.one(`select 1 from public.inventory_locations where seller_id = $1 and status = 'ACTIVE' limit 1`, [sellerId]);
    if (!location) throw badRequest('NO_INVENTORY_LOCATION', 'Configura la dirección de tu almacén (Configuración de la tienda) antes de importar productos.');

    const skuOf = (r: ImportRow) => (r.sku ?? '').trim().toUpperCase();
    for (const r of rows)
      items.set(r.row, { row: r.row, sku: skuOf(r) || null, title: r.title?.trim() || null, action: null, productKey: null, variants: 1, images: 0, errors: [], warnings: [] });

    // SKUs: required, unique within the file, and either new or an existing variant of this store.
    const seen = new Map<string, number>();
    for (const r of rows) {
      const sku = skuOf(r);
      const it = items.get(r.row)!;
      if (!sku) it.errors.push(`${col('sku')}: es obligatorio.`);
      else if (seen.has(sku)) it.errors.push(`${col('sku')}: «${sku}» está repetido (también en la fila ${seen.get(sku)}).`);
      else seen.set(sku, r.row);
    }
    const existingRows = seen.size
      ? await this.db.many<{ sku: string; variant_id: string; product_id: string; product_status: string; variant_status: string }>(
          `select upper(v.sku) as sku, v.id as variant_id, v.product_id, p.status as product_status, v.status as variant_status
             from public.product_variants v join public.products p on p.id = v.product_id
            where v.seller_id = $1 and upper(v.sku) = any($2::text[])`,
          [sellerId, [...seen.keys()]],
        )
      : [];
    const existing = new Map<string, ExistingSku>(
      existingRows.map((e) => [e.sku, { variantId: e.variant_id, productId: e.product_id, productStatus: e.product_status, variantStatus: e.variant_status }]),
    );

    // Existing SKUs: price and stock updates only. A new SKU in the Grupo of an existing product
    // would become a separate product, so new variants of existing products go through the editor.
    const existingGroups = new Set(rows.filter((r) => existing.has(skuOf(r)) && r.group?.trim()).map((r) => textKey(r.group!)));
    const newRows: ImportRow[] = [];
    for (const r of rows) {
      const it = items.get(r.row)!;
      const ex = existing.get(skuOf(r));
      if (!ex) {
        if (r.group?.trim() && existingGroups.has(textKey(r.group))) {
          it.action = 'CREATE';
          it.errors.push(`${col('group')}: el producto «${r.group.trim()}» ya existe en tu tienda. Para añadirle la variante ${it.sku ?? ''} usa el editor del producto.`);
        } else newRows.push(r);
        continue;
      }
      it.action = 'UPDATE';
      it.productKey = ex.productId;
      if (ex.productStatus === 'ARCHIVED' || ex.variantStatus === 'ARCHIVED') {
        it.errors.push(`${col('sku')}: «${it.sku}» pertenece a un producto archivado. Usa otro SKU.`);
        continue;
      }
      const price = r.price ? parseMoney(r.price) : null;
      const compareAt = r.compareAtPrice ? parseMoney(r.compareAtPrice) : null;
      const stock = r.stock ? parseCount(r.stock) : null;
      if (r.price && (!price || toMinor(price) <= 0n)) it.errors.push(`${col('price')}: «${r.price}» no es un precio válido.`);
      if (r.compareAtPrice && !compareAt) it.errors.push(`${col('compareAtPrice')}: «${r.compareAtPrice}» no es un precio válido.`);
      if (r.stock && (stock == null || stock > 1_000_000)) it.errors.push(`${col('stock')}: «${r.stock}» debe ser un número entero de 0 en adelante.`);
      if (!r.price && !r.stock) it.errors.push(`${col('sku')}: «${it.sku}» ya existe en tu tienda; indica el nuevo ${col('price').toLowerCase()} o ${col('stock').toLowerCase()} para actualizarlo.`);
      if (!it.errors.length) {
        it.warnings.push('Ya existe: solo se actualizarán el precio y el stock.');
        plan.updates.push({ row: r, existing: ex, price, compareAt: price ? compareAt : null, stock });
      }
    }

    // New SKUs: rows with the same Grupo become one product with variants; otherwise one row = one product.
    const groups = new Map<string, ImportRow[]>();
    for (const r of newRows) {
      const key = r.group?.trim() ? `g:${textKey(r.group)}` : `s:${skuOf(r) || r.row}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const { byKey } = await this.categories();
    for (const [key, group] of groups) {
      const first = group[0];
      const groupErrors: string[] = [];
      const pick = (f: ImportField) => group.map((r) => r[f]?.trim()).find(Boolean) ?? '';

      const title = pick('title');
      const categoryRaw = pick('category');
      let categoryId = '';
      if (!categoryRaw) groupErrors.push(`${col('category')}: es obligatoria.`);
      else {
        const { category, error } = this.resolveCategory(byKey, categoryRaw);
        if (error) groupErrors.push(error);
        else categoryId = category!.id;
      }

      const optionNames = [pick('option1Name'), pick('option2Name')];
      if (group.length > 1 && !optionNames[0])
        groupErrors.push(`${col('group')}: las filas del grupo «${first.group}» necesitan ${col('option1Name')} (por ejemplo Talla o Color) para distinguir las variantes.`);
      const options = optionNames
        .map((name, i) => ({
          name,
          values: [...new Set(group.map((r) => (i === 0 ? r.option1Value : r.option2Value)?.trim()).filter(Boolean) as string[])].map((label) => ({ label, swatch: isColorOption(name) ? colorSwatch(label) : null })),
        }))
        .filter((o) => o.name && o.values.length);

      const urls = splitImageUrls(pick('images'));
      const images: string[] = [];
      for (const u of urls) {
        const n = normalizeImageUrl(u);
        if (!n) groupErrors.push(`${col('images')}: «${u.slice(0, 80)}» no es un enlace válido (debe empezar por https://).`);
        else images.push(n);
      }
      if (images.length > 8) groupErrors.push(`${col('images')}: máximo 8 imágenes por producto.`);

      const rowErrors = new Map<number, string[]>();
      const variants = group.map((r) => {
        const errs: string[] = [];
        const price = parseMoney(r.price);
        if (!r.price) errs.push(`${col('price')}: es obligatorio.`);
        else if (!price) errs.push(`${col('price')}: «${r.price}» no es un precio válido.`);
        const compareAt = r.compareAtPrice ? parseMoney(r.compareAtPrice) : null;
        if (r.compareAtPrice && !compareAt) errs.push(`${col('compareAtPrice')}: «${r.compareAtPrice}» no es un precio válido.`);
        const stock = parseCount(r.stock);
        if (!r.stock) errs.push(`${col('stock')}: es obligatorio.`);
        else if (stock == null) errs.push(`${col('stock')}: «${r.stock}» debe ser un número entero de 0 en adelante.`);
        const measure = (f: ImportField) => {
          const v = parseMeasure(r[f] ?? pick(f));
          if (!(r[f] ?? pick(f))) errs.push(`${col(f)}: es obligatorio para calcular el envío.`);
          else if (v == null) errs.push(`${col(f)}: «${r[f] ?? pick(f)}» debe ser un número mayor que cero.`);
          return v;
        };
        const optionValues: Record<string, string> = {};
        options.forEach((o, i) => {
          const v = (i === 0 ? r.option1Value : r.option2Value)?.trim();
          if (v) optionValues[o.name] = v;
          else if (group.length > 1) errs.push(`${i === 0 ? col('option1Value') : col('option2Value')}: falta el valor de «${o.name}».`);
        });
        const v = {
          sku: skuOf(r),
          price: price ?? '0',
          compareAtPrice: compareAt,
          stock: stock ?? 0,
          weightKg: measure('weightKg'),
          lengthCm: measure('lengthCm'),
          widthCm: measure('widthCm'),
          heightCm: measure('heightCm'),
          optionValues: Object.keys(optionValues).length ? optionValues : undefined,
        };
        rowErrors.set(r.row, errs);
        return v;
      });

      const plain = {
        title,
        categoryId: categoryId || '00000000-0000-0000-0000-000000000000',
        brandName: pick('brand') || undefined,
        description: pick('description'),
        options: options.length ? options : undefined,
        variants,
        action: 'SAVE_DRAFT',
      };
      if (!title) groupErrors.push(`${col('title')}: es obligatorio.`);
      if (!plain.description) groupErrors.push(`${col('description')}: es obligatoria (mínimo 10 caracteres).`);
      const dto = plainToInstance(ProductDto, plain);
      const fieldRowsHaveErrors = [...rowErrors.values()].some((e) => e.length);
      if (!groupErrors.length && !fieldRowsHaveErrors) {
        groupErrors.push(...new Set(flattenErrors(await validate(dto))));
        if (!groupErrors.length) {
          try {
            this.seller.validateProduct(dto as any);
          } catch (e) {
            groupErrors.push(...appErrorText(e));
          }
        }
      }

      for (const r of group) {
        const it = items.get(r.row)!;
        it.action = 'CREATE';
        it.productKey = key;
        it.title = title || null;
        it.variants = group.length;
        it.images = images.length;
        it.errors.push(...(rowErrors.get(r.row) ?? []), ...(r === first ? groupErrors : groupErrors.length ? ['El producto de esta fila tiene errores (ver la primera fila del grupo).'] : []));
        if (r === first && !images.length) it.warnings.push('Sin imágenes: se guardará como borrador hasta que agregues al menos una.');
      }
      const ok = group.every((r) => !items.get(r.row)!.errors.length);
      plan.creates.push({ key, rows: group, dto: ok ? dto : null, images });
    }
    plan.creates = plan.creates.filter((c) => c.dto);
    return plan;
  }
}

/**
 * Zip-bomb guard for .xlsx uploads: reads the ZIP central directory (without inflating anything) and
 * rejects archives whose declared uncompressed size, entry count or compression ratio is excessive.
 */
export function assertSafeZip(buf: Buffer, limits = { maxEntries: 400, maxEntryBytes: 25 * 1024 * 1024, maxTotalBytes: 60 * 1024 * 1024, maxRatio: 120 }) {
  const fail = () => {
    throw new ImportFileError('El archivo .xlsx es demasiado grande una vez descomprimido. Divídelo en archivos más pequeños.');
  };
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportFileError('El archivo .xlsx está dañado. Vuelve a guardarlo desde Excel o Google Sheets.');
  const entries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff || entries > limits.maxEntries) fail();
  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ImportFileError('El archivo .xlsx está dañado. Vuelve a guardarlo desde Excel o Google Sheets.');
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    if (size === 0xffffffff || compressed === 0xffffffff || size > limits.maxEntryBytes) fail();
    if (size > 1024 * 1024 && size / Math.max(1, compressed) > limits.maxRatio) fail();
    total += size;
    if (total > limits.maxTotalBytes) fail();
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
}
