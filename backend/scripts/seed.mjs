#!/usr/bin/env node
/**
 * RD Marketplace — demo data + end-to-end smoke test.
 *
 * Drives the REAL API (http://localhost:4000/api) exactly like the web app:
 * registration, seller onboarding, admin approval, product creation with
 * images, moderation, checkout with sandbox card and bank transfer, admin
 * transfer confirmation, fulfillment, shipping, delivery, fund release,
 * reviews, messaging, support tickets and seller payouts.
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
    email: 'deportiva@rdmarketplace.do', owner: 'Carlos Rodríguez', store: 'Tienda Deportiva RD', legal: 'Tienda Deportiva RD, SRL', entity: 'SRL', taxId: '131234567',
    desc: 'Calzado, ropa y accesorios deportivos de las mejores marcas.', city: 'Santo Domingo', line1: 'Av. Winston Churchill #95, Piantini', phone: '+1 (809) 555-0101',
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
    email: 'techstore@rdmarketplace.do', owner: 'Laura Méndez', store: 'TechStore RD', legal: 'TechStore RD, SRL', entity: 'SRL', taxId: '131765432',
    desc: 'Tecnología, audio y accesorios con garantía local.', city: 'Santiago de los Caballeros', line1: 'Av. 27 de Febrero #42, Los Jardines', phone: '+1 (809) 555-0202',
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
    email: 'modaactiva@rdmarketplace.do', owner: 'Ana Morales', store: 'Moda Activa', legal: 'Ana Morales', entity: 'PERSONA_FISICA', taxId: '00112345678',
    desc: 'Moda cómoda y con estilo para el día a día.', city: 'Santo Domingo Este', line1: 'Av. San Vicente de Paúl #12, Los Mina', phone: '+1 (829) 555-0303',
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
    email: 'hogarplus@rdmarketplace.do', owner: 'Pedro Soto', store: 'Hogar Plus', legal: 'Hogar Plus, SRL', entity: 'SRL', taxId: '131999888',
    desc: 'Todo para tu hogar y tu cocina.', city: 'La Romana', line1: 'Calle Duarte #77, Centro', phone: '+1 (809) 555-0404',
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

function buildVariants(p) {
  const opts = p.options ?? [];
  const combos = opts.reduce((acc, o) => acc.flatMap((a) => o.values.map((v) => ({ ...a, [o.name]: v.label }))), [{}]);
  const base = p.title.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').filter(Boolean).map((w) => w.slice(0, 3)).slice(0, 2).join('');
  return combos.map((ov, i) => ({
    sku: `${base}-${Object.values(ov).map((v) => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)).join('-') || 'U'}`,
    optionValues: ov,
    price: p.price,
    compareAtPrice: p.compare ?? null,
    stock: Math.max(0, p.stock - (i % 3)),
    weightKg: p.weight, ...dims(p),
  }));
}

// ------------------------------------------------------------- main
async function main() {
  const health = await api.get(null, '/health');
  if (health.status !== 'ok' || health.storage !== 'configured') throw new Error(`API no lista: ${JSON.stringify(health)}`);

  log('Cuentas del equipo del marketplace');
  const adminEmail = 'admin@rdmarketplace.do';
  await ensureUser('Administrador RD', adminEmail);
  await grantRole(adminEmail, 'ADMIN');
  await ensureUser('Soporte RD Marketplace', 'soporte@rdmarketplace.do');
  await grantRole('soporte@rdmarketplace.do', 'SUPPORT');
  await grantRole('soporte@rdmarketplace.do', 'MODERATOR');
  const admin = await login(adminEmail);
  const support = await login('soporte@rdmarketplace.do');
  const me = await api.get(admin, '/me');
  if (!me.roles.includes('ADMIN')) throw new Error('El rol ADMIN no quedó asignado');
  ok(`admin: ${adminEmail} (${me.roles.join(', ')})`);

  log('Compradores');
  const juan = await ensureUser('Juan Pérez', 'juan.perez@rdmarketplace.do');
  const maria = await ensureUser('María Gómez', 'maria.gomez@rdmarketplace.do');
  await api.put(juan, '/me/profile', { firstName: 'Juan', lastName: 'Pérez', phone: '+1 (809) 555-1234' });
  await api.put(maria, '/me/profile', { firstName: 'María', lastName: 'Gómez', phone: '+1 (829) 555-9876' });
  const cities = await api.get(null, '/geo/cities');
  const cityId = (name) => Number(cities.find((c) => c.name === name)?.id ?? cities[0].id);
  for (const [t, addr] of [
    [juan, { label: 'Casa', recipientName: 'Juan Pérez', line1: 'Av. Principal #123, Sector Mirador', cityId: cityId('Santo Domingo'), region: 'Distrito Nacional', phone: '+1 (809) 555-1234', isDefaultShipping: true }],
    [juan, { label: 'Trabajo', recipientName: 'Juan Pérez', line1: 'Calle 27 #45, Ensanche Naco', cityId: cityId('Santo Domingo'), region: 'Distrito Nacional', phone: '+1 (809) 555-1234' }],
    [maria, { label: 'Casa', recipientName: 'María Gómez', line1: 'Calle del Sol #8, Los Jardines', cityId: cityId('Santiago de los Caballeros'), region: 'Santiago', phone: '+1 (829) 555-9876', isDefaultShipping: true }],
  ]) {
    const existing = await api.get(t, '/me/addresses');
    if (!existing.some((a) => a.line1 === addr.line1)) await api.post(t, '/me/addresses', addr);
  }
  ok('compradores con direcciones registradas');

  log('Tiendas: registro, verificación y aprobación');
  const cats = catIndex(await api.get(null, '/categories'));
  const sellerTokens = {};
  for (const s of SELLERS) {
    const t = await ensureUser(s.owner, s.email);
    let mine = await api.get(t, '/me');
    if (!mine.sellers.length) {
      await api.post(t, '/seller/onboarding', {
        storeName: s.store, shortDescription: s.desc, supportEmail: s.email, supportPhone: s.phone, legalName: s.legal, entityType: s.entity, taxId: s.taxId,
        address: { contactName: s.owner, line1: s.line1, cityId: cityId(s.city), phone: s.phone },
      });
      ok(`solicitud enviada: ${s.store}`);
      mine = await api.get(t, '/me');
    }
    const sellerId = mine.sellers[0].id;
    if (mine.sellers[0].status !== 'ACTIVE') {
      await api.post(admin, `/admin/sellers/${sellerId}/action`, { action: 'APPROVE' });
      ok(`aprobada por administración: ${s.store}`);
    }
    await api.put(t, '/seller/store', { description: `${s.desc}\n\nTienda dominicana con envíos a todo el país. Atención de lunes a sábado de 9:00 a 6:00.` });
    const store = await api.get(t, '/seller/store');
    if (!store.logoUrl) {
      const form = new FormData();
      form.append('file', new Blob([await productImage('store', 'violet')], { type: 'image/png' }), 'logo.png');
      await api.post(t, '/seller/store/logo', undefined, { form });
    }
    sellerTokens[s.email] = await login(s.email);
  }

  log('Catálogo: productos, variantes, precios, inventario e imágenes');
  for (const s of SELLERS) {
    const t = sellerTokens[s.email];
    const list = await api.get(t, '/seller/products?pageSize=100');
    for (const p of s.products) {
      const existing = list.items.find((x) => x.title === p.title);
      if (existing) {
        const cur = await api.get(t, `/seller/products/${existing.id}`);
        if (cur.variants.some((v) => !v.lengthCm)) {
          await api.put(t, `/seller/products/${existing.id}`, {
            title: cur.title, categoryId: cur.categoryId, brandName: cur.brandName, shortDescription: cur.shortDescription, description: cur.description,
            options: cur.options.map((o) => ({ name: o.name, values: o.values.map((v) => ({ label: v.label, swatch: v.swatch })) })),
            variants: cur.variants.map((v) => ({ id: v.id, sku: v.sku, optionValues: v.optionValues, price: Number(v.price), compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : null, stock: v.stock, weightKg: p.weight, ...dims(p) })),
            action: 'SAVE_DRAFT',
          });
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
    ok(`${s.store}: ${s.products.length} productos enviados a moderación`);
  }

  log('Moderación: el equipo aprueba los productos');
  const pending = await api.get(support, '/admin/products?status=PENDING_REVIEW');
  for (const p of pending.items) {
    const review = await api.get(support, `/admin/products/${p.id}/review`);
    if (!review.checklist.images) throw new Error(`Producto sin imágenes: ${p.title}`);
    await api.post(support, `/admin/products/${p.id}/moderate`, { decision: 'APPROVE' });
  }
  ok(`${pending.items.length} productos aprobados y publicados`);
  const catalog = await api.get(null, '/products?pageSize=60');
  if (!catalog.items.length) throw new Error('El catálogo público está vacío');
  ok(`catálogo público: ${catalog.total} productos`);

  // ---------------------------------------------------------- shopping
  const bySlug = async (title) => {
    const r = await api.get(null, `/products?q=${encodeURIComponent(title)}&pageSize=5`);
    const card = r.items.find((x) => x.title === title);
    return api.get(null, `/products/${card.slug}`);
  };
  const juanOrders = await api.get(juan, '/orders');
  let orderA, orderB;
  if (juanOrders.total < 2) {
    log('Compra multivendedor con tarjeta (sandbox)');
    const shoes = await bySlug('Zapatillas Running RD');
    const v42 = shoes.variants.find((v) => Object.values(v.optionValues).length && v.stock > 1) ?? shoes.variants[0];
    const phones = await bySlug('Audífonos Bluetooth Max');
    await api.post(juan, '/cart/items', { variantId: v42.id, quantity: 1 });
    await api.post(juan, '/cart/items', { variantId: phones.variants[0].id, quantity: 1 });
    const quote = await api.post(juan, '/checkout/quote', {});
    ok(`cotización: subtotal ${quote.subtotal} + envío ${quote.shipping} + ITBIS ${quote.tax} = ${quote.total}`);
    const addresses = await api.get(juan, '/me/addresses');
    const shipping = Object.fromEntries(quote.groups.map((g, i) => [g.sellerId, i === 0 ? 'STANDARD' : 'EXPRESS']));
    // declined card must not touch the order pipeline
    await call(juan, 'POST', '/checkout/place', { addressId: addresses[0].id, shipping, paymentMethod: 'CARD', card: { number: '4000000000000002', expMonth: 12, expYear: 2030, cvc: '123', name: 'Juan Perez' }, idempotencyKey: randomUUID() }, { expect: 402 });
    ok('tarjeta de rechazo 4000…0002 rechazada correctamente (402)');
    const res = await api.post(juan, '/checkout/place', { addressId: addresses[0].id, shipping, paymentMethod: 'CARD', card: { number: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123', name: 'Juan Perez' }, idempotencyKey: randomUUID() });
    if (!res.orderId) throw new Error(`La compra no generó pedido: ${JSON.stringify(res)}`);
    if (res.amount !== Number(quote.total).toFixed(8) && Number(res.amount) !== Number(quote.total)) warn(`total cobrado ${res.amount} vs cotizado ${quote.total}`);
    orderA = res.orderId;
    ok(`pedido ${res.orderNumber} pagado: RD$ ${Number(res.amount).toFixed(2)}`);

    log('Segunda compra con tarjeta (otra tienda, retiro en tienda)');
    const coffee = await bySlug('Cafetera Eléctrica 12 Tazas');
    await api.post(juan, '/cart/items', { variantId: coffee.variants[0].id, quantity: 1 });
    const q2 = await api.post(juan, '/checkout/quote', {});
    const r2 = await api.post(juan, '/checkout/place', { addressId: addresses[0].id, shipping: Object.fromEntries(q2.groups.map((g) => [g.sellerId, 'PICKUP'])), paymentMethod: 'CARD', card: { number: '5555555555554444', expMonth: 8, expYear: 2029, cvc: '321', name: 'Juan Perez' }, idempotencyKey: randomUUID() });
    orderB = r2.orderId;
    ok(`pedido ${r2.orderNumber} pagado`);
  } else {
    orderA = juanOrders.items[juanOrders.items.length - 1].orderId;
    warn('compras de Juan ya existen, se reutilizan');
  }

  const mariaOrders = await api.get(maria, '/orders');
  if (!mariaOrders.total) {
    log('Compra por transferencia bancaria + confirmación de finanzas');
    const watch = await bySlug('Smartwatch Sport');
    const shirt = await bySlug('Camisa de Lino Caribe');
    await api.post(maria, '/cart/items', { variantId: watch.variants[0].id, quantity: 1 });
    await api.post(maria, '/cart/items', { variantId: shirt.variants.find((v) => v.stock > 0).id, quantity: 2 });
    const q = await api.post(maria, '/checkout/quote', {});
    const addr = (await api.get(maria, '/me/addresses'))[0];
    const r = await api.post(maria, '/checkout/place', { addressId: addr.id, shipping: Object.fromEntries(q.groups.map((g) => [g.sellerId, 'STANDARD'])), paymentMethod: 'BANK_TRANSFER', idempotencyKey: randomUUID() });
    if (r.orderId || r.paymentStatus !== 'REQUIRES_ACTION' || !r.bankTransfer) throw new Error(`Transferencia en estado inesperado: ${JSON.stringify(r)}`);
    ok(`reserva creada, referencia ${r.bankTransfer.reference} por RD$ ${Number(r.amount).toFixed(2)}`);
    const transfers = await api.get(admin, '/admin/transfers');
    const tr = transfers.find((x) => x.reference === r.bankTransfer.reference);
    const conf = await api.post(admin, `/admin/transfers/${tr.id}/confirm`, { reference: 'BR-2026-000451' });
    ok(`finanzas confirmó la transferencia → pedido ${conf.orderId}`);
  }

  log('Cumplimiento: preparación, despacho, tracking y entrega');
  const deportiva = sellerTokens['deportiva@rdmarketplace.do'];
  const techstore = sellerTokens['techstore@rdmarketplace.do'];
  for (const [t, name] of [[deportiva, 'Tienda Deportiva RD'], [techstore, 'TechStore RD'], [sellerTokens['hogarplus@rdmarketplace.do'], 'Hogar Plus'], [sellerTokens['modaactiva@rdmarketplace.do'], 'Moda Activa']]) {
    const orders = await api.get(t, '/seller/orders?status=TO_PREPARE');
    for (const o of orders.items) {
      await api.post(t, `/seller/seller-orders/${o.sellerOrderId}/prepare`);
      ok(`${name}: ${o.orderNumber} en preparación`);
    }
  }
  // Tienda Deportiva ships and delivers; TechStore ships only
  for (const [t, deliver, carrier] of [[deportiva, true, 'RD_EXPRESS'], [techstore, false, 'VIMENCA']]) {
    const orders = await api.get(t, '/seller/orders?status=PREPARING');
    for (const o of orders.items) {
      await api.post(t, `/seller/seller-orders/${o.sellerOrderId}/ship`, { carrierCode: carrier });
      const detail = await api.get(t, `/seller/orders/${o.orderId}`);
      const sh = detail.sellerOrders[0].shipments[0];
      ok(`${o.orderNumber} despachado con guía ${sh.trackingNumber}`);
      await api.post(t, `/seller/shipments/${sh.id}/tracking`, { status: 'IN_TRANSIT', detail: 'El paquete llegó al centro de distribución de Santo Domingo.', city: 'Santo Domingo' });
      await api.post(t, `/seller/shipments/${sh.id}/tracking`, { status: 'OUT_FOR_DELIVERY', city: 'Santo Domingo' });
      if (deliver) {
        await api.post(t, `/seller/shipments/${sh.id}/tracking`, { status: 'DELIVERED', detail: 'Entregado al cliente en la puerta de su hogar.', city: 'Santo Domingo' });
        ok(`${o.orderNumber} entregado`);
      }
    }
  }

  log('Opiniones de compra verificada');
  const juanList = await api.get(juan, '/orders');
  for (const o of juanList.items) {
    const d = await api.get(juan, `/orders/${o.orderId}`);
    for (const so of d.sellerOrders) for (const it of so.items) if (it.delivered > 0 && !it.reviewed) {
      await api.post(juan, `/orders/items/${it.id}/review`, { rating: 5, title: 'Excelente compra', body: 'Llegó rápido y en perfectas condiciones. Muy cómodas y de buena calidad, las recomiendo.' });
      ok(`opinión publicada: ${it.title}`);
    }
  }

  log('Saldos del vendedor y retiro');
  const fin = await api.get(deportiva, '/seller/finance?days=30');
  ok(`Tienda Deportiva RD — disponible ${fin.balances.available}, pendiente ${fin.balances.pending}, comisión período ${fin.period.commission}`);
  let accounts = await api.get(deportiva, '/seller/payout-accounts');
  if (!accounts.length) {
    await api.post(deportiva, '/seller/payout-accounts', { methodCode: 'BANK_ACCOUNT', holderName: 'Tienda Deportiva RD, SRL', bankName: 'Banreservas', accountNumber: '9601234821', accountType: 'CORRIENTE', currency: 'DOP', alias: 'Banreservas', isPrimary: true, documentId: '131234567' });
    accounts = await api.get(deportiva, '/seller/payout-accounts');
  }
  if (accounts[0].verificationStatus !== 'VERIFIED') {
    await api.post(admin, `/admin/payout-accounts/${accounts[0].id}/verify`, { approve: true });
    ok('cuenta bancaria verificada por administración');
  }
  const payouts = await api.get(deportiva, '/seller/payouts');
  if (!payouts.length && Number(fin.balances.available) >= 500) {
    const amount = Math.floor(Number(fin.balances.available) * 0.6);
    await api.post(deportiva, '/seller/payouts', { accountId: accounts[0].id, amount, idempotencyKey: randomUUID() });
    const adminPayouts = await api.get(admin, '/admin/payouts');
    const p = adminPayouts.find((x) => ['APPROVAL_REQUIRED', 'REQUESTED'].includes(x.status));
    await api.post(admin, `/admin/payouts/${p.id}/action`, { action: 'APPROVE' });
    await api.post(admin, `/admin/payouts/${p.id}/action`, { action: 'MARK_PAID', reference: 'TRF-2026-000123' });
    ok(`retiro de RD$ ${amount} aprobado y liquidado`);
  } else if (Number(fin.balances.available) < 500) warn('saldo disponible insuficiente para el retiro de prueba');

  log('Mensajería comprador ↔ vendedor');
  const convs = await api.get(maria, '/conversations');
  if (!convs.length) {
    const shoes = await bySlug('Zapatillas Running RD');
    const c = await api.post(maria, '/conversations', { productId: shoes.id, message: 'Hola, ¿tienen disponibles las Zapatillas Running RD en talla 42? ¿Cuánto tarda el envío a Santiago?' });
    const sellerInbox = await api.get(deportiva, '/conversations?as=seller');
    if (!sellerInbox.some((x) => x.id === c.id)) throw new Error('El vendedor no ve la conversación');
    await api.post(deportiva, `/conversations/${c.id}/messages`, { body: '¡Hola! Sí, tenemos la talla 42 en morado y negro. A Santiago el envío estándar tarda de 2 a 3 días hábiles.' });
    await api.post(maria, `/conversations/${c.id}/messages`, { body: '¡Perfecto! Voy a realizar la compra ahora mismo. Gracias.' });
    ok('conversación con 3 mensajes');
  }

  log('Soporte: reporte, respuesta y resolución');
  const mine = await api.get(juan, '/support/reports');
  if (!mine.length) {
    const r = await api.post(juan, '/support/reports', { categoryCode: 'PAYMENTS', priority: 'HIGH', subject: 'Cargo duplicado en mi tarjeta', description: 'Veo dos cargos por la misma compra en el estado de cuenta de mi tarjeta. ¿Pueden revisarlo?', platform: 'WEB' });
    const tracked = await api.get(null, `/support/track/${r.code}`);
    ok(`reporte ${r.code} registrado (${tracked.statusLabel})`);
    const tickets = await api.get(support, '/support/admin/tickets');
    const t = tickets.items.find((x) => `RD-${x.code}` === r.code.replace('RD-REP-', 'RD-REP-')) ?? tickets.items[0];
    await api.post(support, `/support/admin/tickets/${t.id}/reply`, { body: 'Hola Juan, revisamos tu caso: el segundo movimiento es una pre-autorización que tu banco liberará en 48 horas. No se realizó un doble cobro.' });
    await api.post(support, `/support/admin/tickets/${t.id}/status`, { status: 'RESOLVED' });
    await api.post(maria, '/support/reports', { categoryCode: 'TECHNICAL', priority: 'NORMAL', subject: 'Imágenes que no cargan', description: 'En la página de una tienda algunas imágenes tardan mucho en cargar desde el celular.', platform: 'MOBILE' });
    ok('ticket respondido y resuelto; segundo ticket abierto para la bandeja');
  }

  log('Verificaciones finales');
  const dash = await api.get(admin, '/admin/dashboard?days=30');
  ok(`admin dashboard: ventas ${dash.kpis.sales}, pedidos ${dash.kpis.orders}, vendedores activos ${dash.kpis.activeSellers}, productos ${dash.kpis.activeProducts}`);
  const comm = await api.get(admin, '/admin/commissions');
  ok(`comisión del mes ${comm.kpis.month_commission} (tasa ${comm.commissionRate})`);
  const tracking = await api.get(juan, `/orders/${orderA}`);
  ok(`seguimiento ${tracking.number}: ${tracking.timeline.steps.filter((s) => s.done).map((s) => s.label).join(' → ')}`);
  const integ = await db.query(`select count(*)::int n from public.ledger_batches where status = 'POSTED'`).catch(() => ({ rows: [{ n: '?' }] }));
  ok(`asientos contables publicados (doble partida): ${integ.rows[0].n}`);

  console.log('\n\x1b[32mSeed + E2E completado.\x1b[0m Cuentas (contraseña: ' + PASSWORD + '):');
  console.log('  admin@rdmarketplace.do (administrador) · soporte@rdmarketplace.do (soporte/moderación)');
  console.log('  deportiva@ · techstore@ · modaactiva@ · hogarplus@rdmarketplace.do (vendedores)');
  console.log('  juan.perez@ · maria.gomez@rdmarketplace.do (compradores)');
}

main()
  .catch((e) => {
    console.error('\n\x1b[31m✘ ' + e.message + '\x1b[0m');
    process.exitCode = 1;
  })
  .finally(() => db.end());
