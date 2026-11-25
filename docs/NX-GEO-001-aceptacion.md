# NX-GEO-001 · Matriz de aceptación (fase 4)

Fecha: 2026-11-21. Alcance: país de entrega sugerido, disponibilidad por destino, carrito sin registro.

Dónde se verificó cada caso:
- **Jest**: pruebas del backend (`pnpm --filter @rd/backend test`), 73/73 correctas en 11 suites.
- **Navegador**: `scripts/e2e-geo.mjs` con Chromium contra el frontend compilado y una API simulada, 11/11 correctas.
- **BD**: consultas SQL de solo lectura en Supabase (proyecto BovedaNegra) y el asesor de seguridad.
- **Producción**: `pnpm e2e:geo` contra https://nexovax.com y https://api.nexovax.com/api, ejecutado por el usuario el 2026-11-21: **30 correctas, 0 con problemas** (API, navegador y sin errores de JavaScript).

**Estado: NX-GEO-001 aceptado el 2026-11-21 y reabierto el 2026-11-23** por una auditoría externa sobre `12e35c9` que encontró cinco huecos (casos 26 a 33). Están corregidos en código y probados con Jest; queda pendiente aplicar la migración `20261125100000_nexovax_cart_merge_receipts.sql` en producción, desplegar la API en Render y repetir `pnpm e2e:geo`.

| # | Caso | Resultado | Evidencia |
|---|------|-----------|-----------|
| 1 | Primera visita sin cuenta: se sugiere un destino (IP o predeterminado) y se marca como sugerido | Correcto | Jest `delivery-context.spec`, `geo-http.spec`; navegador |
| 2 | Prioridad: cookie manual > cuenta > IP > predeterminado | Correcto | Jest `delivery-context.spec` |
| 3 | Cambio manual del destino se guarda en `nx_delivery_country` y se recupera en la siguiente visita | Correcto | Producción; navegador |
| 4 | Cambiar el destino no cambia el idioma (y viceversa) | Correcto | Producción; navegador; Jest |
| 5 | Cookie con país inválido se ignora | Correcto | Jest |
| 6 | Encabezados de país falsificados por el cliente no se aceptan (solo con `PROXY_SHARED_SECRET`) | Correcto | Jest `delivery-context.spec`, `geo-http.spec` |
| 7 | Respuestas de contexto y disponibilidad no se guardan en cachés compartidas (`private, no-store`) | Correcto | Jest `geo-http.spec` |
| 8 | Disponibilidad por producto y por variante: Disponible / No disponible / Por confirmar con motivo | Correcto | Jest `availability.spec` (regla `evaluateRoute`); ver caso 28 |
| 9 | Restricciones de tienda (ALL/DOMESTIC/ONLY/EXCEPT) y de producto (ALL/ONLY/EXCEPT) | Correcto | Jest `availability.spec` |
| 10 | Al cambiar el destino se vuelve a evaluar y la consulta usa el país elegido | Correcto | Producción; navegador (clave de caché por país) |
| 11 | País inválido o más de 100 productos por consulta se rechaza (400) | Correcto | Jest `geo-http.spec` |
| 12 | Ficha del producto muestra la disponibilidad para el destino | Correcto | Producción; navegador |
| 13 | El checkout revalida con el país de la dirección confirmada y bloquea `DESTINATION_UNAVAILABLE` | Correcto | Jest `checkout-destination.spec` |
| 14 | Visitante añade al carrito sin cuenta; el carrito muestra destino y productos | Correcto | Producción; navegador; Jest `guest-cart.spec` |
| 15 | Para pagar se pide iniciar sesión; `/checkout` sin sesión redirige a iniciar sesión | Correcto | Producción; navegador |
| 16 | Al iniciar sesión el carrito del invitado se une al de la cuenta, limitado al stock | Correcto | Jest `guest-cart.spec`; ver caso 30 |
| 17 | Variantes inexistentes o no publicadas no exponen datos en la vista previa | Correcto | Jest `guest-cart.spec` |
| 18 | Endpoints de cuenta, unión de carrito, checkout y destinos de la tienda exigen sesión (401) | Correcto | Jest `geo-http.spec` |
| 19 | Permisos del vendedor: destinos de tienda (área Configuración) y de producto (área Productos) | Correcto | Jest `authorization.spec` |
| 20 | RLS activo en `destination_restrictions`, su historial y `users`; anon/authenticated sin privilegios | Correcto | BD |
| 21 | Función del trigger de historial no ejecutable por anon/authenticated | Correcto | BD |
| 22 | Privacidad: no se guardan IPs completas (no hay columnas de IP) | Correcto | BD; ver caso 33 para los registros |
| 23 | Aviso de ubicación (LGPD) en `/ayuda#ubicacion`, enlazado desde el selector | Correcto | Producción; navegador; revisión de código |
| 24 | Ajustes editables en el panel (`geo.delivery`: detección IP, selector, países, días de historial) | Correcto | BD (ajuste activo); Jest admin |
| 25 | Sin errores de JavaScript en el recorrido | Correcto | Producción; navegador |

