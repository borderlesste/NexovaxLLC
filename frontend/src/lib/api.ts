'use client';
import { supabase } from './supabase';
import { getLocale, t as tr } from './i18n';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
  ) {
    super(message);
  }
}

let sellerContext: string | null = null;
export const setSellerContext = (id: string | null) => {
  sellerContext = id;
};

async function token() {
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Calls the NestJS API through the same-origin /api proxy, attaching the Supabase JWT. */
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const t = await token();
  if (t) headers.set('Authorization', `Bearer ${t}`);
  if (sellerContext) headers.set('x-seller-id', sellerContext);
  headers.set('x-locale', getLocale());
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body, cache: 'no-store' });
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg =
      (typeof data === 'object' && (data?.message || data?.error)) ||
      (res.status === 401 ? tr('Debes iniciar sesión.') : tr('Ocurrió un error inesperado.'));
    throw new ApiError(res.status, data?.code ?? 'ERROR', Array.isArray(msg) ? msg.join(', ') : msg, data?.details);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'POST', json: json ?? {} });
export const put = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'PUT', json: json ?? {} });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
export const upload = <T = any>(p: string, form: FormData) => api<T>(p, { method: 'POST', body: form });

export function errorMessage(e: unknown) {
  if (e instanceof ApiError) {
    if (e.details && Array.isArray(e.details) && e.details[0]?.errors) return `${e.message} ${e.details.map((d: any) => d.errors.join(' ')).join(' ')}`;
    return e.message;
  }
  return (e as any)?.message ?? tr('Ocurrió un error inesperado.');
}
