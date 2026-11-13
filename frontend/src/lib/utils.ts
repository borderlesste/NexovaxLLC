import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getCurrency, getIntlLocale, getLocale, t } from './i18n';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SYMBOLS: Record<string, string> = { USD: 'US$', EUR: '€', GBP: '£', CAD: 'CA$', MXN: 'MX$', DOP: 'RD$', COP: 'COL$', CLP: 'CLP$', PEN: 'S/', ARS: 'AR$', BRL: 'R$' };

/** Currency symbol (e.g. "US$", "€"); English shows "$" for the US dollar. */
export function currencySymbol(currency?: string) {
  const cur = currency || getCurrency();
  if (cur === 'USD' && getLocale() === 'en') return '$';
  return SYMBOLS[cur] ?? cur;
}

/** Locale-aware currency formatting; amounts arrive as exact decimal strings from the API. */
export function money(v: string | number | null | undefined, currency?: string) {
  const n = Number(v ?? 0);
  const cur = currency || getCurrency();
  const digits = cur === 'CLP' ? 0 : 2;
  const num = new Intl.NumberFormat(getIntlLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(n));
  const sym = currencySymbol(cur);
  return `${n < 0 ? '-' : ''}${sym}${getLocale() === 'en' && sym.length <= 2 ? '' : '\u00a0'}${num}`;
}

export function num(v: number | string) {
  return new Intl.NumberFormat(getIntlLocale()).format(Number(v));
}

export function compact(v: number | string) {
  return new Intl.NumberFormat(getIntlLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(Number(v));
}

export function pct(v: number | null | undefined, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)} %`;
}

const fmt = (d: string | Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(getIntlLocale(), o).format(new Date(d));
export const fmtDate = (d?: string | Date | null) => (d ? fmt(d, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d?: string | Date | null) => (d ? fmt(d, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtTime = (d?: string | Date | null) => (d ? fmt(d, { hour: '2-digit', minute: '2-digit' }) : '');
export const fmtDay = (d: string | Date, o: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' }) => fmt(d, o);

export function relative(d?: string | Date | null) {
  if (!d) return '';
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return t('Hace un momento');
  if (diff < 3600) return t('Hace {n} min', { n: Math.floor(diff / 60) });
  if (diff < 86400) return t('Hace {n} h', { n: Math.floor(diff / 3600) });
  if (diff < 172800) return t('Ayer');
  return fmtDate(d);
}

export function initials(name?: string | null) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function uid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
