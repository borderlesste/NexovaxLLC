#!/usr/bin/env node
/**
 * NX-GEO-001 acceptance checks (delivery country, availability by destination, guest cart).
 * Needs no accounts and writes nothing: only public reads and the guest-cart preview.
 *
 *   pnpm e2e:geo                                   web on :3000, API on :4000
 *   WEB_URL=https://nexovax.com API_URL=https://api.nexovax.com/api pnpm e2e:geo
 *
 * Exits with code 1 when any check fails. Each line names the acceptance case it covers.
 */
import { chromium } from '@playwright/test';

const BASE = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
const problems = [];
let passed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log('✔', name); } else { problems.push(`${name}${detail ? `: ${detail}` : ''}`); console.log('✖', name, detail); }
};
const STATUSES = ['AVAILABLE', 'UNAVAILABLE', 'UNCONFIRMED'];

async function call(path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body, headers: r.headers };
}

// ------------------------------------------------------------------ API
const products = (await call('/products?pageSize=5')).body?.items ?? [];
const productIds = products.map((p) => p.id);
const product = products[0];

{
  const r = await call('/geo/context');
  ok('Primera visita: hay destino sin registrarse', r.status === 200 && /^[A-Z]{2}$/.test(r.body?.deliveryCountry ?? ''), JSON.stringify(r.body));
  ok('Primera visita: el destino es sugerido (IP o predeterminado)', ['ip', 'default'].includes(r.body?.source) && r.body?.isApproximate === true, JSON.stringify(r.body));
  ok('Caché: el contexto no se guarda en cachés compartidas', /no-store/.test(r.headers.get('cache-control') ?? ''), r.headers.get('cache-control') ?? '');
  const def = r.body?.deliveryCountry;
  const other = def === 'DO' ? 'US' : 'DO';
  const m = await call('/geo/context', { headers: { cookie: `nx_delivery_country=${other}` } });
  ok('Cambio manual: la elección del visitante prevalece sobre la IP', m.body?.deliveryCountry === other && m.body?.source === 'manual' && m.body?.isApproximate === false, JSON.stringify(m.body));
  const bad = await call('/geo/context', { headers: { cookie: 'nx_delivery_country=ZZ' } });
  ok('Manipulación: una cookie con un país inválido se ignora', bad.body?.source !== 'manual', JSON.stringify(bad.body));
  const forged = await call('/geo/context', { headers: { 'x-nx-ip-country': 'AQ', 'x-vercel-ip-country': 'AQ', 'cf-ipcountry': 'AQ' } });
  ok('Manipulación: los encabezados de país enviados por el cliente no se aceptan', forged.body?.detectedCountry !== 'AQ', JSON.stringify(forged.body));
  const lang = await call('/geo/context', { headers: { cookie: `nx_locale=en; nx_delivery_country=${other}` } });
  ok('Idioma distinto del país: las preferencias son independientes', lang.body?.deliveryCountry === other, JSON.stringify(lang.body));
}

if (productIds.length) {
  const a = await call('/geo/availability', { method: 'POST', body: JSON.stringify({ country: 'DO', productIds }) });
  const items = Object.values(a.body?.items ?? {});
  ok('Disponibilidad por producto para un destino', a.status < 300 && items.length === productIds.length && items.every((x) => STATUSES.includes(x.status) && x.reason), JSON.stringify(a.body)?.slice(0, 300));
  ok('Caché: la disponibilidad no se guarda en cachés compartidas', /no-store/.test(a.headers.get('cache-control') ?? ''));
  const br = await call('/geo/availability', { method: 'POST', body: JSON.stringify({ country: 'BR', productIds }) });
  ok('Cambio de destino: se vuelve a evaluar para el nuevo país', br.body?.country === 'BR' && Object.keys(br.body?.items ?? {}).length === productIds.length);
  const inv = await call('/geo/availability', { method: 'POST', body: JSON.stringify({ country: 'ZZ', productIds }) });
  ok('Manipulación: un país inválido se rechaza', inv.status === 400, String(inv.status));
  const many = await call('/geo/availability', { method: 'POST', body: JSON.stringify({ country: 'DO', productIds: Array.from({ length: 101 }, () => productIds[0]) }) });
  ok('Manipulación: más de 100 productos por consulta se rechaza', many.status === 400, String(many.status));
} else console.log('… sin productos publicados: se omiten las pruebas de disponibilidad');

