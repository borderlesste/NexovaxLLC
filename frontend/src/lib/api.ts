'use client';
import { supabase } from './supabase';
import { getLocale, t as tr } from './i18n';
import { analyticsAllowed } from './consent';

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

/**
 * Public origin of the NestJS API (e.g. https://api.nexovax.com). File uploads and private
 * downloads go straight there instead of through the /api proxy of the web host, whose
 * request/response size limits (≈4.5 MB on Vercel) would cut them. Unset: everything uses /api.
 */
const DIRECT_API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '').replace(/\/api$/, '');
const apiUrl = (path: string, direct?: boolean) => `${direct && DIRECT_API ? DIRECT_API : ''}/api${path}`;

/** Calls the NestJS API through the same-origin /api proxy (or directly, see DIRECT_API), attaching the Supabase JWT. */
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown; direct?: boolean } = {}): Promise<T> {
  const { direct, json, ...rest } = init;
  const headers = new Headers(init.headers);
  const t = await token();
  if (t) headers.set('Authorization', `Bearer ${t}`);
  if (sellerContext && !headers.has('x-seller-id')) headers.set('x-seller-id', sellerContext);
  headers.set('x-locale', getLocale());
  if (analyticsAllowed()) headers.set('x-nx-consent', 'analytics');
  let body = rest.body;
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }
  const res = await fetch(apiUrl(path, direct), { ...rest, headers, body, cache: 'no-store' });
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
/** POST to a Turnstile-protected endpoint (register, password recovery, resend verification). */
export const postWithCaptcha = <T = any>(p: string, json: unknown, captchaToken: string | null) =>
  api<T>(p, { method: 'POST', json, headers: captchaToken ? { 'cf-turnstile-response': captchaToken } : undefined });
export const put = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'PUT', json: json ?? {} });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
export const upload = <T = any>(p: string, form: FormData) => api<T>(p, { method: 'POST', body: form, direct: true });

export function errorMessage(e: unknown) {
  if (e instanceof ApiError) {
    if (e.details && Array.isArray(e.details) && e.details[0]?.errors) return `${e.message} ${e.details.map((d: any) => d.errors.join(' ')).join(' ')}`;
    return e.message;
  }
  return (e as any)?.message ?? tr('Ocurrió un error inesperado.');
}

/** Downloads a private file (attachments, evidence) with the session token and returns a blob URL. */
export async function fetchBlobUrl(path: string): Promise<string> {
  const headers = new Headers();
  const t = await token();
  if (t) headers.set('Authorization', `Bearer ${t}`);
  if (sellerContext) headers.set('x-seller-id', sellerContext);
  const res = await fetch(apiUrl(path, true), { headers, cache: 'no-store' });
  if (!res.ok) throw new ApiError(res.status, 'FILE_ERROR', tr('No se pudo abrir el archivo.'));
  return URL.createObjectURL(await res.blob());
}
