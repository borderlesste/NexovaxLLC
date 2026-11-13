# RD Marketplace Multivendedor — MVP

Marketplace multivendedor dominicano: compradores, vendedores, moderación y administración financiera.
Monolito modular según `# Stack tecnológico recomendado par.md`:

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Radix UI (estilo shadcn) · Lucide · TanStack Query · React Hook Form/Zod · Recharts · Sonner |
| Backend | NestJS 11 · REST + OpenAPI (`/api/docs`) · `pg` · `jose` (JWT de Supabase vía JWKS) · class-validator · throttler · schedule · nestjs-pino · sharp |
| Datos e identidad | Supabase (PostgreSQL 17, Auth, Storage) — proyecto **BovedaNegra** |
| Workspace | pnpm workspaces (`frontend`, `backend`) |

## Estructura

```
backend/            API NestJS (src/<módulo>/*.service.ts + *.controller.ts)
  scripts/seed.mjs  Datos de demostración + prueba E2E contra la API real
frontend/           Next.js (app/(shop) tienda · app/vendedor · app/admin)
supabase/migrations Migraciones aplicadas por este MVP (las previas viven en el proyecto)
scripts/data/       Traducción de categorías y ciudades de RD (countries.dev)
interfaces/         Pantallas de referencia (no versionadas)
.secrets/           Credenciales locales (no versionadas)
```

## Puesta en marcha (desarrollo)

Requisitos: Node 20+, pnpm 9.

1. Secretos en `.secrets/` (uno por archivo, una línea):
   - `database_url` — cadena de conexión del rol `rd_api_runtime` (pooler de Supabase).
   - `supabase_secret_key` — clave secreta `sb_secret_…` (solo backend).
   - `data_encryption_key` — 32 bytes en base64 (`openssl rand -base64 32`) para cifrar RNC/cédula y cuentas bancarias.
   También pueden pasarse como variables de entorno: `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `DATA_ENCRYPTION_KEY`.
2. `pnpm install`
3. API: `pnpm --filter @rd/backend build && node backend/dist/main.js` (puerto 4000; Swagger en http://localhost:4000/api/docs).
4. Web: `pnpm --filter @rd/frontend build && pnpm --filter @rd/frontend start` (puerto 3000; `/api/*` se redirige a la API).
5. Datos de demostración + prueba de punta a punta: `node backend/scripts/seed.mjs` (idempotente).
6. Verificación visual de las 40 pantallas (Playwright, web en :3000 y API en :4000): `node scripts/ui-check.mjs ui-shots` — inicia sesión por rol desde la UI real, captura cada pantalla y falla si hay errores de consola, excepciones o respuestas 5xx. Requiere `npx playwright install chromium` (en WSL sin sudo, exportar `LD_LIBRARY_PATH` con `libnss3`/`libnspr4`).

### Cuentas de demostración (contraseña `RdDemo2026!`)

| Rol | Correo |
|---|---|
| Administrador | admin@rdmarketplace.do |
| Soporte y moderación | soporte@rdmarketplace.do |
| Vendedores | deportiva@ · techstore@ · modaactiva@ · hogarplus@rdmarketplace.do |
| Compradores | juan.perez@ · maria.gomez@rdmarketplace.do |

Tarjetas de prueba (procesador `RD_SANDBOX`): `4242 4242 4242 4242` aprobada · `4000 0000 0000 0002` rechazada.

## Flujos implementados

- **Comprador:** registro/inicio de sesión/recuperación, catálogo con filtros y búsqueda, producto con variantes, tienda pública (seguir, contactar), favoritos, carrito multivendedor, checkout (dirección, envío por tienda, ITBIS, tarjeta o transferencia), seguimiento del pedido con eventos, confirmación de recepción, opiniones de compra verificada, mensajería, reportes de problemas.
- **Vendedor:** alta de tienda (datos fiscales cifrados) y verificación, dashboard, editor de productos (opciones, variantes con SKU/precio/stock, atributos por categoría, imágenes, SEO, envío) con moderación, inventario con ajustes auditados, pedidos (preparar, despachar con guía, actualizar tracking), finanzas (saldos del libro mayor), métodos de cobro y retiros.
- **Administración:** dashboard, productos y moderación, pedidos, vendedores (aprobar/rechazar/suspender, alta directa, verificación de cuentas de cobro), categorías, comisiones y payouts (aprobar y liquidar), finanzas y confirmación de transferencias, reportes de soporte (asignar, responder, notas internas, estados), usuarios y roles, configuración versionada (comisión, ITBIS, tarifas de envío, opciones).

Toda la lógica financiera usa las funciones del dominio en PostgreSQL: snapshots inmutables de checkout y pedido, reglas comerciales versionadas (comisión 10 % por artículo), captura de pago → creación de pedido, asientos de doble partida, liberación de fondos al entregar y payouts con política versionada.

## Decisiones y límites del MVP

- **Pagos:** proveedor `RD_SANDBOX` (entorno TEST) detrás del modelo de pagos neutral; Stripe/PayPal/AZUL se conectan registrando su configuración y un adaptador. PayPal y contra entrega aparecen como no disponibles.
- **Envíos:** proveedor interno `RD_LOCAL` con tarifas configurables (Estándar, Express, Retiro en tienda); el vendedor registra transportadora, guía y eventos.
- **Correo:** las cuentas creadas por la API se confirman al instante (`AUTH_AUTO_CONFIRM=true`) porque el SMTP por defecto de Supabase solo entrega al equipo del proyecto. En producción, configurar SMTP (p. ej. Resend) y desactivar esa opción.
- **Mensajería:** actualización por sondeo (5 s); Supabase Realtime requeriría políticas RLS de lectura para el navegador.
- **Ciudades:** catálogo local de 49 ciudades de RD (fuente countries.dev, ids GeoNames).
