'use client';

/**
 * Products this browser opened, newest first (home "Vistos recientemente"). Kept only in this browser
 * (never sent to analytics); the visitor can clear it from the home page.
 */
const KEY = 'nx_recently_viewed';
const MAX = 24;
export const RECENTLY_VIEWED_EVENT = 'nx:recently-viewed';

export function recentlyViewed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberViewed(productId: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([productId, ...recentlyViewed().filter((x) => x !== productId)].slice(0, MAX)));
  } catch {
    /* storage unavailable */
  }
}

export function clearRecentlyViewed() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(RECENTLY_VIEWED_EVENT));
}
