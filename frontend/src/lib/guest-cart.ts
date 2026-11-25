'use client';
import { useSyncExternalStore } from 'react';

/**
 * Guest cart: what a visitor adds before signing in, kept only in this browser (no account, nothing
 * on the server). Prices, stock and availability come from POST /cart/preview; after sign-in the
 * lines are moved into the account's cart (POST /cart/merge). Paying always requires an account.
 */
export interface GuestLine {
  variantId: string;
  quantity: number;
}

const KEY = 'nx_guest_cart';
/** Identifies this guest cart when it is moved into an account, so a retried merge never adds it twice. */
const MERGE_KEY = 'nx_guest_cart_key';

const uuid = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const MAX_LINES = 50;
const listeners = new Set<() => void>();
let cache: GuestLine[] | null = null;

function read(): GuestLine[] {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    cache = Array.isArray(v)
      ? v.filter((l) => l && /^[0-9a-f-]{36}$/i.test(l.variantId) && Number.isInteger(l.quantity) && l.quantity > 0).slice(0, MAX_LINES)
      : [];
  } catch {
    cache = [];
  }
  return cache!;
}

function write(lines: GuestLine[]) {
  cache = lines.slice(0, MAX_LINES);
  try {
    if (cache.length) localStorage.setItem(KEY, JSON.stringify(cache));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the cart lives until the tab closes */
  }
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      cache = null;
      listeners.forEach((l) => l());
    }
  });

export const guestCart = {
  lines: read,
  add(variantId: string, quantity: number) {
    const lines = [...read()];
    const i = lines.findIndex((l) => l.variantId === variantId);
    if (i >= 0) lines[i] = { variantId, quantity: Math.min(999, lines[i].quantity + quantity) };
    else lines.push({ variantId, quantity: Math.min(999, quantity) });
    write(lines);
  },
  set(variantId: string, quantity: number) {
    write(read().map((l) => (l.variantId === variantId ? { variantId, quantity: Math.min(999, Math.max(1, quantity)) } : l)));
  },
  remove(variantId: string) {
    write(read().filter((l) => l.variantId !== variantId));
  },
  clear() {
    write([]);
    try { localStorage.removeItem(MERGE_KEY); } catch { /* storage blocked */ }
  },
  /** Stable key of the current guest cart (created on first use, dropped with the cart). */
  mergeKey() {
    try {
      const k = localStorage.getItem(MERGE_KEY);
      if (k && /^[0-9a-f-]{36}$/i.test(k)) return k;
      const n = uuid();
      localStorage.setItem(MERGE_KEY, n);
      return n;
    } catch {
      return uuid();
    }
  },
  count() {
    return read().reduce((a, l) => a + l.quantity, 0);
  },
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const EMPTY: GuestLine[] = [];

/** Current guest lines (re-renders on change, also from other tabs). */
export function useGuestCart() {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
