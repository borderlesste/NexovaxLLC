# NEXOVAX — Marketplace multivendedor internacional

Marketplace multivendedor internacional (español e inglés): compradores y vendedores de cualquier país, envíos con Shippo, impuestos por país de destino, moderación y administración financiera.
Monolito modular según `# Stack tecnológico recomendado par.md`:

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Radix UI (estilo shadcn) · Lucide · TanStack Query · React Hook Form/Zod · Recharts · Sonner |
| Backend | NestJS 11 · REST + OpenAPI (`/api/docs`) · `pg` · `jose` (JWT de Supabase vía JWKS) · class-validator · throttler · schedule · nestjs-pino · sharp |
| Datos e identidad | Supabase (PostgreSQL 17, Auth, Storage) |
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
   - `seed_password` — contraseña de las cuentas de demostración que crea el seed (no se versiona).
   - `supabase_url` y `supabase_publishable_key` — URL del proyecto Supabase y su clave pública (`sb_publishable_…`).
   - `database_url` — cadena de conexión del rol de la API (pooler de Supabase).
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

### Cuentas de demostración (contraseña en `.secrets/seed_password` o `SEED_PASSWORD`)

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
  - **Verificación de correo:** quien se registra recibe un enlace (token de un solo uso, `generateLink`) a `/auth/confirmar`; hasta confirmarlo no puede iniciar sesión y la API responde `EMAIL_NOT_VERIFIED`. Reenvío: `POST /api/auth/resend-verification`. Las tiendas creadas por el equipo y las cuentas demo del seed se crean ya confirmadas. `AUTH_AUTO_CONFIRM=true` solo se acepta fuera de producción.

## Datos geográficos

País, estado, ciudad, código postal y teléfono se validan juntos según el país: el estado debe ser de la lista del país (se guarda el código que esperan las transportistas, p. ej. `FL`, `ON`), la ciudad se normaliza y debe pertenecer a ese estado cuando está en el catálogo, el código postal sigue el formato del país y el teléfono escrito sin `+` recibe el prefijo del país (`+1 809 555 0101`).

