import { defaultHomeLayout, HOME_SECTION_KEYS, normalizeHomeLayout } from '../src/catalog/home-layout';

describe('home layout', () => {
  it('starts with every section enabled, in the default order', () => {
    const l = defaultHomeLayout();
    expect(l.sections.map((s) => s.key)).toEqual([...HOME_SECTION_KEYS]);
    expect(l.sections.every((s) => s.enabled)).toBe(true);
    expect(l.avoidRepeats).toBe(true);
    expect(l.sections.find((s) => s.key === 'best_sellers')?.days).toBe(30);
  });

  it('keeps the saved order and appends sections added later', () => {
    const l = normalizeHomeLayout({ avoidRepeats: false, sections: [{ key: 'deals', enabled: false, limit: 8 }, { key: 'categories', enabled: true }] });
    expect(l.sections.slice(0, 2).map((s) => s.key)).toEqual(['deals', 'categories']);
    expect(l.sections[0]).toMatchObject({ enabled: false, limit: 8 });
    expect(l.sections).toHaveLength(HOME_SECTION_KEYS.length);
    expect(l.avoidRepeats).toBe(false);
  });

  it('drops unknown and duplicate sections and clamps values', () => {
    const l = normalizeHomeLayout({
      sections: [
        { key: 'nope', enabled: true },
        { key: 'best_sellers', limit: 999, days: -5, title: 'x'.repeat(200) },
        { key: 'best_sellers', limit: 4 },
        { key: 'price_ranges', thresholds: [50, 'a', 10, 10, -1] },
        { key: 'flash_deals', endsAt: 'not a date', minDiscount: 200 },
        { key: 'top_stores', minRating: 9 },
      ],
    });
    const by = Object.fromEntries(l.sections.map((s) => [s.key, s]));
    expect(by.nope).toBeUndefined();
    expect(l.sections.filter((s) => s.key === 'best_sellers')).toHaveLength(1);
    expect(by.best_sellers).toMatchObject({ limit: 24, days: 0 });
    expect(by.best_sellers.title).toHaveLength(80);
    expect(by.price_ranges.thresholds).toEqual([10, 50]);
    expect(by.flash_deals).toMatchObject({ endsAt: null, minDiscount: 95 });
    expect(by.top_stores.minRating).toBe(5);
  });

  it('falls back to defaults for garbage', () => {
    expect(normalizeHomeLayout(null)).toEqual(defaultHomeLayout());
    expect(normalizeHomeLayout('x')).toEqual(defaultHomeLayout());
  });
});