### Auditoría del 2026-11-23 (sobre `12e35c9`)

| # | Hallazgo | Corrección | Evidencia |
|---|----------|------------|-----------|
| 26 | El visitante elige DO, entra en una cuenta que tenía US: el navegador seguía en DO y la cuenta en US | Una elección hecha sin sesión queda marcada como pendiente y, al iniciar sesión, pasa a la cuenta. Sin elección pendiente, la preferencia de la cuenta (quizá cambiada en otro dispositivo) reemplaza la cookie. Navegador y cuenta terminan con el mismo país | Revisión de código (`frontend/src/lib/delivery.ts`) |
| 27 | Las tarjetas ocultaban «Por confirmar» | La tarjeta muestra los tres estados; el motivo aparece al pasar el cursor | Revisión de código (`components/shop/availability.tsx`) |
| 28 | La disponibilidad se consultaba por producto, sin la variante elegida | `POST /geo/availability` acepta `variantIds`; cada variante se evalúa con el origen del almacén que tiene su stock. La ficha usa la variante seleccionada, el carrito cada línea y el checkout bloquea por variante | Jest `geo-http.spec`, `checkout-destination.spec` |
| 29 | Tienda con varios almacenes: se cotizaba un solo origen | El checkout reparte las líneas por almacén con la misma prioridad que el pedido, cotiza cada origen, ofrece solo los métodos que todos los orígenes pueden enviar y cobra la suma. Al crear el pedido se comprueba que los almacenes reales coinciden con los cotizados (`SHIPPING_ORIGIN_CHANGED`) | Jest `checkout-origins.spec` |
| 30 | Un reintento de la unión del carrito podía duplicar cantidades | Clave por carrito invitado (`mergeKey`) y recibo en `cart_merge_receipts`; todas las líneas se aplican en una sola transacción | Jest `guest-cart.spec` |
| 31 | Se podía confirmar con una dirección distinta de la cotizada | Resuelto en `4204553`: el pedido lleva la versión de la dirección cotizada (`addressVersion`), la dirección se bloquea durante la transacción y se rechaza si cambió (`CHECKOUT_ADDRESS_CHANGED`) | Jest `checkout-destination.spec` |
| 32 | El importe aceptado podía no coincidir con el cobrado | El pedido lleva el total que vio el comprador y se rechaza si el importe calculado es otro (`CHECKOUT_TOTAL_CHANGED`). La página vuelve a cotizar ante cualquiera de estos rechazos | Revisión de código |
| 33 | El aviso dice que no se guarda la IP, pero los registros HTTP incluían `remoteAddress` | Los registros HTTP ya no incluyen la IP; Sentry (API y web) elimina la IP y los encabezados que la contienen | Revisión de código (`app.module.ts`, `instrument.ts`) |

Pendiente operativo (fuera del código): activar en Sentry la opción del proyecto "Prevent Storing of IP Addresses" y revisar la retención de registros de Render y Vercel.

Observación del asesor de seguridad de Supabase: solo el aviso informativo "RLS habilitado sin políticas" en las tablas nuevas. Es intencional: solo la API accede a ellas con su rol propio.

## Cómo repetirlo en producción

```bash
WEB_URL=https://nexovax.com API_URL=https://api.nexovax.com/api pnpm e2e:geo
```

No crea cuentas ni escribe datos. Termina con código 1 si algún caso falla.
