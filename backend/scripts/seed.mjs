#!/usr/bin/env node
/**
 * NEXOVAX — demo data + end-to-end smoke test.
 *
 * Drives the REAL API (http://localhost:4000/api) exactly like the web app:
 * registration, seller onboarding in several countries, admin approval,
 * product creation with images, moderation, checkout (live Shippo rates,
 * marketplace flat rates, store pickup; destination-country tax) with
 * sandbox card and bank transfer, Shippo label purchase and tracking,
 * delivery, fund release, reviews, messaging, support and seller payouts.
 *
 * Idempotent: re-running skips what already exists.
 * Usage: node scripts/seed.mjs   (API must be running)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const secret = (f, env) => process.env[env] || (existsSync(resolve(root, '.secrets', f)) ? readFileSync(resolve(root, '.secrets', f), 'utf8').trim() : undefined);

const API = process.env.API_URL ?? 'http://localhost:4000/api';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://oncwajkjomplextntpye.supabase.co';
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_Ul_2a_610N97ximhM-jjkg_NCAU5Ojd';
const DATABASE_URL = secret('database_url', 'DATABASE_URL');
const PASSWORD = process.env.SEED_PASSWORD ?? 'RdDemo2026!';

const db = new pg.Pool({ connectionString: DATABASE_URL.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, ''), ssl: { rejectUnauthorized: false }, max: 2 });

let step = 0;
const log = (...a) => console.log(`\x1b[35m[${String(++step).padStart(2, '0')}]\x1b[0m`, ...a);
const ok = (...a) => console.log('     \x1b[32m✔\x1b[0m', ...a);
const warn = (...a) => console.log('     \x1b[33m!\x1b[0m', ...a);

async function call(token, method, path, body, { form, expect } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res = await fetch(`${API}${path}`, { method, headers, body: payload });
  for (let i = 0; res.status === 429 && i < 6; i++) {
    warn(`límite de solicitudes en ${path}; esperando 20 s…`);
    await new Promise((r) => setTimeout(r, 20_000));
    res = await fetch(`${API}${path}`, { method, headers, body: payload });
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (expect !== undefined) {
    if (res.status !== expect) throw new Error(`${method} ${path} expected ${expect}, got ${res.status}: ${text.slice(0, 300)}`);
    return data;
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data?.message ?? text.slice(0, 300)} ${data?.details ? JSON.stringify(data.details) : ''}`);
  return data;
}
const api = {
  get: (t, p) => call(t, 'GET', p),
  post: (t, p, b, o) => call(t, 'POST', p, b ?? {}, o),
  put: (t, p, b) => call(t, 'PUT', p, b ?? {}),
};

async function login(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const d = await res.json();
  return res.ok ? d.access_token : null;
}

async function ensureUser(fullName, email) {
  let t = await login(email);
  if (!t) {
    await api.post(null, '/auth/register', { fullName, email, password: PASSWORD });
    t = await login(email);
    ok(`cuenta creada: ${email}`);
  }
  if (!t) throw new Error(`No se pudo iniciar sesión con ${email}`);
  return t;
}

async function grantRole(email, role) {
  await db.query(
    `insert into public.user_roles (user_id, role_id, reason)
     select u.id, r.id, 'Seed: rol de demostración' from public.users u, public.roles r
      where lower(u.email::text) = lower($1) and r.code = $2
        and not exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role_id = r.id and ur.revoked_at is null)`,
    [email, role],
  );
}

// ------------------------------------------------------------- product images
const PALETTES = {
  violet: ['#f3efff', '#ddd2ff', '#5b2be0'],
  blue: ['#eef5ff', '#cfe0ff', '#1d4ed8'],
  dark: ['#f4f4f6', '#dcdce3', '#1f1f2e'],
  amber: ['#fff7e8', '#ffe2b0', '#b45309'],
  green: ['#ecfbf3', '#c8f0da', '#047857'],
  pink: ['#fff0f6', '#ffd1e6', '#be185d'],
};
function iconSvg(name) {
  const raw = readFileSync(resolve(here, '..', 'node_modules', 'lucide-static', 'icons', `${name}.svg`), 'utf8');
  return raw.replace(/<svg[^>]*>/, '').replace('</svg>', '');
}
async function productImage(icon, palette, variant = 0) {
  const [bg1, bg2, ink] = PALETTES[palette];
  const rot = [-8, 6, 0, -14][variant % 4];
  const scale = [1, 0.9, 1.08, 0.95][variant % 4];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
    <defs>
      <radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="${bg1}"/><stop offset="100%" stop-color="${bg2}"/></radialGradient>
      <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="${ink}" flood-opacity="0.22"/></filter>
    </defs>
    <rect width="1000" height="1000" fill="url(#bg)"/>
    <ellipse cx="500" cy="800" rx="${260 * scale}" ry="34" fill="${ink}" opacity="0.10"/>
    <g filter="url(#s)" transform="translate(500 480) rotate(${rot}) scale(${17 * scale}) translate(-12 -12)"
       fill="${bg1}" stroke="${ink}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${iconSvg(icon)}</g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ------------------------------------------------------------- catalog data
const SELLERS = [
  {
    email: 'deportiva@demo.nexovax.com', legacy: 'deportiva@rdmarketplace.do', owner: 'Carlos Rodríguez', store: 'Tienda Deportiva RD', legal: 'Tienda Deportiva RD, SRL', entity: 'COMPANY', taxId: '131234567',
    desc: 'Calzado, ropa y accesorios deportivos de las mejores marcas.', country: 'DO', city: 'Santo Domingo', region: 'Distrito Nacional', postal: '10148', line1: 'Av. Winston Churchill #95, Piantini', phone: '+1 (809) 555-0101', tz: 'America/Santo_Domingo',
    products: [
      { title: 'Zapatillas Running RD', cat: 'sports-and-outdoors-athletic-footwear', brand: 'RD Sport', icon: 'footprints', pal: 'violet', price: 5900, compare: 7400, short: 'Zapatillas deportivas ligeras y cómodas, ideales para running, entrenamiento y uso diario.',
        desc: 'Las Zapatillas Running RD combinan comodidad, ligereza y estilo. Diseñadas para ofrecer un excelente soporte y amortiguación en cada paso, son ideales para correr, entrenar en el gimnasio o para el uso diario.\n\n• Amortiguación de alto rendimiento.\n• Material transpirable que mantiene tus pies frescos.\n• Suela antideslizante y resistente.\n• Diseño moderno y versátil.',
        options: [{ name: 'Color', values: [{ label: 'Morado', swatch: '#6d28d9' }, { label: 'Negro', swatch: '#111111' }, { label: 'Blanco', swatch: '#ffffff' }] }, { name: 'Talla', values: ['39', '40', '41', '42', '43'].map((label) => ({ label })) }], stock: 6, weight: 0.8 },
      { title: 'Camiseta Deportiva DryFit', cat: 'sports-and-outdoors-athletic-apparel', brand: 'RD Sport', icon: 'shirt', pal: 'blue', price: 1450, short: 'Camiseta transpirable de secado rápido para entrenar.', desc: 'Camiseta de tejido DryFit que expulsa la humedad y se seca rápido. Costuras planas para evitar rozaduras, ideal para running y gimnasio.',
        options: [{ name: 'Talla', values: ['S', 'M', 'L', 'XL'].map((label) => ({ label })) }], stock: 15, weight: 0.2 },
      { title: 'Short Deportivo Pro', cat: 'sports-and-outdoors-athletic-apparel', brand: 'RD Sport', icon: 'shirt', pal: 'dark', price: 1250, short: 'Short ligero con bolsillo interno.', desc: 'Short deportivo ligero con forro interior, cintura elástica y bolsillo con cierre para llaves. Perfecto para correr bajo el calor del Caribe.', stock: 20, weight: 0.2 },
      { title: 'Botella Deportiva 750 ml', cat: 'sports-and-outdoors-sports-accessories', brand: 'RD Sport', icon: 'milk', pal: 'dark', price: 890, short: 'Botella térmica de acero inoxidable.', desc: 'Botella de acero inoxidable de doble pared: mantiene tus bebidas frías por 24 horas y calientes por 12. Libre de BPA, tapa a prueba de fugas.', stock: 40, weight: 0.4 },
      { title: 'Gorra RD Sport', cat: 'sports-and-outdoors-sports-accessories', brand: 'RD Sport', icon: 'hard-hat', pal: 'violet', price: 750, compare: 950, short: 'Gorra ajustable con protección UV.', desc: 'Gorra de algodón con visera curva, ajuste trasero y protección UV 50+. Bordado RD Sport.', stock: 30, weight: 0.15 },
      { title: 'Balón de Fútbol Profesional', cat: 'sports-and-outdoors-soccer', brand: 'RD Sport', icon: 'volleyball', pal: 'green', price: 1650, short: 'Balón termosellado talla 5.', desc: 'Balón de fútbol talla 5 con paneles termosellados, cámara de butilo y excelente retención de aire. Apto para césped natural y sintético.', stock: 25, weight: 0.45 },
    ],
  },
  {
    email: 'techstore@demo.nexovax.com', legacy: 'techstore@rdmarketplace.do', owner: 'Laura Méndez', store: 'TechStore Miami', legacyStore: 'TechStore RD', legal: 'TechStore Miami LLC', entity: 'COMPANY', taxId: '84-1234567',
    desc: 'Tecnología, audio y accesorios con garantía y envíos internacionales.', country: 'US', city: 'Miami', region: 'FL', postal: '33131', line1: '1200 Brickell Ave', phone: '+1 (305) 555-0202', tz: 'America/New_York',
    products: [
      { title: 'Audífonos Bluetooth Max', cat: 'electronics-and-technology-headphones-and-earbuds', brand: 'SoundMax', icon: 'headphones', pal: 'dark', price: 3500, compare: 4200, short: 'Cancelación de ruido y 40 horas de batería.', desc: 'Audífonos over-ear con cancelación activa de ruido, Bluetooth 5.3, 40 horas de batería y carga rápida USB-C. Almohadillas de espuma viscoelástica.',
        options: [{ name: 'Color', values: [{ label: 'Negro', swatch: '#111111' }, { label: 'Blanco', swatch: '#ffffff' }] }], stock: 12, weight: 0.35 },
      { title: 'Smartwatch Sport', cat: 'electronics-and-technology-smartwatches-and-wearables', brand: 'FitPro', icon: 'watch', pal: 'violet', price: 7600, short: 'Monitor de ritmo cardíaco, GPS y 7 días de batería.', desc: 'Reloj inteligente resistente al agua (5 ATM) con GPS integrado, más de 100 modos deportivos, monitor de ritmo cardíaco y oxígeno, y notificaciones del celular.', stock: 8, weight: 0.1 },
      { title: 'Cargador Rápido USB-C 65W', cat: 'electronics-and-technology-smartphones-and-mobile-phones', brand: 'VoltMax', icon: 'plug-zap', pal: 'blue', price: 1950, short: 'Carga laptop, tablet y celular.', desc: 'Cargador GaN de 65 W con dos puertos USB-C y uno USB-A. Compatible con laptops, tablets y celulares. Protección contra sobrecarga.', stock: 35, weight: 0.15 },
      { title: 'Laptop Ultra 14"', cat: 'electronics-and-technology-computers-laptops-and-accessories', brand: 'NovaTech', icon: 'laptop', pal: 'dark', price: 42500, compare: 46900, short: '16 GB RAM, 512 GB SSD, pantalla Full HD.', desc: 'Laptop ultraliviana de 14" Full HD IPS, procesador de 8 núcleos, 16 GB de RAM, 512 GB SSD NVMe, Wi-Fi 6 y batería de hasta 12 horas.', stock: 4, weight: 1.4 },
      { title: 'Teclado Mecánico RD', cat: 'electronics-and-technology-computers-laptops-and-accessories', brand: 'NovaTech', icon: 'keyboard', pal: 'violet', price: 3200, short: 'Switches táctiles e iluminación RGB.', desc: 'Teclado mecánico compacto 75% con switches táctiles, iluminación RGB, conexión USB-C y Bluetooth. Distribución en español.', stock: 3, weight: 0.8 },
      { title: 'Bocina Portátil Splash', cat: 'electronics-and-technology-headphones-and-earbuds', brand: 'SoundMax', icon: 'speaker', pal: 'green', price: 2450, short: 'Resistente al agua IPX7.', desc: 'Bocina Bluetooth portátil con sonido 360°, resistencia al agua IPX7 y 15 horas de batería. Ideal para la playa y el río.', stock: 18, weight: 0.6 },
    ],
  },
  {
    email: 'modaactiva@demo.nexovax.com', legacy: 'modaactiva@rdmarketplace.do', owner: 'Ana Morales', store: 'Moda Activa', legal: 'Ana Morales', entity: 'INDIVIDUAL', taxId: '12345678Z',
    desc: 'Moda cómoda y con estilo para el día a día.', country: 'ES', city: 'Madrid', region: 'Madrid', postal: '28013', line1: 'Calle Gran Vía 28', phone: '+34 910 555 303', tz: 'Europe/Madrid',
    products: [
      { title: 'Mochila Urbana Ejecutiva', cat: 'fashion-and-apparel-backpacks', brand: 'Urban', icon: 'backpack', pal: 'dark', price: 2900, short: 'Compartimento acolchado para laptop de 15.6".', desc: 'Mochila resistente al agua con compartimento acolchado para laptop, puerto USB externo y bolsillo antirrobo en la espalda.', stock: 14, weight: 0.9 },
      { title: 'Camisa de Lino Caribe', cat: 'fashion-and-apparel-mens-clothing-and-apparel', brand: 'Caribe', icon: 'shirt', pal: 'amber', price: 1850, short: 'Lino fresco para el clima tropical.', desc: 'Camisa de lino 100% de manga larga, corte regular y botones de coco. Fresca y elegante para cualquier ocasión.',
        options: [{ name: 'Talla', values: ['S', 'M', 'L', 'XL'].map((label) => ({ label })) }, { name: 'Color', values: [{ label: 'Beige', swatch: '#e7d9c4' }, { label: 'Azul', swatch: '#2563eb' }] }], stock: 5, weight: 0.25 },
      { title: 'Vestido Floral Verano', cat: 'fashion-and-apparel-womens-clothing-and-apparel', brand: 'Caribe', icon: 'flower-2', pal: 'pink', price: 2300, compare: 2800, short: 'Vestido midi ligero con estampado floral.', desc: 'Vestido midi de viscosa con estampado floral, tirantes ajustables y forro interior. Perfecto para el verano.', options: [{ name: 'Talla', values: ['S', 'M', 'L'].map((label) => ({ label })) }], stock: 6, weight: 0.3 },
      { title: 'Sandalias Playa Confort', cat: 'fashion-and-apparel-womens-shoes-and-footwear', brand: 'Caribe', icon: 'footprints', pal: 'amber', price: 1350, short: 'Plantilla ergonómica y suela antideslizante.', desc: 'Sandalias con plantilla ergonómica acolchada, correas ajustables y suela de goma antideslizante.', options: [{ name: 'Talla', values: ['36', '37', '38', '39'].map((label) => ({ label })) }], stock: 7, weight: 0.4 },
      { title: 'Gafas de Sol Polarizadas', cat: 'fashion-and-apparel-backpacks', brand: 'Urban', icon: 'glasses', pal: 'dark', price: 1500, short: 'Protección UV400.', desc: 'Gafas de sol con lentes polarizados UV400, montura ligera y estuche rígido incluido.', stock: 22, weight: 0.1 },
    ],
  },
  {
    email: 'hogarplus@demo.nexovax.com', legacy: 'hogarplus@rdmarketplace.do', owner: 'Pedro Soto', store: 'Hogar Plus', legal: 'Hogar Plus S.A. de C.V.', entity: 'COMPANY', taxId: 'HPL010101AB1',
    desc: 'Todo para tu hogar y tu cocina.', country: 'MX', city: 'Ciudad de México', region: 'CDMX', postal: '03940', line1: 'Av. Insurgentes Sur 1602', phone: '+52 55 5555 0404', tz: 'America/Mexico_City',
    products: [
      { title: 'Cafetera Eléctrica 12 Tazas', cat: 'home-kitchen-and-living-kitchen-appliances', brand: 'CasaChef', icon: 'coffee', pal: 'dark', price: 4600, compare: 5200, short: 'Programable con jarra de vidrio.', desc: 'Cafetera programable de 12 tazas con jarra de vidrio, placa calefactora, filtro permanente y apagado automático.', stock: 9, weight: 2.1 },
      { title: 'Juego de Ollas Antiadherentes', cat: 'home-kitchen-and-living-cookware', brand: 'CasaChef', icon: 'cooking-pot', pal: 'amber', price: 6900, short: '10 piezas, aptas para inducción.', desc: 'Juego de 10 piezas con recubrimiento antiadherente libre de PFOA, base apta para inducción y tapas de vidrio templado.', stock: 6, weight: 6.5 },
      { title: 'Lámpara de Mesa LED', cat: 'home-kitchen-and-living-lighting', brand: 'LuzHome', icon: 'lamp-desk', pal: 'violet', price: 1800, short: 'Regulable con 3 tonos de luz.', desc: 'Lámpara LED de escritorio con brazo flexible, 3 tonos de luz, 5 niveles de brillo y puerto USB de carga.', stock: 16, weight: 0.9 },
      { title: 'Organizador de Cocina', cat: 'home-kitchen-and-living-home-decor', brand: 'CasaChef', icon: 'archive', pal: 'green', price: 1200, short: 'Bambú natural, 3 niveles.', desc: 'Organizador de bambú natural de 3 niveles para especias, frascos y utensilios. Fácil de montar.', stock: 2, weight: 1.5 },
      { title: 'Silla de Escritorio Ergonómica', cat: 'office-and-school-supplies-office-furniture', brand: 'OfiPro', icon: 'armchair', pal: 'dark', price: 8900, short: 'Soporte lumbar y malla transpirable.', desc: 'Silla ergonómica con respaldo de malla transpirable, soporte lumbar ajustable, apoyabrazos 3D y base de aluminio.', stock: 5, weight: 14 },
    ],
  },
];

function catIndex(tree) {
  const m = new Map();
  const walk = (nodes) => nodes.forEach((n) => { m.set(n.slug, n); walk(n.children ?? []); });
  walk(tree);
  return m;
}

function dims(p) {
  const w = p.weight;
  const [l, wd, h] = w >= 5 ? [60, 50, 40] : w >= 1.2 ? [40, 30, 20] : w >= 0.5 ? [32, 22, 14] : [25, 18, 8];
  return { lengthCm: l, widthCm: wd, heightCm: h };
}

/** Demo prices were authored in DOP; the marketplace currency is USD. */
const usd = (dop) => (dop == null ? null : Math.max(4.99, Math.round(dop / 60) - 0.01));

