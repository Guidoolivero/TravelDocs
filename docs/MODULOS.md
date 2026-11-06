# Modulos de TradingDocs

La aplicacion se organiza por funcionalidad. Cada modulo mantiene separados el
codigo publico del navegador y el codigo privado de las Functions. La reorganizacion
no cambia las colecciones de Firestore, los permisos ni los contratos HTTP.

## Ubicaciones

| Funcionalidad | Navegador (`public/js/`) | Backend |
| --- | --- | --- |
| Facturacion | `facturacion/` | `netlify/functions/lib/facturacion/` |
| Administracion | `administracion/` | `netlify/functions/lib/administracion/` |
| Pasajeros | `pasajeros/` | Persistencia tenant en `public/js/db.js` |
| Documentos y OCR | `documentos/` | `netlify/functions/lib/documentos/` |
| Reservas y PNR | `reservas/` | `netlify/functions/lib/reservas/` |
| Requisitos | `requisitos/` | `netlify/functions/lib/requisitos/` y `lib/requisitos/` |
| Alertas | `alertas/` | `netlify/functions/lib/alertas/` |
| Importacion | `importacion/` | Alta mediante la persistencia existente |
| Ciudades | `ciudades/` | Catalogo mediante la persistencia existente |
| Dashboard | `dashboard/` | Sin endpoint propio |

`public/js/app.mjs` inicia las pantallas, coordina autenticacion, snapshots y
navegacion. `compartido/estado.mjs` conserva la unica instancia de las listas de
pasajeros y reservas y del contexto de sesion. Las pantallas leen esa instancia,
por lo que una actualizacion del snapshot no deja copias viejas en otros modulos.

Las pantallas registran eventos mediante sus funciones `init...()`, llamadas una
vez desde `app.mjs`. Cambiar de vista renderiza; no vuelve a inicializar listeners.
Los handlers existentes en `window` se conservan por compatibilidad con el HTML.
La salida de sesion conserva la navegacion a login y la limpieza tenant existente.

Los imports ESM identifican las dependencias entre modulos. Las reglas reutilizadas
por varias pantallas tienen archivos propios: duplicados, contactos, agrupacion de
documentos, modelo de alertas y helpers de aerolineas. El transporte administrativo
vive en `administracion/api.mjs`; Facturacion lo utiliza sin importar esa pantalla.

`compartido/cargas.mjs` conserva las cargas diferidas de scanner, itinerarios y
requisitos. `compartido/pdf.mjs` comparte el visor PDF entre itinerarios y facturas.
Firebase se inicializa una sola vez en `compartido/firebase.mjs`. `db.js` sigue
siendo el propietario del contexto tenant y de las suscripciones a Firestore.

## Funciones y archivos privados

Las entradas `netlify/functions/*.cjs` conservan sus nombres y delegan en la
implementacion del modulo. Esto mantiene las URLs, la programacion de alertas y
el descubrimiento de entradas de `scripts/bundle-functions.mjs`.

Autenticacion, medicion de uso y Sentry conservan sus helpers de infraestructura.
La administracion de agencias sigue escribiendo el perfil fiscal en la misma
transaccion. Los secretos y assets privados del PDF quedan fuera de `public/`.
`netlify.toml` incluye las fuentes y el logo desde la carpeta de Facturacion.

El HTML y los estilos conservan su ubicacion y diseno actuales. El build publica
solo una copia de `public/` en `.netlify/site`, con imports versionados y retencion
de versiones anteriores. No copiar tests, documentos o codigo backend a `public/`.

## Datos generados y pruebas

- `node scripts/gen-conocidos.mjs` genera `public/js/requisitos/conocidos.mjs`
  desde `docs/conocidos.json`.
- `node scripts/gen-matriz.mjs` genera `lib/requisitos/matriz.mjs` desde
  `docs/travel-db.json`. No editar estos archivos generados a mano.
- `npm test` ejecuta los unitarios, incluidos los de Facturacion en
  `tests/facturacion/` y la regresion del build con subcarpetas.
- `npm run test:billing:emulator` valida el servicio y el store en Firestore local.
- `npm run test:billing:ui` prueba la pantalla con servicios simulados.
- `tests/facturacion/billing-package.smoke.mjs` valida el arranque del paquete
  Netlify. Requiere el bundle y la ruta al CLI, como en el workflow de CI.
- `tests/agency-ui.smoke.mjs` y `tests/mfa-ui.smoke.mjs` cubren flujos de agencia
  y sesion con servicios simulados. Usar `PUBLIC_DIR` para probar el build generado.

Los scripts operativos de Facturacion estan en `scripts/facturacion/`.
Los comandos npm mantienen sus nombres; `postinstall` apunta a la nueva ubicacion
del parche existente del SDK fiscal.

La documentacion operativa de Facturacion esta en `docs/facturacion/`.
