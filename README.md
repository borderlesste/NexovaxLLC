# NEXOVAX — Marketplace multivendedor internacional

Marketplace multivendedor internacional (español e inglés): compradores y vendedores de cualquier país, envíos con Shippo, impuestos por país de destino, moderación y administración financiera.
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
scripts/data/       Taxonomía ES↔EN (categorías, atributos); la API la usa para responder en inglés
interfaces/         Pantallas de referencia (no versionadas)
.secrets/           Credenciales locales (no versionadas)
```

## Puesta en marcha (desarrollo)

Requisitos: Node 20+, pnpm 9.

1. Secretos en `.secrets/` (uno por archivo, una línea):
   - `database_url` — cadena de conexión del rol `rd_api_runtime` (pooler de Supabase).
   - `supabase_secret_key` — clave secreta `sb_secret_…` (solo backend).
   - `data_encryption_key` — 32 bytes en base64 (`openssl rand -base64 32`) para cifrar RNC/cédula y cuentas bancarias.
   - `stripe_secret_key` (`sk_test_…`/`sk_live_…`), `stripe_publishable_key` (`pk_…`) y `stripe_webhook_secret` (uno o varios `whsec_…`, uno por línea).
   - `paypal_client_id`, `paypal_client_secret` y, para webhooks, `paypal_webhook_id` (sandbox por defecto; `PAYPAL_ENV=live` en producción).
   - `shippo_api_key` — clave de Shippo (`shippo_test_…` en pruebas, `shippo_live_…` en producción).
   - `shippo_webhook_token` — secreto aleatorio para el webhook de rastreo (`openssl rand -hex 24`).
   - `resend_api_key` — clave `re_…` de Resend para el correo transaccional (sin ella los correos se omiten y se registran como `SKIPPED`).
   También pueden pasarse como variables de entorno: `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `DATA_ENCRYPTION_KEY`, `SHIPPO_API_KEY`, `SHIPPO_WEBHOOK_TOKEN`, `RESEND_API_KEY`.
