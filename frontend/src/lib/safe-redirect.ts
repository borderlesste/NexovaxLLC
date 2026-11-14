/**
 * Post-authentication destinations must stay inside this application.
 * Accepts only same-origin relative paths ("/x", not "//host" or "/\host"); anything else → "/".
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || /[\u0000-\u001f\\]/.test(value)) return fallback;
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const url = new URL(value, base);
    if (url.origin !== base || !/^https?:$/.test(url.protocol)) return fallback;
    if (url.pathname.startsWith('/auth/')) return fallback; // never bounce back into the auth pages
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
