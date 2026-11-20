import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { map } from 'rxjs';
import { requestLocale } from './i18n-errors';
import { isEditableOption, translateVariants } from './variant-options-i18n';

/**
 * Catalog taxonomy is stored in Spanish (categories, attribute names and options). For
 * English clients the API returns the original English names; French and Haitian Creole
 * clients get scripts/data/taxonomy_fr_ht.json. Only fields that carry taxonomy names are
 * translated; seller content (titles, descriptions) is never touched.
 */
const FIELDS = new Set(['name', 'category', 'parentCategory', 'parent_category', 'categoryName', 'attribute', 'attributeName']);

function loadEnglish(): Map<string, string> {
  const m = new Map<string, string>();
  for (const base of [resolve(process.cwd(), 'scripts/data'), resolve(process.cwd(), '..', 'scripts/data')]) {
    for (const f of ['categories_es.json', 'attributes_es.json']) {
      const p = resolve(base, f);
      if (!existsSync(p)) continue;
      const data = JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>;
      for (const [en, es] of Object.entries(data)) if (!m.has(es)) m.set(es, en);
    }
    if (m.size) break;
  }
  return m;
}

const EN = loadEnglish();

/** Spanish taxonomy label -> { fr, ht }. */
function loadFrHt(): Map<string, { fr: string; ht: string }> {
  for (const base of [resolve(process.cwd(), 'scripts/data'), resolve(process.cwd(), '..', 'scripts/data')]) {
    const p = resolve(base, 'taxonomy_fr_ht.json');
    if (existsSync(p)) return new Map(Object.entries(JSON.parse(readFileSync(p, 'utf8'))));
  }
  return new Map();
}

const FRHT = loadFrHt();

/** French / Haitian Creole: taxonomy names and option labels; anything unknown keeps the English name, then Spanish. */
function translateFrHt(v: any, l: 'fr' | 'ht', depth = 0): any {
  if (depth > 8 || v == null) return v;
  if (Array.isArray(v)) return v.map((x) => translateFrHt(x, l, depth + 1));
  if (typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
    const one = (es: string) => FRHT.get(es)?.[l] ?? EN.get(es) ?? es;
    const name = (val: string) => (FRHT.has(val) || EN.has(val) ? one(val) : val.includes(' · ') ? val.split(' · ').map(one).join(' · ') : val);
    const out: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === 'valueEn') continue;
      if (k === 'value' && typeof (v as any).valueEn === 'string' && typeof val === 'string') {
        out.value = FRHT.get(val)?.[l] ?? (v as any).valueEn;
        continue;
      }
      // Attribute options / facets carry { label, labelEn }: the label shown is the localized one.
      if (k === 'label' && typeof val === 'string' && 'labelEn' in (v as any) && FRHT.has(val)) {
        out.label = FRHT.get(val)![l];
        continue;
      }
      if (typeof val === 'string' && FIELDS.has(k) && !(k === 'name' && isEditableOption(v))) out[k] = name(val);
      else out[k] = translateFrHt(val, l, depth + 1);
    }
    return out;
  }
  return v;
}

function translate(v: any, depth = 0): any {
  if (depth > 8 || v == null) return v;
  if (Array.isArray(v)) return v.map((x) => translate(x, depth + 1));
  if (typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
    const out: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === 'valueEn') continue;
      if (k === 'value' && typeof (v as any).valueEn === 'string') {
        out.value = (v as any).valueEn;
        continue;
      }
      if (typeof val === 'string' && FIELDS.has(k) && !(k === 'name' && isEditableOption(v))) out[k] = EN.get(val) ?? (val.includes(' · ') ? val.split(' · ').map((p) => EN.get(p) ?? p).join(' · ') : val);
      else out[k] = translate(val, depth + 1);
    }
    return out;
  }
  return v;
}

@Injectable()
export class CatalogLocaleInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest();
    const l = requestLocale(req);
    const isObj = (b: any) => b && typeof b === 'object' && !Buffer.isBuffer(b);
    // Variant words (Color, Rojo, Red, Mediano...) first, in whatever language the seller typed them.
    if (l === 'fr' || l === 'ht') return next.handle().pipe(map((body) => (isObj(body) ? translateFrHt(translateVariants(body, l), l) : body)));
    if (l !== 'en') return next.handle().pipe(map((body) => (isObj(body) ? translateVariants(body, 'es') : body)));
    return next.handle().pipe(map((body) => (isObj(body) ? translate(translateVariants(body, 'en')) : body)));
  }
}