2. `pnpm install`
3. API: `pnpm --filter @rd/backend build && node backend/dist/main.js` (puerto 4000; Swagger en http://localhost:4000/api/docs).
4. Web: `pnpm --filter @rd/frontend build && pnpm --filter @rd/frontend start` (puerto 3000; `/api/*` se redirige a la API).
5. Datos de demostración + prueba de punta a punta: `node backend/scripts/seed.mjs` (idempotente).
6. Verificación visual de las pantallas en español y en inglés (Playwright, web en :3000 y API en :4000): `node scripts/ui-check.mjs ui-shots` — inicia sesión por rol desde la UI real, captura cada pantalla y falla si hay errores de consola, excepciones o respuestas 5xx. Requiere `npx playwright install chromium` (en WSL sin sudo, exportar `LD_LIBRARY_PATH` con `libnss3`/`libnspr4`).

### Cuentas de demostración (contraseña `RdDemo2026!`)

| Rol | Correo |
|---|---|
| Administrador | admin@demo.nexovax.com |
| Soporte y moderación | soporte@demo.nexovax.com |
| Vendedores | deportiva@ (Santo Domingo, RD) · techstore@ (Miami, EE. UU.) · modaactiva@ (Madrid, España) · hogarplus@demo.nexovax.com (Ciudad de México) |
| Compradores | juan.perez@ (español; direcciones en RD y Miami) · maria.gomez@demo.nexovax.com (inglés; Orlando y Madrid) |

Los correos `@demo.nexovax.com` nunca reciben e-mails reales (dominio suprimido). Tarjetas de prueba (procesador sandbox): `4242 4242 4242 4242` aprobada · `4000 0000 0000 0002` rechazada.

## Flujos implementados

- **Comprador:** registro/inicio de sesión/recuperación, catálogo con filtros y búsqueda, producto con variantes, tienda pública (seguir, contactar), favoritos, carrito multivendedor, direcciones de cualquier país, checkout (tarifas en vivo de transportadoras por tienda, impuesto del país de destino, tarjeta o transferencia), seguimiento del pedido con eventos, confirmación de recepción, opiniones de compra verificada, mensajería, reportes de problemas.
- **Vendedor:** alta de tienda en cualquier país (identificación fiscal cifrada, dirección de despacho editable) y verificación, dashboard, editor de productos (opciones, variantes con SKU/precio/stock, atributos por categoría, imágenes, SEO, envío) con moderación, inventario con ajustes auditados, pedidos (preparar, comprar etiqueta Shippo o registrar guía manual, rastreo automático), finanzas (saldos del libro mayor por moneda), métodos de cobro internacionales (IBAN/SWIFT) y retiros.
- **Administración:** dashboard, productos y moderación, pedidos, vendedores (aprobar/rechazar/suspender, alta directa, verificación de cuentas de cobro), categorías, comisiones y payouts (aprobar y liquidar), finanzas y confirmación de transferencias, reportes de soporte (asignar, responder, notas internas, estados), usuarios y roles, configuración versionada (moneda, idioma y país por defecto, comisión, impuestos por país, Shippo y tarifas de respaldo, transferencia bancaria, opciones).

Toda la lógica financiera usa las funciones del dominio en PostgreSQL: snapshots inmutables de checkout y pedido, reglas comerciales versionadas (comisión 10 % por artículo), captura de pago → creación de pedido, asientos de doble partida, liberación de fondos al entregar y payouts con política versionada.

## Internacionalización

- **Idiomas:** español e inglés. El idioma se elige con el selector de la cabecera (cookie `nx_locale`) y se guarda en la cuenta (`users.locale`); los correos y los mensajes de error de la API usan el idioma de cada usuario. Los textos de la interfaz usan el español como clave (`frontend/src/lib/i18n/en-*.json`); la taxonomía del catálogo (categorías y atributos) se devuelve en inglés desde la API.
- **Moneda:** una sola moneda del marketplace (USD por defecto), configurable en Administración → Configuración. Los pedidos y saldos anteriores conservan su moneda; los vendedores pueden retirar saldos en otras monedas.
- **Impuestos:** tabla `marketplace_tax_rates` por país de destino (IVA, VAT, GST, ITBIS…), editable desde el panel; cada pedido guarda el impuesto aplicado como evidencia. Las tasas iniciales son de referencia: confírmalas con un asesor fiscal (EE. UU. queda en 0 % hasta conectar un proveedor de sales tax).
- **Direcciones:** cualquier país ISO; estado y código postal validados donde las transportadoras los exigen (EE. UU., Canadá, México…).

## Pagos (Stripe y PayPal)

- **Tarjetas con Stripe:** el checkout muestra el *Payment Element* de Stripe (los datos de la tarjeta nunca pasan por nuestros servidores) y soporta 3-D Secure. Al pulsar «Pagar y confirmar compra» se crea el pago del pedido (PaymentIntent), el navegador lo confirma con Stripe y la API lo **verifica directamente con Stripe** antes de crear el pedido; una tarjeta rechazada puede reintentarse sobre el mismo pago.
- **PayPal:** botones oficiales de PayPal; la API crea la orden de PayPal (Orders v2) y la captura al aprobarse. Se activan solos al agregar `paypal_client_id` y `paypal_client_secret` (no requiere cambios de código).
- **Webhooks firmados (respaldo):** `POST /api/stripe/webhook` (evento `payment_intent.succeeded`) y `POST /api/paypal/webhook` (`PAYMENT.CAPTURE.COMPLETED`). Se verifican la firma y la repetición del evento, y queda constancia en `integration_webhook_receipts`; la confirmación por API y el webhook pueden llegar en cualquier orden sin duplicar pedidos.
- **Pagos abandonados:** si el comprador vuelve a editar el carrito o inicia otra compra, el pago pendiente se cancela en el proveedor (solo si no fue cobrado) y se libera el inventario; las reservas de pagos en línea vencen a los 30 min (transferencias: 72 h).
- **Sin claves de Stripe** (solo desarrollo local) la tarjeta usa el procesador sandbox interno. Tarjetas de prueba de Stripe: `4242 4242 4242 4242` aprobada · `4000 0027 6000 3184` 3-D Secure · `4000 0000 0000 9995` fondos insuficientes.

## Envíos con Shippo

- **Checkout:** por cada tienda se cotiza en vivo con Shippo desde la dirección de despacho del vendedor hasta la del comprador (USPS, UPS, DHL Express, Canada Post, etc.), con etiquetas «Más económico» / «Más rápido». Si la ruta no tiene transportadoras (p. ej. envíos domésticos dentro de RD), se ofrecen las tarifas fijas del marketplace; el retiro en tienda aparece cuando origen y destino están en el mismo país.
- **Etiquetas:** el vendedor compra la etiqueta del servicio pagado por el cliente («Comprar etiqueta»); los envíos internacionales generan la declaración de aduanas automáticamente. Etiqueta, factura comercial y costo quedan en el pedido. También puede registrar una guía manual con cualquier transportadora.
- **Rastreo:** webhook `POST /api/webhooks/shippo?token=<SHIPPO_WEBHOOK_TOKEN>` (evento `track_updated`, configurar en Shippo → Settings → Webhooks con la URL pública de la API), sondeo cada 30 min como respaldo y botón «Actualizar rastreo». Al entregarse se liberan los fondos del vendedor y se envían los correos.
- **Modo prueba:** con `shippo_test_…` las etiquetas no se cobran y, como Shippo no rastrea transportadoras reales en pruebas, «Actualizar rastreo» avanza con los eventos de prueba de Shippo (tránsito → entregado).
- **Transportadoras de la cuenta Shippo:** DHL Express requiere aceptar sus términos en Shippo (Settings → Carriers → «Activate Account»); hasta entonces sus etiquetas fallan con un mensaje claro y el vendedor puede reintentar o usar guía manual.

## Decisiones y límites del MVP

- **Pagos:** Stripe (tarjetas) y PayPal en modo prueba; transferencia bancaria confirmada por finanzas. La comisión de Stripe/PayPal no se registra aún como gasto en el libro mayor. Pago contra entrega no disponible.
- **Correo (Resend):** la API envía los correos transaccionales directamente con Resend desde `no-reply@nexovax.com` (dominio verificado). Cada evento se registra en `public.email_deliveries` y se envía una sola vez (`dedupe_key` + `Idempotency-Key`); un fallo de correo nunca bloquea la operación.
  - Comprador: bienvenida, recuperación de contraseña, pedido confirmado, instrucciones y rechazo de transferencia, pedido enviado (con guía) y entregado, reporte recibido, respuesta y resolución de soporte.
  - Vendedor: solicitud recibida, tienda aprobada/rechazada/suspendida/reactivada, nueva venta, pedido entregado, moderación de productos, retiro pagado/fallido/cancelado.
  - La recuperación de contraseña no usa el SMTP de Supabase: la API genera un token de un solo uso (`auth.admin.generateLink`) y envía el enlace a `/auth/restablecer`, que lo canjea con `verifyOtp`.
  - Variables: `MAIL_FROM` (por defecto `NEXOVAX <no-reply@nexovax.com>`), `MAIL_REPLY_TO`, `WEB_URL` (base de los enlaces; en producción la URL pública), `MAIL_SUPPRESS_DOMAINS` (por defecto los dominios demo `demo.nexovax.com`, `rdmarketplace.do`, `example.com`… nunca reciben correo) y `MAIL_REDIRECT_TO` (QA: desvía todos los correos a una dirección, p. ej. `delivered@resend.dev`).
  - Las cuentas creadas por la API se confirman al instante (`AUTH_AUTO_CONFIRM=true`).
- **Mensajería:** actualización por sondeo (5 s); Supabase Realtime requeriría políticas RLS de lectura para el navegador.
- **Ciudades:** texto libre por país; cada ciudad nueva se registra en `city_references` (las 49 de RD importadas de countries.dev se mantienen).