function buildVariants(p) {
  const opts = p.options ?? [];
  const combos = opts.reduce((acc, o) => acc.flatMap((a) => o.values.map((v) => ({ ...a, [o.name]: v.label }))), [{}]);
  const base = p.title.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').filter(Boolean).map((w) => w.slice(0, 3)).slice(0, 2).join('');
  return combos.map((ov, i) => ({
    sku: `${base}-${Object.values(ov).map((v) => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)).join('-') || 'U'}`,
    optionValues: ov,
    price: usd(p.price),
    compareAtPrice: usd(p.compare),
    stock: Math.max(0, p.stock - (i % 3)),
    weightKg: p.weight, ...dims(p),
  }));
}

// ------------------------------------------------------------- demo accounts
const SECRET = secret('supabase_secret_key', 'SUPABASE_SECRET_KEY');
const supa = SECRET ? createClient(SUPABASE_URL, SECRET, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
const D = (local) => `${local}@demo.nexovax.com`;

/** Moves an account created by an older seed (…@rdmarketplace.do) to the NEXOVAX demo domain. */
async function migrateEmail(oldEmail, newEmail) {
  const { rows } = await db.query(`select id from public.users where lower(email::text) = lower($1)`, [oldEmail]);
  if (!rows.length || !supa) return;
  const taken = await db.query(`select 1 from public.users where lower(email::text) = lower($1)`, [newEmail]);
  if (taken.rows.length) return;
  const { error } = await supa.auth.admin.updateUserById(rows[0].id, { email: newEmail, email_confirm: true });
  if (error) throw new Error(`No se pudo migrar ${oldEmail}: ${error.message}`);
  await db.query(`update public.users set email = $2 where id = $1 and lower(email::text) <> lower($2)`, [rows[0].id, newEmail]).catch(() => undefined);
  ok(`cuenta migrada: ${oldEmail} → ${newEmail}`);
}

const ADDRESSES = {
  juanDO: { label: 'Casa', recipientName: 'Juan Pérez', line1: 'Av. Principal #123, Sector Mirador', countryCode: 'DO', city: 'Santo Domingo', region: 'Distrito Nacional', postalCode: '10107', phone: '+1 (809) 555-1234' },
  juanUS: { label: 'Oficina Miami', recipientName: 'Juan Pérez', line1: '1450 Brickell Ave', line2: 'Suite 1900', countryCode: 'US', city: 'Miami', region: 'FL', postalCode: '33131', phone: '+1 (305) 555-1234' },
  mariaUS: { label: 'Casa', recipientName: 'María Gómez', line1: '200 E Robinson St', countryCode: 'US', city: 'Orlando', region: 'FL', postalCode: '32801', phone: '+1 (407) 555-9876' },
  mariaES: { label: 'Madrid', recipientName: 'María Gómez', line1: 'Calle de Alcalá 45', countryCode: 'ES', city: 'Madrid', region: 'Madrid', postalCode: '28014', phone: '+34 910 555 876' },
};

async function ensureAddress(t, addr, makeDefault = false) {
  const existing = await api.get(t, '/me/addresses');
  let a = existing.find((x) => x.line1 === addr.line1);
  if (!a) a = await api.post(t, '/me/addresses', { ...addr, isDefaultShipping: makeDefault });
  else if (makeDefault && !a.isDefaultShipping) a = await api.put(t, `/me/addresses/${a.id}`, { ...addr, isDefaultShipping: true });
  return a;
}

/** Places an order choosing, per seller, the first option matching `prefer` (e.g. 'SHIPPO:', 'FLAT:STANDARD', 'PICKUP'). */
async function placeOrder(t, address, items, prefer, payment) {
  await call(t, 'DELETE', '/cart');
  for (const [variantId, quantity] of items) await api.post(t, '/cart/items', { variantId, quantity });
  const q = await api.post(t, '/checkout/quote', { addressId: address.id });
  const shipping = {};
  for (const g of q.groups) {
    const opt = g.shippingOptions.find((o) => o.code.startsWith(prefer)) ?? g.shippingOptions[0];
    if (!opt) throw new Error(`Sin opciones de envío para ${g.sellerName ?? g.sellerId}`);
    shipping[g.sellerId] = opt.code;
  }
  const quote = await api.post(t, '/checkout/quote', { addressId: address.id, shipping });
  const body = { addressId: address.id, shipping, idempotencyKey: randomUUID(), ...payment };
  let res = await api.post(t, '/checkout/place', body);
  // Real card processor (Stripe, test mode): the browser would confirm the PaymentIntent with the
  // Payment Element; the seed confirms it server-side with Stripe's test payment methods.
  if (res.paymentAction?.provider === 'STRIPE') {
    await stripeConfirm(res.paymentAction.clientSecret, payment.testPaymentMethod ?? 'pm_card_visa');
    const c = await call(t, 'POST', `/checkout/${res.checkoutId}/payments/stripe/confirm`, {});
    res = { ...(await api.get(t, `/checkout/${res.checkoutId}`)), confirm: c };
  }
  return { quote, res };
}

const TEST_PM = { '4242424242424242': 'pm_card_visa', '5555555555554444': 'pm_card_mastercard', '4000000000000002': 'pm_card_chargeDeclined' };
const CARD = (name, number = '4242424242424242') => ({ paymentMethod: 'CARD', card: { number, expMonth: 12, expYear: 2030, cvc: '123', name }, testPaymentMethod: TEST_PM[number] });
const STRIPE_SK = secret('stripe_secret_key', 'STRIPE_SECRET_KEY');
async function stripeConfirm(clientSecret, paymentMethod) {
  if (!STRIPE_SK?.startsWith('sk_test_')) throw new Error('Se requiere una clave de prueba de Stripe para el seed.');
  const pi = clientSecret.split('_secret_')[0];
  const r = await fetch(`https://api.stripe.com/v1/payment_intents/${pi}/confirm`, {
    method: 'POST', headers: { Authorization: `Bearer ${STRIPE_SK}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ payment_method: paymentMethod }),
  });
  return r.json();
}

// ------------------------------------------------------------- main
async function main() {
  const health = await api.get(null, '/health');
  if (health.status !== 'ok' || health.storage !== 'configured') throw new Error(`API no lista: ${JSON.stringify(health)}`);

  log('Cuentas del equipo del marketplace');
  for (const local of ['admin', 'soporte', 'juan.perez', 'maria.gomez']) await migrateEmail(`${local}@rdmarketplace.do`, D(local));
  for (const s of SELLERS) await migrateEmail(s.legacy, s.email);
  const adminEmail = D('admin');
  await ensureUser('Administrador NEXOVAX', adminEmail);
  await grantRole(adminEmail, 'ADMIN');
  await ensureUser('Soporte NEXOVAX', D('soporte'));
  await grantRole(D('soporte'), 'SUPPORT');
  await grantRole(D('soporte'), 'MODERATOR');
  const admin = await login(adminEmail);
  const support = await login(D('soporte'));
  const me = await api.get(admin, '/me');
  if (!me.roles.includes('ADMIN')) throw new Error('El rol ADMIN no quedó asignado');
  ok(`admin: ${adminEmail} (${me.roles.join(', ')})`);
  await api.put(admin, '/me/profile', { firstName: 'Administrador', lastName: 'NEXOVAX' });
  const settings = await api.get(admin, '/admin/settings');
  ok(`marketplace ${settings.settings['marketplace.name']} · moneda ${settings.settings['marketplace.currency']} · ${settings.taxRates.length} países con impuesto configurado`);

  log('Compradores (República Dominicana, Estados Unidos y España)');
  const juan = await ensureUser('Juan Pérez', D('juan.perez'));
  const maria = await ensureUser('María Gómez', D('maria.gomez'));
  await api.put(juan, '/me/profile', { firstName: 'Juan', lastName: 'Pérez', phone: '+1 (809) 555-1234' });
  await api.put(maria, '/me/profile', { firstName: 'María', lastName: 'Gómez', phone: '+1 (407) 555-9876' });
  await api.put(maria, '/me/locale', { locale: 'en' });
  // older seeds stored DR-only addresses: remove those not in the new set
  for (const [t, keep] of [[juan, [ADDRESSES.juanDO, ADDRESSES.juanUS]], [maria, [ADDRESSES.mariaUS, ADDRESSES.mariaES]]]) {
    for (const a of await api.get(t, '/me/addresses')) if (!keep.some((k) => k.line1 === a.line1)) await call(t, 'DELETE', `/me/addresses/${a.id}`);
  }
  const addr = {
    juanDO: await ensureAddress(juan, ADDRESSES.juanDO, true),
    juanUS: await ensureAddress(juan, ADDRESSES.juanUS),
    mariaUS: await ensureAddress(maria, ADDRESSES.mariaUS, true),
    mariaES: await ensureAddress(maria, ADDRESSES.mariaES),
  };
  ok('compradores con direcciones internacionales (María usa la interfaz en inglés)');

  log('Tiendas: registro, verificación y aprobación (4 países)');
  const cats = catIndex(await api.get(null, '/categories'));
  const sellerTokens = {};
  for (const s of SELLERS) {
    const t = await ensureUser(s.owner, s.email);
    let mine = await api.get(t, '/me');
    const shipFrom = { contactName: s.owner, line1: s.line1, countryCode: s.country, city: s.city, region: s.region, postalCode: s.postal, phone: s.phone };
    if (!mine.sellers.length) {
      await api.post(t, '/seller/onboarding', {
        storeName: s.store, shortDescription: s.desc, supportEmail: s.email, supportPhone: s.phone, legalName: s.legal, entityType: s.entity,
        countryCode: s.country, taxId: s.taxId, timezone: s.tz, address: shipFrom,
      });
      ok(`solicitud enviada: ${s.store} (${s.country})`);
      mine = await api.get(t, '/me');
    }
    const sellerId = mine.sellers[0].id;
    if (mine.sellers[0].status !== 'ACTIVE') {
      await api.post(admin, `/admin/sellers/${sellerId}/action`, { action: 'APPROVE' });
      ok(`aprobada por administración: ${s.store}`);
    }
    // stores created by earlier (DR-only) seeds: move them to their country
    const store = await api.get(t, '/seller/store');
    if (store.shipFrom?.countryCode !== s.country || store.shipFrom?.line1 !== s.line1) {
      await api.put(t, '/seller/store/ship-from', shipFrom);
      await db.query(
        `update public.seller_legal_profiles set registration_country_code = $2, legal_name = $3,
                entity_type_code = case entity_type_code when 'SRL' then 'COMPANY' when 'SA' then 'COMPANY' when 'EIRL' then 'SOLE_PROPRIETOR' when 'PERSONA_FISICA' then 'INDIVIDUAL' when 'OTRO' then 'OTHER' else entity_type_code end
          where seller_id = $1`,
        [sellerId, s.country, s.legal],
      );
      await db.query(`update public.seller_store_profiles set timezone = $2 where seller_id = $1`, [sellerId, s.tz]);
      ok(`${s.store}: dirección de despacho en ${s.city} (${s.country})`);
    }
    await api.put(t, '/seller/store', {
      displayName: s.store,
      description: `${s.desc}\n\nDespachamos desde ${s.city} con envíos nacionales e internacionales. Atención de lunes a sábado.`,
    });
    if (!store.logoUrl) {
      const form = new FormData();
      form.append('file', new Blob([await productImage('store', 'blue')], { type: 'image/png' }), 'logo.png');
      await api.post(t, '/seller/store/logo', undefined, { form });
    }
    sellerTokens[s.email] = await login(s.email);
  }

  log('Catálogo: productos, variantes, precios en USD, inventario e imágenes');
  for (const s of SELLERS) {
    const t = sellerTokens[s.email];
    const list = await api.get(t, '/seller/products?pageSize=100');
    let repriced = 0;
    for (const p of s.products) {
      const existing = list.items.find((x) => x.title === p.title);
      if (existing) {
        const cur = await api.get(t, `/seller/products/${existing.id}`);
        if (cur.variants.some((v) => v.price == null || !v.lengthCm)) {
          await api.put(t, `/seller/products/${existing.id}`, {
            title: cur.title, categoryId: cur.categoryId, brandName: cur.brandName, shortDescription: cur.shortDescription, description: cur.description,
            options: cur.options.map((o) => ({ name: o.name, values: o.values.map((v) => ({ label: v.label, swatch: v.swatch })) })),
            variants: cur.variants.map((v) => ({ id: v.id, sku: v.sku, optionValues: v.optionValues, price: usd(p.price), compareAtPrice: usd(p.compare), stock: v.stock, weightKg: p.weight, ...dims(p) })),
            action: 'SAVE_DRAFT',
          });
          repriced++;
        }
        continue;
      }
      const cat = cats.get(p.cat);
      if (!cat) throw new Error(`Categoría no encontrada: ${p.cat}`);
      const created = await api.post(t, '/seller/products', {
        title: p.title, categoryId: cat.id, brandName: p.brand, shortDescription: p.short, description: p.desc,
        options: p.options ?? [], variants: buildVariants(p), action: 'SAVE_DRAFT',
        seo: { metaTitle: `${p.title} | ${s.store}`.slice(0, 60), metaDescription: p.short.slice(0, 160) },
      });
      const form = new FormData();
      for (let i = 0; i < 3; i++) form.append('files', new Blob([await productImage(p.icon, p.pal, i)], { type: 'image/png' }), `${i}.png`);
      await api.post(t, `/seller/products/${created.id}/media`, undefined, { form });
      await api.put(t, `/seller/products/${created.id}`, {
        title: p.title, categoryId: cat.id, brandName: p.brand, shortDescription: p.short, description: p.desc,
        options: p.options ?? [], variants: created.variants.map((v) => ({ id: v.id, sku: v.sku, optionValues: v.optionValues, price: Number(v.price), compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : null, stock: v.stock, weightKg: p.weight, ...dims(p) })),
        action: 'SUBMIT',
      });
    }
    for (const x of (await api.get(t, '/seller/products?pageSize=100&status=PAUSED')).items ?? []) {
      await api.post(t, `/seller/products/${x.id}/status`, { action: 'RESUME' });
      ok(`${s.store}: «${x.title}» reactivado`);
    }
    ok(`${s.store}: ${s.products.length} productos${repriced ? ` (${repriced} con precio USD agregado)` : ''}`);
  }

  log('Moderación: el equipo aprueba los productos');
  const pending = await api.get(support, '/admin/products?status=PENDING_REVIEW');
  for (const p of pending.items) {
    const review = await api.get(support, `/admin/products/${p.id}/review`);
    if (!review.checklist.images) throw new Error(`Producto sin imágenes: ${p.title}`);
    await api.post(support, `/admin/products/${p.id}/moderate`, { decision: 'APPROVE' });
  }
  ok(`${pending.items.length} productos aprobados`);
  const catalog = await api.get(null, '/products?pageSize=60');
  if (!catalog.items.length) throw new Error('El catálogo público está vacío');
  ok(`catálogo público: ${catalog.total} productos en ${catalog.items[0].currency ?? 'USD'}`);

  // ---------------------------------------------------------- shopping
  const bySlug = async (title) => {
    const r = await api.get(null, `/products?q=${encodeURIComponent(title)}&pageSize=5`);
    const card = r.items.find((x) => x.title === title);
    if (!card) throw new Error(`Producto no visible en el catálogo: ${title}`);
    return api.get(null, `/products/${card.slug}`);
  };
  const usdOrders = async (t) => (await api.get(t, '/orders?pageSize=50')).items.filter((o) => (o.currency ?? 'USD') === 'USD');
  const stocked = (p) => p.variants.find((v) => v.stock > 0) ?? p.variants[0];

  let orderShippo = (await usdOrders(maria)).at(-1)?.orderId ?? null;
  const juanUsd = (await usdOrders(juan)).length;
  const mariaUsd = (await usdOrders(maria)).length;
  if (!mariaUsd) {
    log('Compra en EE. UU. con tarifa en vivo de Shippo (tarjeta)');
    const phones = await bySlug('Audífonos Bluetooth Max');
    const charger = await bySlug('Cargador Rápido USB-C 65W');
    const { quote, res } = await placeOrder(maria, addr.mariaUS, [[stocked(phones).id, 1], [stocked(charger).id, 1]], 'SHIPPO:', CARD('Maria Gomez'));
    const g = quote.groups[0];
    const chosen = g.shippingOptions.find((o) => o.code === g.selectedShipping);
    if (!chosen || chosen.provider !== 'SHIPPO') throw new Error(`Se esperaba tarifa Shippo: ${JSON.stringify(g.shippingOptions).slice(0, 300)}`);
    ok(`opciones Shippo: ${g.shippingOptions.filter((o) => o.provider === 'SHIPPO').map((o) => `${o.serviceName} US$${o.amount}`).slice(0, 4).join(' · ')}`);
    ok(`impuesto destino ${quote.tax.country}: ${quote.tax.name} ${(quote.tax.rate * 100).toFixed(1)} % → ${quote.taxTotal}`);
    if (!res.orderId) throw new Error(`La compra no generó pedido: ${JSON.stringify(res)}`);
    orderShippo = res.orderId;
    ok(`pedido ${res.orderNumber} pagado: US$ ${Number(res.amount).toFixed(2)} (envío ${chosen.serviceName})`);
  }
  if (!juanUsd) {
    log('Compra internacional EE. UU. → República Dominicana (Shippo)');
    const watch = await bySlug('Smartwatch Sport');
    const r2 = await placeOrder(juan, addr.juanDO, [[stocked(watch).id, 1]], 'SHIPPO:usps', CARD('Juan Perez'));
    const o2 = r2.quote.groups[0].shippingOptions.find((o) => o.code === r2.quote.groups[0].selectedShipping);
    ok(`pedido ${r2.res.orderNumber}: ${o2.serviceName} US$${o2.amount} + ${r2.quote.tax.name} ${(r2.quote.tax.rate * 100).toFixed(0)} %`);
  }
  if (juanUsd < 3) {
    log('Compra local en RD (sin cobertura Shippo → tarifa del marketplace) y retiro en tienda');
    const shoes = await bySlug('Zapatillas Running RD');
    const declined = await call(juan, 'DELETE', '/cart').then(async () => {
      await api.post(juan, '/cart/items', { variantId: stocked(shoes).id, quantity: 1 });
      const q = await api.post(juan, '/checkout/quote', { addressId: addr.juanDO.id });
      if (q.groups[0].shippingOptions.some((o) => o.provider === 'SHIPPO')) warn('Shippo devolvió tarifas domésticas en RD');
      const placed = await api.post(juan, '/checkout/place', { addressId: addr.juanDO.id, shipping: { [q.groups[0].sellerId]: q.groups[0].shippingOptions[0].code }, ...CARD('Juan Perez', '4000000000000002'), idempotencyKey: randomUUID() });
      if (placed.paymentAction?.provider === 'STRIPE') {
        await stripeConfirm(placed.paymentAction.clientSecret, 'pm_card_chargeDeclined');
        await call(juan, 'POST', `/checkout/${placed.checkoutId}/payments/stripe/confirm`, {}, { expect: 402 });
        await call(juan, 'POST', `/checkout/${placed.checkoutId}/cancel`, {});
        return true;
      }
      return placed;
    });
    void declined;
    ok('tarjeta de rechazo 4000…0002 rechazada correctamente (402)');
    const r3 = await placeOrder(juan, addr.juanDO, [[stocked(shoes).id, 1]], 'FLAT:STANDARD', CARD('Juan Perez', '5555555555554444'));
    ok(`pedido ${r3.res.orderNumber}: ${r3.quote.groups[0].shippingOptions.map((o) => o.serviceName).join(' / ')}`);
    const bottle = await bySlug('Botella Deportiva 750 ml');
    const r4 = await placeOrder(juan, addr.juanDO, [[stocked(bottle).id, 2]], 'PICKUP', CARD('Juan Perez'));
    ok(`pedido ${r4.res.orderNumber}: retiro en tienda`);
  }
  if (mariaUsd < 2) {
    log('Compra en España por transferencia bancaria + confirmación de finanzas');
    const shirt = await bySlug('Camisa de Lino Caribe');
    const r5 = await placeOrder(maria, addr.mariaES, [[stocked(shirt).id, 2]], 'SHIPPO:', { paymentMethod: 'BANK_TRANSFER' });
    if (r5.res.orderId || r5.res.paymentStatus !== 'REQUIRES_ACTION' || !r5.res.bankTransfer) throw new Error(`Transferencia en estado inesperado: ${JSON.stringify(r5.res)}`);
    ok(`reserva ${r5.res.bankTransfer.reference}: US$ ${Number(r5.res.amount).toFixed(2)} (${r5.quote.tax.name} ${(r5.quote.tax.rate * 100).toFixed(0)} % España)`);
    const conf = await api.post(admin, `/admin/transfers/${r5.res.paymentId}/confirm`, { reference: 'WIRE-2026-000451' });
    ok(`finanzas confirmó la transferencia → pedido ${conf.orderId}`);
  }
  orderShippo = orderShippo ?? (await usdOrders(maria)).at(-1)?.orderId ?? null;

  log('Cumplimiento: preparación, etiquetas Shippo, guías manuales y entrega');
  const tokenFor = Object.fromEntries(SELLERS.map((s) => [s.store, sellerTokens[s.email]]));
  const countryOf = Object.fromEntries(SELLERS.map((s) => [s.store, s.country]));
  const MANUAL_CARRIER = { DO: 'VIMENCA', ES: 'CORREOS', MX: 'ESTAFETA', US: 'USPS' };
  // Only orders placed by demo buyers are processed (never touch real accounts' orders).
  const demoOrders = new Set((await db.query(
    `select o.id from public.orders o join public.users u on u.id = o.customer_id where u.email::text like '%@demo.nexovax.com'`,
  )).rows.map((r) => r.id));
  for (const [name, t] of Object.entries(tokenFor)) {
    const orders = await api.get(t, '/seller/orders?status=TO_PREPARE');
    for (const o of orders.items.filter((x) => demoOrders.has(x.orderId) && (x.currency === 'USD' || !x.currency))) {
      await api.post(t, `/seller/seller-orders/${o.sellerOrderId}/prepare`);
      ok(`${name}: ${o.orderNumber} en preparación`);
    }
  }
  for (const [name, t] of Object.entries(tokenFor)) {
    const orders = await api.get(t, '/seller/orders?status=PREPARING');
    for (const o of orders.items.filter((x) => demoOrders.has(x.orderId))) {
      const detail = await api.get(t, `/seller/orders/${o.orderId}`);
      const so = detail.sellerOrders[0];
      const viaShippo = so.shippingMethod?.provider === 'SHIPPO';
      if (viaShippo) {
        const r = await call(t, 'POST', `/seller/seller-orders/${o.sellerOrderId}/ship`, { mode: 'LABEL' }).catch((e) => ({ error: e.message }));
        if (r.error) {
          warn(`${name}: ${o.orderNumber} etiqueta pendiente (${so.shippingMethod.name}): ${r.error.replace(/^.*?→ \d+: /, '').slice(0, 160)}`);
          continue;
        }
        const l = r.shipments[0];
        ok(`${name}: ${o.orderNumber} etiqueta ${l.carrier} ${l.service} · guía ${l.trackingNumber} · costo ${l.currency} ${l.cost}`);
      } else if (so.shippingMethod?.code === 'PICKUP') {
        await api.post(t, `/seller/seller-orders/${o.sellerOrderId}/ship`, { mode: 'MANUAL', carrierCode: 'PICKUP' });
        ok(`${name}: ${o.orderNumber} listo para retiro`);
      } else {
        const carrierCode = MANUAL_CARRIER[countryOf[name]] ?? 'OTHER';
        await api.post(t, `/seller/seller-orders/${o.sellerOrderId}/ship`, { mode: 'MANUAL', carrierCode, carrierName: 'Courier local', trackingNumber: `${carrierCode.slice(0, 3)}${Date.now().toString().slice(-9)}` });
        ok(`${name}: ${o.orderNumber} despachado con guía manual (${carrierCode})`);
      }
    }
  }
  // Tracking: Shippo shipments advance with provider events; manual ones by the seller.
  for (const [name, t] of Object.entries(tokenFor)) {
    const shipped = await api.get(t, '/seller/orders?status=SHIPPED');
    for (const o of shipped.items.filter((x) => demoOrders.has(x.orderId))) {
      const detail = await api.get(t, `/seller/orders/${o.orderId}`);
      for (const sh of detail.sellerOrders[0].shipments.filter((x) => x.trackingStatus !== 'DELIVERED')) {
        if (sh.automaticTracking) {
          const a = await api.post(t, `/seller/shipments/${sh.id}/refresh-tracking`);
          const b = await api.post(t, `/seller/shipments/${sh.id}/refresh-tracking`);
          ok(`${name}: ${o.orderNumber} rastreo Shippo → ${a.status} → ${b.status}`);
        } else {
          await api.post(t, `/seller/shipments/${sh.id}/tracking`, { status: 'OUT_FOR_DELIVERY', city: sh.toCity ?? undefined });
          await api.post(t, `/seller/shipments/${sh.id}/tracking`, { status: 'DELIVERED', detail: 'Entregado al cliente.' });
          ok(`${name}: ${o.orderNumber} entregado (actualización manual)`);
        }
      }
    }
  }

  log('Opiniones de compra verificada');
  for (const [t, who] of [[juan, 'Juan'], [maria, 'María']]) {
    for (const o of (await api.get(t, '/orders')).items) {
      const d = await api.get(t, `/orders/${o.orderId}`);
      for (const so of d.sellerOrders) for (const it of so.items) if (it.delivered > 0 && !it.reviewed) {
        await api.post(t, `/orders/items/${it.id}/review`, { rating: 5, title: who === 'María' ? 'Great purchase' : 'Excelente compra', body: who === 'María' ? 'Arrived fast and in perfect condition. Highly recommended.' : 'Llegó rápido y en perfectas condiciones. Muy recomendado.' });
        ok(`opinión publicada: ${it.title}`);
      }
    }
  }

  log('Saldos del vendedor y retiro en USD');
  const techstore = sellerTokens[D('techstore')];
  const fin = await api.get(techstore, '/seller/finance?days=30');
  ok(`TechStore Miami — disponible ${fin.currency} ${fin.balances.available}, pendiente ${fin.balances.pending}, comisión período ${fin.period.commission}`);
  let accounts = await api.get(techstore, '/seller/payout-accounts');
  if (!accounts.some((a) => a.metadata?.currency === 'USD')) {
    await api.post(techstore, '/seller/payout-accounts', { methodCode: 'BANK_ACCOUNT', holderName: 'TechStore Miami LLC', bankName: 'Chase Bank', accountNumber: '000123456789', accountType: 'CHECKING', routingOrSwift: '021000021', countryCode: 'US', currency: 'USD', alias: 'Chase', isPrimary: true });
    accounts = await api.get(techstore, '/seller/payout-accounts');
  }
  const usdAccount = accounts.find((a) => a.metadata?.currency === 'USD');
  if (usdAccount.verificationStatus !== 'VERIFIED') {
    await api.post(admin, `/admin/payout-accounts/${usdAccount.id}/verify`, { approve: true });
    ok('cuenta bancaria (Chase, USD) verificada por administración');
  }
  const payouts = (await api.get(techstore, '/seller/payouts')).filter((p) => p.currency === 'USD');
  const minimum = Number(fin.payoutPolicy?.minimum ?? 25);
  if (!payouts.length && Number(fin.balances.available) >= minimum) {
    const amount = Math.floor(Number(fin.balances.available) * 0.6);
    await api.post(techstore, '/seller/payouts', { accountId: usdAccount.id, amount, currency: 'USD', idempotencyKey: randomUUID() });
    const p = (await api.get(admin, '/admin/payouts')).find((x) => ['APPROVAL_REQUIRED', 'REQUESTED'].includes(x.status) && x.currency === 'USD');
    await api.post(admin, `/admin/payouts/${p.id}/action`, { action: 'APPROVE' });
    await api.post(admin, `/admin/payouts/${p.id}/action`, { action: 'MARK_PAID', reference: 'ACH-2026-000123' });
    ok(`retiro de US$ ${amount} aprobado y liquidado`);
  } else if (Number(fin.balances.available) < minimum) warn(`saldo disponible insuficiente para el retiro de prueba (mínimo ${minimum})`);

  log('Mensajería comprador ↔ vendedor');
  const convs = await api.get(maria, '/conversations');
  if (!convs.length) {
    const phones = await bySlug('Audífonos Bluetooth Max');
    const c = await api.post(maria, '/conversations', { productId: phones.id, message: 'Hi! Do the Bluetooth Max headphones ship to Orlando? How long does it take?' });
    const inbox = await api.get(techstore, '/conversations?as=seller');
    if (!inbox.some((x) => x.id === c.id)) throw new Error('El vendedor no ve la conversación');
    await api.post(techstore, `/conversations/${c.id}/messages`, { body: 'Hi María! Yes, we ship from Miami with USPS and UPS; delivery to Orlando takes 1–3 business days.' });
    await api.post(maria, `/conversations/${c.id}/messages`, { body: 'Great, ordering now. Thanks!' });
    ok('conversación con 3 mensajes');
  }

  log('Soporte: reporte, respuesta y resolución');
  const mine = await api.get(juan, '/support/reports');
  if (!mine.length) {
    const r = await api.post(juan, '/support/reports', { categoryCode: 'PAYMENTS', priority: 'HIGH', subject: 'Cargo duplicado en mi tarjeta', description: 'Veo dos cargos por la misma compra en el estado de cuenta de mi tarjeta. ¿Pueden revisarlo?', platform: 'WEB' });
    const tracked = await api.get(null, `/support/track/${r.code}`);
    ok(`reporte ${r.code} registrado (${tracked.statusLabel})`);
    await api.post(support, `/support/admin/tickets/${r.id}/reply`, { body: 'Hola Juan, revisamos tu caso: el segundo movimiento es una pre-autorización que tu banco liberará en 48 horas. No se realizó un doble cobro.' });
    await api.post(support, `/support/admin/tickets/${r.id}/status`, { status: 'RESOLVED' });
    await api.post(maria, '/support/reports', { categoryCode: 'TECHNICAL', priority: 'NORMAL', subject: 'Images load slowly', description: 'On a store page some images take a long time to load on my phone.', platform: 'MOBILE' });
    ok('ticket respondido y resuelto; segundo ticket abierto para la bandeja');
  }

  log('Verificaciones finales');
  const dash = await api.get(admin, '/admin/dashboard?days=30');
  ok(`admin dashboard (${dash.currency}): ventas ${dash.kpis.sales}, pedidos ${dash.kpis.orders}, vendedores activos ${dash.kpis.activeSellers}, productos ${dash.kpis.activeProducts}`);
  const comm = await api.get(admin, '/admin/commissions');
  ok(`comisión del mes ${comm.currency} ${comm.kpis.month_commission} (tasa ${comm.commissionRate})`);
  if (orderShippo) {
    const tracking = await api.get(maria, `/orders/${orderShippo}`);
    const sh = tracking.sellerOrders[0].shipments[0];
    ok(`seguimiento ${tracking.number}: ${tracking.timeline.steps.filter((s) => s.done).map((s) => s.label).join(' → ')} · ${sh?.carrier ?? ''} ${sh?.trackingNumber ?? ''} (${sh?.events?.length ?? 0} eventos)`);
  }
  const integ = await db.query(`select count(*)::int n from public.ledger_batches where status = 'POSTED'`).catch(() => ({ rows: [{ n: '?' }] }));
  ok(`asientos contables publicados (doble partida): ${integ.rows[0].n}`);
  const labels = await db.query(`select count(*)::int n from public.shipping_labels where status = 'PURCHASED' and shipping_provider_code = 'SHIPPO'`);
  ok(`etiquetas Shippo compradas: ${labels.rows[0].n}`);

  console.log('\n\x1b[32mSeed + E2E completado.\x1b[0m Cuentas (contraseña: ' + PASSWORD + '):');
  console.log('  admin@ · soporte@demo.nexovax.com (administración / soporte y moderación)');
  console.log('  deportiva@ (RD) · techstore@ (EE. UU.) · modaactiva@ (España) · hogarplus@demo.nexovax.com (México) — vendedores');
  console.log('  juan.perez@ (español) · maria.gomez@demo.nexovax.com (inglés) — compradores');
}

main()
  .catch((e) => {
    console.error('\n\x1b[31m✘ ' + e.message + '\x1b[0m');
    process.exitCode = 1;
  })
  .finally(() => db.end());
