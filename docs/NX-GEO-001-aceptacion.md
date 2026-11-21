# NX-GEO-001 · Matriz de aceptación (fase 4)

Fecha: 2026-11-21. Alcance: país de entrega sugerido, disponibilidad por destino, carrito sin registro.

Dónde se verificó cada caso:
- **Jest**: pruebas del backend (`pnpm --filter @rd/backend test`), 73/73 correctas en 11 suites.
- **Navegador**: `scripts/e2e-geo.mjs` con Chromium contra el frontend compilado y una API simulada, 11/11 correctas.
- **BD**: consultas SQL de solo lectura en Supabase (proyecto BovedaNegra) y el asesor de seguridad.
- **Producción**: `pnpm e2e:geo` contra https://nexovax.com y https://api.nexovax.com/api, ejecutado por el usuario el 2026-11-21: **30 correctas, 0 con problemas** (API, navegador y sin errores de JavaScript).

**Estado: NX-GEO-001 aceptado y cerrado el 2026-11-21.**

| # | Caso | Resultado | Evidencia |
|---|------|-----------|-----------|
| 1 | Primera visita sin cuenta: se sugiere un destino (IP o predeterminado) y se marca como sugerido | Correcto | Jest `delivery-context.spec`, `geo-http.spec`; navegador |
| 2 | Prioridad: cookie manual > cuenta > IP > predeterminado | Correcto | Jest `delivery-context.spec` |
| 3 | Cambio manual del destino se guarda en `nx_delivery_country` y se recupera en la siguiente visita | Correcto | Producción; navegador |
| 4 | Cambiar el destino no cambia el idioma (y viceversa) | Correcto | Producción; navegador; Jest |
| 5 | Cookie con país inválido se ignora | Correcto | Jest |
| 6 | Encabezados de país falsificados por el cliente no se aceptan (solo con `PROXY_SHARED_SECRET`) | Correcto | Jest `delivery-context.spec`, `geo-http.spec` |
| 7 | Respuestas de contexto y disponibilidad no se guardan en cachés compartidas (`private, no-store`) | Correcto | Jest `geo-http.spec` |
| 8 | Disponibilidad por producto: Disponible / No disponible / Por confirmar con motivo | Correcto | Jest `availability.spec` (regla `evaluateRoute`) |
| 9 | Restricciones de tienda (ALL/DOMESTIC/ONLY/EXCEPT) y de producto (ALL/ONLY/EXCEPT) | Correcto | Jest `availability.spec` |
| 10 | Al cambiar el destino se vuelve a evaluar y la consulta usa el país elegido | Correcto | Producción; navegador (clave de caché por país) |
| 11 | País inválido o más de 100 productos por consulta se rechaza (400) | Correcto | Jest `geo-http.spec` |
| 12 | Ficha del producto muestra la disponibilidad para el destino | Correcto | Producción; navegador |
| 13 | El checkout revalida con el país de la dirección confirmada y bloquea `DESTINATION_UNAVAILABLE` | Correcto | Jest `checkout-destination.spec` |
| 14 | Visitante añade al carrito sin cuenta; el carrito muestra destino y productos | Correcto | Producción; navegador; Jest `guest-cart.spec` |
| 15 | Para pagar se pide iniciar sesión; `/checkout` sin sesión redirige a iniciar sesión | Correcto | Producción; navegador |
| 16 | Al iniciar sesión el carrito del invitado se une al de la cuenta, limitado al stock | Correcto | Jest `guest-cart.spec` |
| 17 | Variantes inexistentes o no publicadas no exponen datos en la vista previa | Correcto | Jest `guest-cart.spec` |
| 18 | Endpoints de cuenta, unión de carrito, checkout y destinos de la tienda exigen sesión (401) | Correcto | Jest `geo-http.spec` |
| 19 | Permisos del vendedor: destinos de tienda (área Configuración) y de producto (área Productos) | Correcto | Jest `authorization.spec` |
| 20 | RLS activo en `destination_restrictions`, su historial y `users`; anon/authenticated sin privilegios | Correcto | BD |
| 21 | Función del trigger de historial no ejecutable por anon/authenticated | Correcto | BD |
| 22 | Privacidad: no se guardan IPs completas (no hay columnas de IP) | Correcto | BD |
| 23 | Aviso de ubicación (LGPD) en `/ayuda#ubicacion`, enlazado desde el selector | Correcto | Producción; navegador; revisión de código |
| 24 | Ajustes editables en el panel (`geo.delivery`: detección IP, selector, países, días de historial) | Correcto | BD (ajuste activo); Jest admin |
| 25 | Sin errores de JavaScript en el recorrido | Correcto | Producción; navegador |

Observación del asesor de seguridad de Supabase: solo el aviso informativo "RLS habilitado sin políticas" en las tablas nuevas. Es intencional: solo la API accede a ellas con su rol propio.

## Cómo repetirlo en producción

```bash
WEB_URL=https://nexovax.com API_URL=https://api.nexovax.com/api pnpm e2e:geo
```

No crea cuentas ni escribe datos. Termina con código 1 si algún caso falla.
