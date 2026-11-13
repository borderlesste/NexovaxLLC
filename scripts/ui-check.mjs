#!/usr/bin/env node
/**
 * UI smoke test: logs in through the real login screen for each role, visits
 * every screen, takes full-page screenshots and reports console errors,
 * uncaught exceptions and failing API calls.
 * Usage: node scripts/ui-check.mjs [outDir]   (web on :3000, API on :4000)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.argv[2] ?? 'ui-shots';
const PASSWORD = process.env.SEED_PASSWORD ?? 'RdDemo2026!';
mkdirSync(OUT, { recursive: true });

const problems = [];
const browser = await chromium.launch();

async function session(email, lang = 'es') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: lang === 'en' ? 'en-US' : 'es-ES' });
  await ctx.addCookies([{ name: 'nx_locale', value: lang, url: BASE }]);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && problems.push(`[${email ?? 'public'}] console: ${m.text().slice(0, 200)} @ ${page.url()}`));
  page.on('pageerror', (e) => problems.push(`[${email ?? 'public'}] exception: ${e.message.slice(0, 200)} @ ${page.url()}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) problems.push(`[${email ?? 'public'}] API ${r.status()} ${r.url().replace(BASE, '')}`);
  });
  if (email) {
    const en = lang === 'en';
    await page.goto(`${BASE}/auth/iniciar-sesion`);
    await page.getByPlaceholder(en ? 'E.g. user@email.com' : 'Ej. usuario@correo.com').fill(email);
    await page.getByPlaceholder(en ? 'Enter your password' : 'Ingresa tu contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: en ? 'Sign in' : 'Iniciar sesión' }).last().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 20000 });
  }
  return { ctx, page };
}

async function visit(page, path, name, waitFor) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  if (waitFor) await page.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 15000 }).catch(() => problems.push(`missing text "${waitFor}" on ${path}`));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('✔', name, path);
}


// public
{
  const { ctx, page } = await session(null);
  await visit(page, '/', 'C01-inicio', 'Explora por categorías');
  await visit(page, '/catalogo', 'catalogo', 'productos');
  await visit(page, '/producto/zapatillas-running-rd', 'C04-producto', 'Agregar al carrito');
  await visit(page, '/tienda/tienda-deportiva-rd', 'C06-tienda', 'Seguir tienda');
  await visit(page, '/vendedores', 'vendedores', 'Tiendas del marketplace');
  await visit(page, '/ayuda', 'ayuda', 'Centro de ayuda');
  await visit(page, '/ayuda/reportar', 'C08-reportar', 'Reportar un problema');
  await visit(page, '/auth/iniciar-sesion', 'C02-login', 'Iniciar sesión');
  await visit(page, '/auth/registrarse', 'C03-registro', 'Crear cuenta');
  await ctx.close();
}

// buyer
{
  const { ctx, page } = await session('juan.perez@demo.nexovax.com');
  await visit(page, '/producto/bocina-portatil-splash', 'comprador-producto', 'Agregar al carrito');
  await page.getByRole('button', { name: 'Agregar al carrito' }).click();
  await page.waitForTimeout(2500);
  await visit(page, '/carrito', 'carrito', 'Tu carrito');
  await visit(page, '/checkout', 'C05-checkout', 'Confirmar compra');
  await visit(page, '/mensajes', 'C07-mensajes', 'Conversaciones');
  await visit(page, '/cuenta/perfil', 'cuenta-perfil', 'Información personal');
  await visit(page, '/cuenta/pedidos', 'cuenta-pedidos', 'Mis pedidos');
  await page.locator('a[href^="/cuenta/pedidos/"]').first().click();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.getByText('Historial de eventos').first().waitFor({ timeout: 15000 }).catch(() => problems.push('order tracking did not render'));
  await page.screenshot({ path: `${OUT}/seguimiento-pedido.png`, fullPage: true });
  console.log('✔ seguimiento-pedido', page.url());
  await visit(page, '/cuenta/direcciones', 'cuenta-direcciones', 'Direcciones');
  await visit(page, '/cuenta/favoritos', 'cuenta-favoritos', 'Mis favoritos');
  await visit(page, '/cuenta/reportes', 'cuenta-reportes', 'Mis reportes');
  await ctx.close();
}

// seller
{
  const { ctx, page } = await session('deportiva@demo.nexovax.com');
  await visit(page, '/vendedor/dashboard', 'V01-dashboard-vendedor', 'Ventas de mi tienda');
  await visit(page, '/vendedor/productos', 'vendedor-productos', 'Productos');
  await page.locator('a[href*="/editar"]').first().click();
  await page.getByText('Información básica').first().waitFor({ timeout: 15000 }).catch(() => problems.push('product editor did not render'));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/V02-editar-producto.png`, fullPage: true });
  console.log('✔ V02-editar-producto', page.url());
  await visit(page, '/vendedor/productos/nuevo', 'V02-crear-producto', 'Crear producto');
  await visit(page, '/vendedor/inventario', 'V03-inventario', 'Inventario');
  await visit(page, '/vendedor/pedidos', 'vendedor-pedidos', 'Pedidos');
  await visit(page, '/vendedor/finanzas', 'V04-finanzas', 'Finanzas de mi tienda');
  await visit(page, '/vendedor/metodos-cobro', 'vendedor-metodos-cobro', 'Métodos de cobro');
  await visit(page, '/vendedor/mensajes', 'vendedor-mensajes', 'Conversaciones');
  await visit(page, '/vendedor/configuracion', 'vendedor-configuracion', 'Configuración de la tienda');
  await ctx.close();
}

// admin
{
  const { ctx, page } = await session('admin@demo.nexovax.com');
  await visit(page, '/admin/dashboard', 'A01-dashboard', 'Resumen de ventas');
  await visit(page, '/admin/productos', 'A02-productos', 'Productos registrados');
  await visit(page, '/admin/pedidos', 'A03-pedidos', 'Pedidos totales');
  await page.locator('a[href^="/admin/pedidos/"]').first().click();
  await page.getByText('Historial de eventos').first().waitFor({ timeout: 15000 }).catch(() => problems.push('admin order detail did not render'));
  await page.screenshot({ path: `${OUT}/admin-pedido-detalle.png`, fullPage: true });
  await visit(page, '/admin/vendedores', 'A04-vendedores', 'Vendedores registrados');
  await visit(page, '/admin/categorias', 'A05-categorias', 'Listado de categorías');
  await visit(page, '/admin/moderacion', 'A06-moderacion', 'Moderación de productos');
  await visit(page, '/admin/comisiones', 'A07-comisiones', 'Comisiones y payouts');
  await visit(page, '/admin/configuracion', 'A08-configuracion', 'Información del marketplace');
  await visit(page, '/admin/reportes', 'A09-reportes', 'Bandeja de reportes');
  await visit(page, '/admin/finanzas', 'A10-finanzas', 'Finanzas del marketplace');
  await visit(page, '/admin/usuarios', 'admin-usuarios', 'Usuarios');
  await ctx.close();
}

// English pass (buyer with live-rate checkout + order tracking, seller and admin)
{
  const { ctx, page } = await session(null, 'en');
  await visit(page, '/', 'EN-home', 'Browse by category');
  await visit(page, '/producto/audifonos-bluetooth-max', 'EN-product', 'Add to cart');
  await ctx.close();
}
{
  const { ctx, page } = await session('maria.gomez@demo.nexovax.com', 'en');
  await visit(page, '/producto/cargador-rapido-usb-c-65w', 'EN-buyer-product', 'Add to cart');
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.waitForTimeout(2500);
  await visit(page, '/checkout', 'EN-checkout', 'Live carrier rates');
  await visit(page, '/cuenta/pedidos', 'EN-orders', 'My orders');
  await page.locator('a[href^="/cuenta/pedidos/"]').first().click();
  await page.getByText('Package route').first().waitFor({ timeout: 15000 }).catch(() => problems.push('EN order tracking did not render'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/EN-tracking.png`, fullPage: true });
  await page.request.delete(`${BASE}/api/cart`).catch(() => undefined);
  await ctx.close();
}
{
  const { ctx, page } = await session('techstore@demo.nexovax.com', 'en');
  await visit(page, '/vendedor/dashboard', 'EN-seller-dashboard', 'My store sales');
  await visit(page, '/vendedor/configuracion', 'EN-seller-settings', 'Ship-from address');
  await ctx.close();
}
{
  const { ctx, page } = await session('admin@demo.nexovax.com', 'en');
  await visit(page, '/admin/dashboard', 'EN-admin-dashboard', 'Sales overview');
  await visit(page, '/admin/configuracion', 'EN-admin-settings', 'Marketplace information');
  await page.getByRole('button', { name: 'Taxes' }).click();
  await page.getByText('Taxes by destination country').first().waitFor({ timeout: 10000 }).catch(() => problems.push('EN tax tab did not render'));
  await page.screenshot({ path: `${OUT}/EN-admin-taxes.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
if (problems.length) {
  console.log(`\n${problems.length} problemas:`);
  for (const p of [...new Set(problems)]) console.log(' -', p);
  process.exitCode = 1;
} else console.log('\nUI OK: sin errores de consola, excepciones ni fallos de API.');
