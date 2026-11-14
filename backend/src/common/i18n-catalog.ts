import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { map } from 'rxjs';
import { requestLocale } from './i18n-errors';

/**
 * Catalog taxonomy is stored in Spanish (categories, attribute names). For
 * English clients the API returns the original English names. Only fields that
 * carry taxonomy names are translated; seller content (titles, descriptions)
 * is never touched.
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
      if (typeof val === 'string' && FIELDS.has(k)) out[k] = EN.get(val) ?? (val.includes(' · ') ? val.split(' · ').map((p) => EN.get(p) ?? p).join(' · ') : val);
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
    if (requestLocale(req) !== 'en' || !EN.size) return next.handle();
    return next.handle().pipe(map((body) => (body && typeof body === 'object' && !Buffer.isBuffer(body) ? translate(body) : body)));
  }
}
