# Futura modularización TravelDocs

Aprobado el 2026-10-01. Guardado para hacerlo más adelante. No está implementado.

## Decisión

`js/app.mjs` tiene 5018 líneas. Si más adelante se sacan las pantallas grandes, el archivo que queda (Firebase, sesión, listas de pasajeros y reservas, cambio de vista, dashboard, lista, documentos, alertas, detalle) baja a cerca de 1200. El resto queda en archivos de reservas, admin, requisitos, formulario, scanner, importación y ciudades. Ninguno pasa de unas 700 líneas.

No se hace de una sola vez. El código pinta el DOM, cuelga funciones de `window` y usa las listas que viven en el mismo archivo. No hay tests de navegador. `npm test` no avisa si se rompió guardar un pasajero, el check-in o el OCR. En Reservas, `document.getElementById('res-piernas')` (línea 3278, al 2026-10-01) corre al cargar el archivo: mover el bloque mal tira abajo la pantalla, que hoy anda y está en producción.

Cuando una feature ya obligue a tocar una pantalla, esa pantalla se muda en ese mismo cambio. El resto se queda donde está.

`js/conocidos.mjs` no entra. Lo genera un script desde `docs/conocidos.json`.

## Archivos, cuando se haga

| Archivo | Qué se lleva | Líneas |
| --- | --- | --- |
| `js/reservas-modelo.mjs` | Piernas, fechas, duplicado | ~250 |
| `js/reservas-lista.mjs` | Lista de check-in | ~180 |
| `js/reservas-form.mjs` | Modal y guardar | ~300 |
| `js/reservas-pnr.mjs` | PNR y PDF | ~220 |
| `js/admin.mjs` | Agencias, usuarios, uso | ~650 |
| `js/requisitos-ui.mjs` | Requisitos y parser GDS | ~500 |
| `js/formulario-pasajero.mjs` | Alta, visas, asistencia, viajero frecuente | ~465 |
| `js/scanner-ui.mjs` | OCR y la ficha | ~460 |
| `js/importar.mjs` | Import masivo y Excel | ~520 |
| `js/ciudades-ui.mjs` | Ciudades GDS | ~190 |

Reservas sola tiene ~950 líneas, por eso va en cuatro archivos. El resto, un archivo por pantalla.

## Cómo se conectan

Cada archivo exporta `init(deps)` y no importa `app.mjs`. `app.mjs` los importa y les pasa leer pasajeros, leer reservas, `esc`, `showToast`, abrir y cerrar modal, y refrescar la vista.

Los `window.saveReservation` y el resto se asignan dentro de `init`, no al cargar el archivo.

Antes de sacar Reservas: el `getElementById('res-piernas')` de la línea 3278 pasa adentro del handler. Hoy la sección no carga sola. Probado en Node el 2026-10-01: al importarla, `window` no existe; con un `window` vacío, revienta ese `getElementById`.

`findDuplicateReservation` no se mueve sola. Cierra sobre `passengers` y `reservations`. Hay que pasarle las dos listas.

## Qué ya se probó en Node, sin editar el repo

- Fechas de Excel (líneas 2248–2396): `15DEC86` da `1986-12-15`, `4 de julio de 1997` da `1997-07-04`, serial `1` da `1899-12-31`. La fila Rosende / Rodolfo / 15DEC86 / 30111222 arma el pasajero. Viaja con `importar.mjs`.
- `parseGDSSegmentos` (líneas 3894–3928): `2  MU 746 R 28APR 2*EZEPVG HK1` queda `MU746` EZE–PVG `28APR`. Viaja con `requisitos-ui.mjs`.
- Duplicado de reserva, si recibe las dos listas: ROSENDE en `AR1234` el 2026-10-15 encuentra la reserva `a`. En `AR9999` devuelve null. El vuelo en minúscula y la fecha con hora siguen matcheando. Movida sola tira `passengers is not defined`. Viaja con `reservas-modelo.mjs`.
- `app.mjs` entero no carga en Node: el primer import es Firebase por `https://`.

El test de Node de cada función pura se escribe en el repo en el momento de moverla, antes del movimiento. Esos tres ensayos fueron en memoria y no quedaron como archivos de test.

## Orden, el día que se arranque

Un archivo por cambio. En cada uno: test de lo puro, mover el bloque, `init(deps)`, `npm test`, y probar esa pantalla en el navegador.

1. `importar.mjs`
2. `requisitos-ui.mjs`
3. `reservas-modelo.mjs`
4. `reservas-lista.mjs`, `reservas-form.mjs`, `reservas-pnr.mjs`
5. `formulario-pasajero.mjs`
6. `scanner-ui.mjs`
7. `ciudades-ui.mjs`
8. `admin.mjs`

Sacar solo fechas de Excel y el parser GDS baja unas 200 líneas. Eso no se hace como proyecto: no cambia el archivo.
