/**
 * Transactional e-mail templates (Spanish / English). Table-based, inline-styled
 * HTML so they render consistently in Gmail, Outlook and mobile clients.
 * Every dynamic value goes through `esc()`.
 */
import { config } from '../config';

export type Locale = 'es' | 'en';

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const SYMBOLS: Record<string, string> = { USD: 'US$', EUR: '€', GBP: '£', CAD: 'CA$', MXN: 'MX$', DOP: 'RD$', COP: 'COL$', CLP: 'CLP$', PEN: 'S/', ARS: 'AR$', BRL: 'R$' };

/** Locale-aware currency formatting, e.g. "US$ 1,234.56" (es) / "$1,234.56" (en). */
export const money = (amount: string | number | null | undefined, currency = 'USD', locale: Locale = 'es') => {
  const n = Number(amount ?? 0);
  const digits = currency === 'CLP' ? 0 : 2;
  const num = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-419', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(n));
  const sym = currency === 'USD' && locale === 'en' ? '$' : SYMBOLS[currency] ?? currency;
  return `${n < 0 ? '-' : ''}${sym}${locale === 'en' && sym.length <= 2 ? '' : '\u00a0'}${num}`;
};

const BLUE = '#0a6cf5';
const ORANGE = '#f5901a';

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

interface LayoutInput {
  locale: Locale;
  subject: string;
  preheader: string;
  title: string;
  /** Pre-escaped HTML blocks. */
  body: string;
  cta?: { label: string; url: string };
  /** Plain-text version (unescaped). */
  text: string;
}

export function layout(i: LayoutInput): Rendered {
  const en = i.locale === 'en';
  const cta = i.cta
    ? `<tr><td style="padding:8px 0 24px"><a href="${esc(i.cta.url)}" style="display:inline-block;background:${BLUE};color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${esc(i.cta.label)}</a></td></tr>`
    : '';
  const footer = en
    ? `This is an automated message from NEXOVAX. Need help? Visit <a href="${esc(config.webUrl)}/ayuda" style="color:${BLUE}">our help center</a>.`
    : `Este es un correo automático de NEXOVAX. ¿Necesitas ayuda? Visita <a href="${esc(config.webUrl)}/ayuda" style="color:${BLUE}">el centro de ayuda</a>.`;
  const html = `<!doctype html><html lang="${i.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(i.subject)}</title></head>
<body style="margin:0;background:#f2f5fa;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(i.preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f5fa;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e3e8f0">
<tr><td style="background:#0b2450;padding:18px 28px;border-bottom:4px solid ${ORANGE}"><span style="color:#fff;font-size:20px;font-weight:900;letter-spacing:2px">NEXO<span style="color:${ORANGE}">VAX</span></span></td></tr>
<tr><td style="padding:28px 28px 8px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
<tr><td style="font-size:22px;font-weight:800;padding-bottom:12px">${esc(i.title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6">${i.body}</td></tr>
${cta}
</table></td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #eef1f6;font-size:12px;color:#64748b;line-height:1.5">${footer}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${i.title}\n\n${i.text}${i.cta ? `\n\n${i.cta.label}: ${i.cta.url}` : ''}\n\n— NEXOVAX`;
  return { subject: i.subject, html, text };
}

export const p = (s: string) => `<p style="margin:0 0 14px">${s}</p>`;

/** Two-column summary table; values are pre-escaped HTML. */
export function rows(items: Array<[string, string]>, opts: { boldLast?: boolean } = {}) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 18px;border-collapse:collapse;font-size:14px">${items
    .map(([k, v], idx) => {
      const strong = opts.boldLast && idx === items.length - 1;
      return `<tr><td style="padding:7px 0;border-bottom:1px solid #eef1f6;color:#475569${strong ? ';font-weight:700;color:#0f172a' : ''}">${esc(k)}</td><td align="right" style="padding:7px 0;border-bottom:1px solid #eef1f6${strong ? ';font-weight:800' : ''}">${v}</td></tr>`;
    })
    .join('')}</table>`;
}

export interface ItemLine {
  title: string;
  variant?: string | null;
  quantity: number;
  total: string;
}

export function itemsTable(items: ItemLine[], currency: string, locale: Locale) {
  const [h1, h2, h3] = locale === 'en' ? ['Product', 'Qty', 'Total'] : ['Producto', 'Cant.', 'Total'];
  const th = 'padding:6px 0;border-bottom:2px solid #e3e8f0;color:#475569;font-weight:600';
  const td = 'padding:8px 0;border-bottom:1px solid #eef1f6';
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 18px;border-collapse:collapse;font-size:14px">
<tr><th align="left" style="${th}">${h1}</th><th align="center" style="${th}">${h2}</th><th align="right" style="${th}">${h3}</th></tr>
${items
  .map(
    (it) =>
      `<tr><td style="${td}">${esc(it.title)}${it.variant ? `<br><span style="color:#64748b;font-size:12px">${esc(it.variant)}</span>` : ''}</td><td align="center" style="${td}">${it.quantity}</td><td align="right" style="${td};white-space:nowrap">${esc(money(it.total, currency, locale))}</td></tr>`,
  )
  .join('')}</table>`;
}

export const itemsText = (items: ItemLine[], currency: string, locale: Locale) =>
  items.map((it) => `- ${it.title}${it.variant ? ` (${it.variant})` : ''} x${it.quantity}: ${money(it.total, currency, locale)}`).join('\n');
