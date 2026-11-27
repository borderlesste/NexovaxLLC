/**
 * Small in-process cache with single-flight: while a value is being built, every caller waits for
 * the same promise instead of starting its own copy of the work (no stampede on expiry or restart).
 */
const entries = new Map<string, { at: number; value?: unknown; pending?: Promise<unknown> }>();
const MAX_ENTRIES = 500;

export async function cached<T>(key: string, ttlMs: number, build: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const e = entries.get(key);
  if (e && e.value !== undefined && now - e.at < ttlMs) return e.value as T;
  if (e?.pending) return e.pending as Promise<T>;
  const pending = build().then(
    (value) => {
      entries.set(key, { at: Date.now(), value });
      return value;
    },
    (err) => {
      const cur = entries.get(key);
      if (cur?.pending === pending) {
        if (cur.value !== undefined) entries.set(key, { at: cur.at, value: cur.value });
        else entries.delete(key);
      }
      throw err;
    },
  );
  entries.set(key, { at: e?.at ?? 0, value: e?.value, pending });
  if (entries.size > MAX_ENTRIES) {
    for (const [k, v] of entries) {
      if (!v.pending) entries.delete(k);
      if (entries.size <= MAX_ENTRIES / 2) break;
    }
  }
  return pending;
}

/** Drops cached values whose key starts with `prefix` (after an admin change). */
export function invalidateCached(prefix: string) {
  for (const k of entries.keys()) if (k.startsWith(prefix)) entries.delete(k);
}
