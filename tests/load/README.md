# Pruebas de carga (k6)

Simulan visitantes que navegan la tienda a través de la API pública: inicio → categorías →
listado (página y orden al azar) → detalle de producto → opiniones → búsqueda.
Solo lectura: no crean cuentas, carritos ni pedidos.

## Perfiles (`PROFILE`)

| Perfil | Usuarios virtuales | Duración | Para qué |
| --- | --- | --- | --- |
| `smoke` (por defecto) | 1 | 30 s | Comprobar que todo responde. Úsalo tras cada despliegue. |
| `load` | sube a 10 y se mantiene | ~4,5 min | Tráfico normal esperado. Debe cumplir los umbrales. |
| `stress` | 20 → 40 → 60 | ~6 min | Encontrar el punto de quiebre. |
| `spike` | 50 de golpe | ~1,5 min | Picos repentinos (campañas, redes sociales). |

Umbrales de `smoke` y `load`: menos de 1 % de errores; p95 por debajo de 800 ms en listados,
1 s en detalle y 600 ms en búsqueda. `stress` y `spike` solo fallan con más de 5 % de errores.

## Cómo ejecutarlas

**Desde GitHub (recomendado):** primero copia `tests/load/load-test.workflow.yml` a
`.github/workflows/load-test.yml` y súbelo (una sola vez). Luego: Actions → *Load test (k6)* →
*Run workflow*, elige el perfil. El resumen queda como artefacto `k6-summary-<perfil>`.

**En tu equipo** ([instalar k6](https://grafana.com/docs/k6/latest/set-up/install-k6/)):

```bash
k6 run tests/load/browse.js                                    # smoke contra producción
PROFILE=load k6 run tests/load/browse.js
API_URL=http://localhost:4000/api PROFILE=stress k6 run tests/load/browse.js
```

## Límite por IP

La API permite 300 peticiones por minuto por IP. Desde una sola máquina, todos los usuarios
virtuales comparten ese límite y verás respuestas 429: se cuentan aparte (`rate_limited`), no
como errores. Para medir la capacidad real, define `PROXY_SHARED_SECRET` (el mismo de Render;
en GitHub, como secreto del repositorio): cada usuario virtual se presenta con su propia IP del
rango de pruebas 198.18.0.0/15, igual que hace la web con los visitantes reales.

## Antes de lanzar `load`, `stress` o `spike` contra producción

- El plan gratuito de Render tiene 0,1 CPU y 512 MB: `stress` y `spike` lo saturarán. Es lo
  que queremos medir, pero la tienda irá lenta mientras dure. Hazlo en horas sin visitas.
- La base usa el pooler de Supabase: con `DATABASE_URL` en el puerto 5432 (modo sesión) hay
  un máximo de 15 conexiones; usa el puerto 6543 (modo transacción).
- Las peticiones cuentan para el uso de Render, Supabase y GitHub Actions.
