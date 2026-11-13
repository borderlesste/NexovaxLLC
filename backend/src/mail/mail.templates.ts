/**
 * Spanish transactional e-mail templates. Table-based, inline-styled HTML so
 * they render consistently in Gmail, Outlook and mobile clients. Every dynamic
 * value goes through `esc()`.
 */
import { config } from '../config';

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const fmt = new Intl.NumberFormat('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (amount: string | number | null | undefined, currency = 'DOP') =>
  `${currency === 'DOP' ? 'RD$' : currency + ' '} ${fmt.format(Number(amount ?? 0))}`;

const BRAND = '#5b21e6';

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

interface LayoutInput {
  subject: string;
  preheader: string;
  title: string;
  /** Pre-escaped HTML blocks. */
  body: string;
  cta?: { label: string; url: string };
  /** Plain-text version (unescaped). */
  text: string;
  footerNote?: string;
}

export function layout(i: LayoutInput): Rendered {
  const cta = i.cta
    ? `<tr><td style="padding:8px 0 24px"><a href="${esc(i.cta.url)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${esc(i.cta.label)}</a></td></tr>`
    : '';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(i.subject)}</title></head>
<body style="margin:0;background:#f4f2fb;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1e1b2e">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(i.preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f2fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e7e3f5">
<tr><td style="background:${BRAND};padding:18px 28px;color:#fff;font-size:18px;font-weight:800">RD Marketplace <span style="font-weight:400;opacity:.85;font-size:13px">Multivendedor</span></td></tr>
<tr><td style="padding:28px 28px 8px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
<tr><td style="font-size:22px;font-weight:800;padding-bottom:12px">${esc(i.title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6">${i.body}</td></tr>
${cta}
</table></td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #eee;font-size:12px;color:#7a7590;line-height:1.5">
${i.footerNote ? esc(i.footerNote) + '<br>' : ''}Este es un correo automático de RD Marketplace. Si necesitas ayuda visita <a href="${esc(config.webUrl)}/ayuda" style="color:${BRAND}">el centro de ayuda</a>.
</td></tr></table></td></tr></table></body></html>`;
  const text = `${i.title}\n\n${i.text}${i.cta ? `\n\n${i.cta.label}: ${i.cta.url}` : ''}\n\n— RD Marketplace`;
  return { subject: i.subject, html, text };
}

export const p = (s: string) => `<p style="margin:0 0 14px">${s}</p>`;

/** Two-column summary table; values are pre-escaped HTML. */
export function rows(items: Array<[string, string]>, opts: { boldLast?: boolean } = {}) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 18px;border-collapse:collapse;font-size:14px">${items
    .map(([k, v], idx) => {
      const strong = opts.boldLast && idx === items.length - 1;
      return `<tr><td style="padding:7px 0;border-bottom:1px solid #f0eef7;color:#5f5a73${strong ? ';font-weight:700;color:#1e1b2e' : ''}">${esc(k)}</td><td align="right" style="padding:7px 0;border-bottom:1px solid #f0eef7${strong ? ';font-weight:800' : ''}">${v}</td></tr>`;
    })
    .join('')}</table>`;
}

export interface ItemLine {
  title: string;
  variant?: string | null;
  quantity: number;
  total: string;
}

export function itemsTable(items: ItemLine[], currency: string) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 18px;border-collapse:collapse;font-size:14px">
<tr><th align="left" style="padding:6px 0;border-bottom:2px solid #e7e3f5;color:#5f5a73;font-weight:600">Producto</th><th align="center" style="padding:6px 0;border-bottom:2px solid #e7e3f5;color:#5f5a73;font-weight:600">Cant.</th><th align="right" style="padding:6px 0;border-bottom:2px solid #e7e3f5;color:#5f5a73;font-weight:600">Total</th></tr>
${items
  .map(
    (it) =>
      `<tr><td style="padding:8px 0;border-bottom:1px solid #f0eef7">${esc(it.title)}${it.variant ? `<br><span style="color:#7a7590;font-size:12px">${esc(it.variant)}</span>` : ''}</td><td align="center" style="padding:8px 0;border-bottom:1px solid #f0eef7">${it.quantity}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #f0eef7;white-space:nowrap">${esc(money(it.total, currency))}</td></tr>`,
  )
  .join('')}</table>`;
}

export const itemsText = (items: ItemLine[], currency: string) =>
  items.map((it) => `- ${it.title}${it.variant ? ` (${it.variant})` : ''} x${it.quantity}: ${money(it.total, currency)}`).join('\n');