{
  const variant = product ? (await call(`/products/${product.slug}`)).body?.variants?.[0]?.id : null;
  if (variant) {
    const p = await call('/cart/preview', { method: 'POST', body: JSON.stringify({ items: [{ variantId: variant, quantity: 1 }, { variantId: variant, quantity: 1 }] }) });
    const line = p.body?.groups?.[0]?.items?.[0];
    ok('Carrito sin registro: se calcula sin cuenta', p.status < 300 && p.body?.guest === true && line?.quantity === 2, JSON.stringify(p.body)?.slice(0, 300));
  }
  const fake = await call('/cart/preview', { method: 'POST', body: JSON.stringify({ items: [{ variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 }] }) });
  ok('Carrito sin registro: una variante inexistente no expone datos', fake.status < 300 && (fake.body?.groups ?? []).length === 0);
  for (const [name, path, method] of [
    ['carrito de la cuenta', '/cart', 'GET'],
    ['unir carrito', '/cart/merge', 'POST'],
    ['checkout', '/checkout/quote', 'POST'],
    ['preferencia de la cuenta', '/me/delivery-country', 'PUT'],
    ['destinos de la tienda', '/seller/store/destinations', 'PUT'],
  ]) {
    const r = await call(path, { method, body: method === 'GET' ? undefined : JSON.stringify({ items: [], mode: 'ALL', country: 'DO' }) });
    ok(`Acceso anónimo: ${name} exige sesión`, r.status === 401, String(r.status));
  }
}

// ------------------------------------------------------------------ browser
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'es-ES' });
await ctx.addCookies([{ name: 'nx_consent', value: '1', url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
const availabilityCalls = [];
page.on('request', (r) => r.url().includes('/api/geo/availability') && availabilityCalls.push(r.postDataJSON?.()?.country));

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
const trigger = page.locator('[data-delivery-country]').first();
await trigger.waitFor({ timeout: 20000 }).catch(() => undefined);
const first = await trigger.getAttribute('data-delivery-country').catch(() => null);
ok('Navegador: el encabezado muestra el destino', !!first, String(first));
const htmlLang = await page.getAttribute('html', 'lang');
const target = first === 'DO' ? 'US' : 'DO';
await trigger.click();
await page.getByPlaceholder('Buscar país').fill(target === 'DO' ? 'Dominicana' : 'Estados Unidos');
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
const cookie = (await ctx.cookies()).find((c) => c.name === 'nx_delivery_country')?.value;
ok('Navegador: el cambio de destino se guarda en la cookie nx_delivery_country', cookie === target, String(cookie));
ok('Navegador: cambiar el destino no cambia el idioma', (await page.getAttribute('html', 'lang')) === htmlLang);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
ok('Nueva visita: se recupera la preferencia', (await page.locator('[data-delivery-country]').first().getAttribute('data-delivery-country')) === target);

if (product) {
  availabilityCalls.length = 0;
  await page.goto(`${BASE}/producto/${product.slug}`, { waitUntil: 'domcontentloaded' });
  const panel = page.locator('[role="status"][data-availability]').first();
  await panel.waitFor({ timeout: 20000 }).catch(() => undefined);
  ok('Ficha del producto: muestra la disponibilidad para el destino', STATUSES.includes((await panel.getAttribute('data-availability').catch(() => '')) ?? ''));
  ok('Caché: la disponibilidad pedida corresponde al destino elegido', availabilityCalls.length > 0 && availabilityCalls.every((c) => c === target), JSON.stringify(availabilityCalls));
  const add = page.getByRole('button', { name: 'Agregar al carrito' });
  if (await add.isEnabled().catch(() => false)) {
    await add.click();
    await page.waitForTimeout(800);
    const stored = await page.evaluate(() => localStorage.getItem('nx_guest_cart'));
    ok('Carrito sin registro: el visitante añade un producto', !!stored && stored.includes('variantId'), String(stored));
    await page.goto(`${BASE}/carrito`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-cart-destination]').waitFor({ timeout: 20000 }).catch(() => undefined);
    ok('Carrito: muestra el destino y los productos del invitado', await page.locator('[data-cart-destination]').isVisible().catch(() => false));
    ok('Carrito: para pagar se pide iniciar sesión', await page.getByText('Inicia sesión para pagar').first().isVisible().catch(() => false));
  } else console.log('… el producto está agotado: se omite añadir al carrito');
}
await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
await page.waitForURL((u) => u.pathname.startsWith('/auth/iniciar-sesion'), { timeout: 20000 }).catch(() => undefined);
ok('Checkout: sin sesión redirige a iniciar sesión', new URL(page.url()).pathname.startsWith('/auth/iniciar-sesion'), page.url());
ok('Navegador: sin errores de JavaScript', errors.length === 0, errors.join(' | '));
await browser.close();

console.log(`\n${passed} correctas, ${problems.length} con problemas.`);
for (const p of problems) console.log('✖', p);
process.exit(problems.length ? 1 : 0);