- Fuente: [GeoNames](https://www.geonames.org) (CC BY 4.0, atribución en el pie de página): prefijos y formatos postales de 250 países, 3.865 estados/provincias, ~70.000 ciudades de más de 5.000 habitantes y códigos postales de AR, BR, CA, CL, CO, DE, DO, ES, FR, IT, MX, PE, PR y US.
- Endpoints públicos: `GET /api/geo/countries/:code`, `GET /api/geo/cities?country=&region=&q=`, `GET /api/geo/postal?country=&code=` (sugerencias).
- Reimportar: descargar los archivos en `scripts/data/geonames/` (ver cabecera de `scripts/geo-import.mjs`), conceder temporalmente los permisos de la migración `20261114140000_nexovax_geo_reference.sql` y ejecutar `node ../scripts/geo-import.mjs` desde `backend/`.

## Protección anti-bots (Cloudflare Turnstile)

Turnstile protege los formularios públicos de autenticación en dos capas, porque no todos llegan al mismo sitio:

| Formulario | Destino | Quién valida el token |
|---|---|---|
| Iniciar sesión | Supabase Auth (navegador) | Supabase (CAPTCHA activado en Auth) |
| Registro, recuperar contraseña, reenviar verificación | API NestJS (`/api/auth/*`) | `TurnstileGuard` contra `siteverify` de Cloudflare |

La API usa la clave de administrador de Supabase en esos tres endpoints, que se salta el CAPTCHA de Supabase; por eso valida el token por su cuenta.

1. **Cloudflare → Turnstile:** crea un widget (modo *Managed*) con tus dominios y `localhost`.
2. **API:** `.secrets/turnstile_site_key` y `.secrets/turnstile_secret_key` (o `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`). La web recibe la *site key* desde `/api/config/public`; sin claves los formularios funcionan como antes, salvo en producción, donde los tres endpoints responden 503 (`CAPTCHA_UNAVAILABLE`).
3. **Supabase → Authentication → Attack Protection:** activa *CAPTCHA protection* con Turnstile y la misma *secret key*. Así también quedan protegidas las llamadas directas a `/auth/v1/signup`, `/recover`, `/resend` y `/token`.
4. **Supabase → Sign In / Providers:** desactiva *Allow new users to sign up*. El registro de NEXOVAX sigue funcionando (la API crea las cuentas con la clave de administrador), pero nadie puede crear cuentas llamando a Supabase directamente. Consecuencia: Google/Apple solo sirven para cuentas ya existentes.
5. **Desarrollo y seed:** usa las claves de prueba de Cloudflare (site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`) en la API y en Supabase; el seed envía el token de prueba `XXXX.DUMMY.TOKEN.XXXX` (`TURNSTILE_TEST_TOKEN` para cambiarlo).

## IP real del visitante y límites de frecuencia

El navegador llama a la API a través del proxy `/api` de Next.js, así que sin ayuda la API solo ve la IP del servidor web y **todos los visitantes compartirían el mismo límite** (p. ej. 5 registros por minuto para todo el sitio).

- **Web (`frontend/src/middleware.ts`):** en cada `/api/*` toma la IP del visitante **solo** de la cabecera que pone tu borde (`CLIENT_IP_HEADER`: `cf-connecting-ip` detrás de Cloudflare, `x-real-ip` en Vercel o detrás de nginx; en Vercel se usa `x-real-ip` por defecto) y la envía a la API en `x-nx-client-ip` junto con `x-nx-proxy-secret`. Lo que mande el navegador en esas cabeceras se descarta.
- **API (`backend/src/common/client-ip.ts`):** solo confía en `x-nx-client-ip` si el secreto coincide; nunca en `X-Forwarded-For`. Con esa IP: límites de frecuencia por visitante, logs, y la cabecera `Sb-Forwarded-For` en las llamadas de administración a Supabase Auth.
- **Configuración:** el mismo valor aleatorio en `PROXY_SHARED_SECRET` en la web y en la API (`.secrets/proxy_shared_secret`; `openssl rand -hex 32`) y `CLIENT_IP_HEADER` en la web. Sin ellas todo funciona, pero los límites de la API se aplican a la IP del servidor web.
- **Supabase → Authentication → Attack Protection:** activa *Enable IP address forwarding* para que Supabase respete `Sb-Forwarded-For` (solo con claves `sb_secret_…`). El inicio de sesión va directo del navegador a Supabase, así que ahí Supabase ya ve la IP real.
- **Supabase → Authentication → Rate Limits:** ajusta los límites por IP (inicio de sesión/registro, verificación, renovación de tokens). Los correos de NEXOVAX salen por Resend desde la API, no por el SMTP de Supabase.
- **Subidas y descargas privadas van directo a la API** (no por Vercel, cuyo límite de ~4,5 MB por petición las cortaría): con `NEXT_PUBLIC_API_URL` (origen público de la API, p. ej. `https://api.nexovax.com`) el helper `upload()` y `fetchBlobUrl()` llaman a la API sin pasar por `/api`. Requiere `CORS_ORIGINS` en la API con el dominio de la web (p. ej. `https://nexovax.com,https://www.nexovax.com`). Sin `NEXT_PUBLIC_API_URL` todo pasa por `/api` (desarrollo local).
- **IP en peticiones directas:** llegan por el balanceador del hosting de la API; `CLIENT_IP_HEADER` en la API indica la cabecera que pone ese balanceador (`x-forwarded-for` → se usa la última entrada, `cf-connecting-ip`, `true-client-ip`…). Solo se lee cuando la conexión viene de una dirección privada (el balanceador).
- `experimental.middlewareClientMaxBodySize` está en 80 MB por si alguna subida pasa por el middleware (sin `NEXT_PUBLIC_API_URL`).

## Protección contra abuso y DDoS

- **Borde:** el DDoS volumétrico se frena antes de llegar a los servidores: Vercel (mitigación automática, *Attack Challenge Mode*) y Cloudflare delante de la API (`api.nexovax.com` con proxy activado y reglas de WAF/límite de frecuencia).
- **API:** límite por IP real (300/min global y límites propios en autenticación, subidas, pagos…), Turnstile, contraseñas filtradas, tamaño de subidas acotado.
- **Base de datos:** el rol `nexovax_api_runtime` tiene `statement_timeout = 15s`, `idle_in_transaction_session_timeout = 30s` y `lock_timeout = 10s` (migración `20261118120000_nexovax_api_runtime_timeouts.sql`): una consulta lenta no puede acaparar las conexiones del pool (`DB_POOL_MAX`, 8 por defecto). `scripts/geo-import.mjs` amplía su propio límite.
- **Paginación:** como máximo 200 páginas (`backend/src/common/paging.ts`); valores no numéricos vuelven a la página 1.
- **HTTP:** una petición completa debe llegar en 120 s (`HTTP_REQUEST_TIMEOUT_MS`), frente a clientes lentos (slowloris).
- **Límites en memoria:** el contador de peticiones vive en el proceso. Con más de una instancia en Render habría que moverlo a un almacenamiento compartido.

## Contraseñas filtradas

Se rechazan las contraseñas que aparecen en filtraciones conocidas (Have I Been Pwned, por *k-anonymity*: solo salen los 5 primeros caracteres del SHA-1, nunca la contraseña).

- **Registro y cambio de contraseña en Seguridad** pasan por la API, que usa la clave de administrador de Supabase y por eso no recibe esa protección de Supabase: la API la aplica por su cuenta (`backend/src/common/password.ts`, error `PASSWORD_LEAKED`). Si el servicio no responde, la contraseña se acepta y queda en el log. `PASSWORD_LEAK_CHECK=false` la desactiva.
- **Restablecer contraseña** (`/auth/restablecer`) va directo a Supabase: activa *Prevent use of leaked passwords* en Supabase → Authentication → Attack Protection (requiere plan Pro).
- La contraseña del seed (`.secrets/seed_password`) también debe ser única, o el seed no podrá crear las cuentas demo.

## Seguridad operativa

- **Base de datos:** TLS con verificación de certificado contra la CA raíz de Supabase incluida en `backend/certs/supabase-root-2021.crt` (`DATABASE_CA_FILE` para otra CA). `DATABASE_SSL_INSECURE=true` solo en desarrollo local; en producción la API no arranca sin verificación.
- **Tarjeta simulada:** sin Stripe configurado la tarjeta aparece como no disponible. `PAYMENT_SANDBOX_ENABLED=true` habilita capturas simuladas solo en desarrollo (nunca con `NODE_ENV=production` ni `PAYMENT_ENVIRONMENT=LIVE`).
- **Entregas:** el vendedor solo informa tránsito/en ruta/incidencia. «Entregado» (que libera fondos) lo confirma el comprador, la transportista (Shippo) o soporte; los envíos con guía manual sin confirmación se cierran solos tras `AUTO_CONFIRM_DELIVERY_DAYS` (14 por defecto). Los envíos con rastreo automático no se pueden editar a mano.
- **Enlaces de rastreo:** para transportadoras conocidas el enlace se genera desde el número de guía; para otras solo se acepta `https` y se muestra el dominio como «sitio externo».
- **Webhooks:** con claves live de Shippo el estado se vuelve a consultar en la API de Shippo (el payload no es fuente de verdad). Los logs HTTP nunca incluyen la query string. El webhook de PayPal descarta peticiones sin cabeceras de firma válidas antes de llamar a PayPal y tiene límite de frecuencia.
- **Imágenes:** máx. 8 MB, 8000 px por lado y 40 MP, se valida el formato real (no el declarado), sin animaciones, procesamiento con concurrencia limitada y límite de subidas por minuto.
- **Moderación:** con moderación obligatoria, cualquier cambio de contenido visible (textos, marca, atributos, opciones, variantes o imágenes) de un producto activo lo devuelve a revisión; precio y stock no.
- **Administración:** solo un super administrador puede modificar cuentas o roles de administradores; siempre queda al menos un super administrador activo.
- **Web:** CSP y cabeceras de seguridad (`frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`); el parámetro `next` del login solo admite rutas internas.
- **Mensajería:** actualización por sondeo (5 s); Supabase Realtime requeriría políticas RLS de lectura para el navegador.
- **Ciudades:** texto libre por país; cada ciudad nueva se registra en `city_references` (las 49 de RD importadas de countries.dev se mantienen).
