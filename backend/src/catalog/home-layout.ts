/**
 * Home page layout (Admin → Configuración → Portada): which sections the home page shows, in which
 * order, with which title and how many items. Every section starts enabled; a section with nothing to
 * show is hidden on its own (no sales in the window, no store flash deal running, no preorders...).
 */
export const HOME_SECTION_KEYS = [
  'categories',
  'recommended',
  'flash_deals',
  'best_sellers',
  'featured',
  'new_arrivals',
  'recently_viewed',
  'deals',
  'category_rows',
  'top_stores',
  'preorders',
  'price_ranges',
  'seller_banner',
  'guarantees',
] as const;

export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

export interface HomeSection {
  key: HomeSectionKey;
  enabled: boolean;
  /** Custom title (empty = the default title, translated). One per language; empty languages use the default. */
  title: string;
  titleEn?: string;
  titleFr?: string;
  titleHt?: string;
  /** Items shown: products, stores or categories (products per row in category_rows / price_ranges). */
  limit: number;
  /** best_sellers: sales window in days. new_arrivals: only products published in the last N days (0 = any). */
  days?: number;
  /** category_rows: how many categories get a row. */
  rows?: number;
  /** category_rows: slugs of the categories, in order (empty = the main categories with most products). */
  categories?: string[];
  /** top_stores: minimum average rating (0 = any). */
  minRating?: number;
  /** flash_deals: minimum discount (%) a store must give to create a flash deal. */
  minDiscount?: number;
  /** flash_deals: longest a store's flash deal may last, in hours. */
  maxHours?: number;
  /** flash_deals: flash deals one store may have running or scheduled at the same time. */
  maxPerSeller?: number;
  /** price_ranges: "Menos de X" amounts, in the marketplace currency. */
  thresholds?: number[];
}

export interface HomeLayout {
  /** Skip a product in a section when a section above already shows it (as long as the section keeps enough). */
  avoidRepeats: boolean;
  sections: HomeSection[];
}

/** Limits per section: [default, min, max]. */
const LIMITS: Record<HomeSectionKey, [number, number, number]> = {
  categories: [9, 3, 19],
  recommended: [12, 4, 24],
  flash_deals: [6, 2, 24],
  best_sellers: [12, 4, 24],
  featured: [12, 4, 24],
  new_arrivals: [12, 4, 24],
  recently_viewed: [12, 4, 24],
  deals: [6, 2, 24],
  category_rows: [6, 2, 12],
  top_stores: [8, 2, 16],
  preorders: [6, 2, 24],
  price_ranges: [6, 2, 12],
  seller_banner: [0, 0, 0],
  guarantees: [0, 0, 0],
};

const EXTRA: Partial<Record<HomeSectionKey, Partial<HomeSection>>> = {
  best_sellers: { days: 30 },
  new_arrivals: { days: 0 },
  category_rows: { rows: 4, categories: [] },
  top_stores: { minRating: 0 },
  flash_deals: { minDiscount: 10, maxHours: 72, maxPerSeller: 10 },
  price_ranges: { thresholds: [10, 25, 50] },
};

export function defaultHomeLayout(): HomeLayout {
  return {
    avoidRepeats: true,
    sections: HOME_SECTION_KEYS.map((key) => ({ key, enabled: true, title: '', limit: LIMITS[key][0], ...structuredClone(EXTRA[key] ?? {}) })),
  };
}

const int = (v: unknown, d: number, min: number, max: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const text = (v: unknown, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Valid layout from whatever is stored: unknown keys dropped, numbers clamped, and sections added after the
 * admin last saved appended (enabled) at the end, so new sections show up without a migration.
 */
export function normalizeHomeLayout(raw: unknown): HomeLayout {
  const base = defaultHomeLayout();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<HomeLayout>;
  const seen = new Set<string>();
  const sections: HomeSection[] = [];
  for (const s of Array.isArray(r.sections) ? r.sections : []) {
    if (!s || !HOME_SECTION_KEYS.includes(s.key as HomeSectionKey) || seen.has(s.key)) continue;
    seen.add(s.key);
    const key = s.key as HomeSectionKey;
    const [d, min, max] = LIMITS[key];
    const out: HomeSection = {
      key,
      enabled: s.enabled !== false,
      title: text(s.title), titleEn: text(s.titleEn), titleFr: text(s.titleFr), titleHt: text(s.titleHt),
      limit: int(s.limit, d, min, max),
    };
    const ex = EXTRA[key] ?? {};
    if ('days' in ex) out.days = int(s.days, ex.days!, 0, 365);
    if ('rows' in ex) out.rows = int(s.rows, ex.rows!, 1, 12);
    if ('categories' in ex)
      out.categories = [...new Set((Array.isArray(s.categories) ? s.categories : []).map((c) => text(c, 120)).filter(Boolean))].slice(0, 12);
    if ('minRating' in ex) out.minRating = Math.min(5, Math.max(0, Math.round(Number(s.minRating ?? 0) * 10) / 10 || 0));
    if ('minDiscount' in ex) out.minDiscount = int(s.minDiscount, ex.minDiscount!, 1, 95);
    if ('maxHours' in ex) out.maxHours = int(s.maxHours, ex.maxHours!, 1, 336);
    if ('maxPerSeller' in ex) out.maxPerSeller = int(s.maxPerSeller, ex.maxPerSeller!, 1, 100);
    if ('thresholds' in ex) {
      const t = [...new Set((Array.isArray(s.thresholds) ? s.thresholds : []).map(Number).filter((n) => Number.isFinite(n) && n > 0 && n < 1e7))]
        .map((n) => Math.round(n * 100) / 100)
        .sort((a, b) => a - b)
        .slice(0, 6);
      out.thresholds = t.length ? t : [...ex.thresholds!];
    }
    sections.push(out);
  }
  for (const s of base.sections) if (!seen.has(s.key)) sections.push(s);
  return { avoidRepeats: r.avoidRepeats !== false, sections };
}
