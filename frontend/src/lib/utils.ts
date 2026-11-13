import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const moneyFmt = new Intl.NumberFormat('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFmt = new Intl.NumberFormat('es-DO', { notation: 'compact', maximumFractionDigits: 1 });

/** RD$ 1,234.56 — amounts arrive as exact decimal strings from the API. */
export function money(v: string | number | null | undefined, currency = 'DOP') {
  const n = Number(v ?? 0);
  const prefix = currency === 'DOP' ? 'RD$' : currency === 'USD' ? 'US$' : currency;
  return `${n < 0 ? '-' : ''}${prefix} ${moneyFmt.format(Math.abs(n))}`;
}

export function compact(v: number | string) {
  return compactFmt.format(Number(v));
}

export function pct(v: number | null | undefined, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)} %`;
}

const dateFmt = new Intl.DateTimeFormat('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('es-DO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('es-DO', { hour: '2-digit', minute: '2-digit' });

export const fmtDate = (d?: string | Date | null) => (d ? dateFmt.format(new Date(d)) : '—');
export const fmtDateTime = (d?: string | Date | null) => (d ? dateTimeFmt.format(new Date(d)) : '—');
export const fmtTime = (d?: string | Date | null) => (d ? timeFmt.format(new Date(d)) : '');

export function relative(d?: string | Date | null) {
  if (!d) return '';
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return 'Hace un momento';
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'Ayer';
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
