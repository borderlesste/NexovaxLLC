#!/usr/bin/env node
/**
 * Browser smoke test (Playwright/Chromium). Needs no seeded accounts:
 *  - visits the public screens in each language (es, en, fr, ht);
 *  - checks the page language, an expected translated text, HTTP status,
 *    uncaught exceptions, console errors and failing API calls (5xx);
 *  - optional signed-in pass when E2E_EMAIL and E2E_PASSWORD are set.
 * Usage: pnpm e2e [--shots dir]   (web on :3000, API on :4000; WEB_URL / API_URL to override)
 * Exits with code 1 when anything fails.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000/api';
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// Dictionaries, to know what each text looks like in every language.
const DIR = new URL('../frontend/src/lib/i18n/', import.meta.url).pathname;
const read = (f) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const DICT = {
  en: Object.assign({}, ...readdirSync(DIR).filter((f) => /^en-\d+\.json$/.test(f)).map(read)),
  fr: read('fr.json'),
  ht: read('ht.json'),
};
const tr = (lang, es) => (lang === 'es' ? es : DICT[lang][es] ?? es);

const problems = [];
let checks = 0;
const fail = (m) => problems.push(m);

const first = async (path, pick) => {
  const r = await fetch(`${API}${path}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  return r ? pick(r) : null;
};
const productSlug = await first('/products?pageSize=1', (r) => r.items?.[0]?.slug);
const storeSlug = await first('/sellers', (r) => r[0]?.slug);

// [path, Spanish text expected on the page (translated per language)]
const SCREENS = [
  ['/', null],
  ['/catalogo', null],
  productSlug && [`/producto/${productSlug}`, 'Agregar al carrito'],
  storeSlug && [`/tienda/${storeSlug}`, null],
  ['/vendedores', null],
  ['/ayuda', 'Centro de ayuda'],
  ['/ayuda/reportar', null],
  ['/carrito', null],
  ['/auth/iniciar-sesion', 'Iniciar sesión'],
  ['/auth/registrarse', 'Crear cuenta'],
].filter(Boolean);

const browser = await chromium.launch();

async function open(lang, who) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: { es: 'es-ES', en: 'en-US', fr: 'fr-FR', ht: 'fr-HT' }[lang] });
  await ctx.addCookies([{ name: 'nx_locale', value: lang, url: BASE }]);
  const page = await ctx.newPage();
  const tag = `[${lang}${who ? ` ${who}` : ''}]`;
  page.on('pageerror', (e) => fail(`${tag} exception: ${e.message.slice(0, 200)} @ ${page.url()}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource|Download the React DevTools/.test(m.text()) && fail(`${tag} console: ${m.text().slice(0, 200)} @ ${page.url()}`));
  page.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && fail(`${tag} API ${r.status()} ${r.url().replace(BASE, '')}`));
  return { ctx, page, tag };
}

async function visit({ page, tag }, lang, path, expect) {
  checks++;
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' }).catch((e) => (fail(`${tag} ${path}: ${e.message.split('\n')[0]}`), null));
  if (!res) return;
  if (res.status() >= 400) fail(`${tag} ${path}: HTTP ${res.status()}`);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  const htmlLang = await page.getAttribute('html', 'lang');
  if (htmlLang !== lang) fail(`${tag} ${path}: page language is "${htmlLang}"`);
  if (expect) {
    const text = tr(lang, expect);
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 }).catch(() => fail(`${tag} ${path}: missing "${text}"`));
  }
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${lang}${path.replace(/[^a-z0-9]+/gi, '_')}.png`), fullPage: true });
  console.log('✔', tag, path);
}

for (const lang of ['es', 'en', 'fr', 'ht']) {
  const s = await open(lang);
  for (const [path, expect] of SCREENS) await visit(s, lang, path, expect);
  await s.ctx.close();
}

// Optional: a real account you provide (never stored in the repository).
if (process.env.E2E_EMAIL && process.env.E2E_PASSWORD) {
  const s = await open('es', 'signed-in');
  await s.page.goto(`${BASE}/auth/iniciar-sesion`);
  await s.page.locator('input[type="email"], input[name="email"]').first().fill(process.env.E2E_EMAIL);
  await s.page.locator('input[type="password"]').first().fill(process.env.E2E_PASSWORD);
  await s.page.getByRole('button', { name: 'Iniciar sesión' }).last().click();
  const ok = await s.page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 20000 }).then(() => true, () => false);
  if (!ok) fail('[signed-in] login did not complete');
  else for (const [path, expect] of [['/cuenta/perfil', null], ['/cuenta/pedidos', 'Mis pedidos'], ['/cuenta/mensajes', null], ['/cuenta/notificaciones', null]]) await visit(s, 'es', path, expect);
  await s.ctx.close();
}

await browser.close();
console.log(`\n${checks} screens checked, ${problems.length} problem(s).`);
for (const p of problems) console.log('✖', p);
process.exit(problems.length ? 1 : 0);
