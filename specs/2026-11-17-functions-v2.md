# Netlify Functions en API v2

Estado: en curso
Rama: migra-functions-v2 (local; el merge a main lo autoriza el usuario)

## Problema y pedido

Las 13 Netlify Functions exportan `exports.handler` (modo Lambda). Netlify deja de aceptar deploys con funciones en modo Lambda desde el 1 de julio de 2027. Hay que pasarlas a la API v2: `default (req, context) => Response`.

## Comportamiento y alcance

- Netlify detecta una funcion como v2 cuando el archivo de entrada tiene un export `default` y ningun `handler`. Acepta CommonJS (`exports.default = ...` en `.cjs`), asi que no hace falta pasar a ESM (verificado en el parser de zip-it-and-ship-it y en la doc de Netlify Functions).
- Un adaptador chico (`netlify/functions/_v2.cjs`) convierte el `Request` en el evento que ya leen los handlers (`httpMethod`, `path`, `rawUrl`, `headers`, `queryStringParameters`, `body`) y la respuesta `{ statusCode, headers, body }` en un `Response`. La logica interna, `verifyAuth(event)` y `reply()` no cambian.
- Las entradas de `netlify/functions/*.cjs` exportan solo `default`. Las URLs publicas `/.netlify/functions/<nombre>` (y sus subrutas, como `admin-api/agencies/...`) siguen iguales.
- `send-alerts` sigue programada desde `netlify.toml`; `slack-orchestrator-background` sigue en background por el sufijo del nombre.
- El bundle de produccion (`scripts/bundle-functions.mjs`, esbuild a CJS) tiene que conservar un `exports.default` visible en el nivel superior del archivo, porque Netlify lee la forma del export del archivo ya empaquetado.

## Criterios de aceptacion

- CA-1: cada archivo de entrada en `netlify/functions/` exporta `default` y no exporta `handler`.
- CA-2: el adaptador entrega al handler metodo, path, query, headers y body del `Request`, y devuelve un `Response` con el status, headers y body del handler (sin body cuando no hay).
- CA-3: los tests que invocan handlers (`npm test`, `npm run test:billing:emulator`) pasan llamando la entrada v2 con un `Request`.
- CA-4: el bundle de produccion deja cada funcion detectada como v2.
- CA-5: `netlify dev` + e2e local (`flujo.e2e.ts`, sin tag ia) pasa.
- CA-6: un deploy de preview responde en las funciones (401 sin token). El 200 de facturacion se verifica en local, porque en previews la facturacion esta deshabilitada (sustitucion aceptada por el usuario).

## Plan minimo

`_v2.cjs` nuevo; las 8 entradas de una linea y las 5 con handler propio pasan a `exports.default = v2(handler)`; `tests/firebase-fixture.mjs`, `tests/route-agent.test.mjs` y el smoke de billing invocan `default`; footer en el bundle de produccion.

## Verificacion y revision

- CA-1: `tests/functions-v2.test.mjs` fallo antes del cambio (entradas con `module.exports = require(...)`) y pasa despues. La forma `exports.default = require('./_v2.cjs')(...)` tambien fallaba en Netlify: zip-it-and-ship-it la tomaba como v1 porque solo reconoce la llamada a un identificador. Por eso el test exige `exports.default = v2(`.
- CA-2: mismo test; incluye el caso `reply(204, {})` de `mfa-admin` y `admin-api` (un `Response` 204 con body tira TypeError). Fallo antes del arreglo y pasa despues.
- CA-3: `npm test` 542/542. `npm run test:billing:emulator` 23/23. `tests/firebase-fixture.mjs` y `tests/route-agent.test.mjs` llaman la entrada v2 con un `Request`.
- CA-4: `billing-package.smoke.mjs` ahora verifica que las 13 functions del bundle son v2 y que cada una resuelve a una funcion como lo hace el runtime de Netlify (`default` del modulo y `default` del export). Encontro un error real: el proxy de Sentry dejaba `module.exports.default = { default: fn }`; lo corrige el footer de `scripts/bundle-functions.mjs`. En v2 Netlify vuelve a empaquetar `billing-pdf` (nft, CJS a ESM): el debug id de Sentry se conserva y el PDF responde 401 sin credenciales.
- CA-5: e2e local `flujo.e2e.ts` sin tag ia: 2/2 contra `netlify dev --dir .netlify/site --functions netlify/functions`. Desde un worktree de git, `netlify dev` sin esos flags toma otra carpeta base (sube hasta un `.git` que sea directorio) y no carga functions; en el checkout normal no pasa.
- CA-6: deploy de preview (draft en tradingdocs-staging): las 13 responden igual que antes (401 sin token, incluidas subrutas de `admin-api`, `billing-api` y `billing-pdf`; `slack-orchestrator-background` 202; `send-alerts` 403 porque es programada; OPTIONS `mfa-admin` 204).
  El 200 con token no se puede probar en el preview: en deploy-preview no hay `BILLING_ENABLED`, `ARCA_*` ni `BILLING_FIREBASE_PROJECT_ID`, y el service account apunta a `tradingdocs-mt`, que `assertBillingEnvironment` rechaza fuera de produccion; `billing-pdf` responde 503 antes de cargar `facturas`. El usuario acepto cerrarlo con evidencia local: `tests/facturacion/billing-pdf.test.mjs` 11/11 (llama a `billing-pdf` con auth simulada sobre una factura autorizada, que pasa por `import('facturas')`, y sobre un borrador; exige 200, decodifica el PDF y comprueba una pagina) y `npm run test:billing:emulator` 23/23. El preview aporta el 401 con la funcion desplegada.
- `billing-api` y `billing-pdf` daban 502 en previews y `netlify dev`: en v2 Netlify usa nft y deja los paquetes npm afuera del bundle, y Lambda desactiva `require()` de ESM; `facturas` es solo ESM. Decision del usuario: cargar `facturas` con `await import()` en `billing-api`, `billing-pdf` y `billing-store`. `tests/functions-v2.test.mjs` empaqueta las entradas como Netlify (paquetes externos) y las carga con `--no-experimental-require-module`: fallo con `facturas` antes del cambio y pasa despues. `tests/firebase-fixture.mjs` reemplaza `import(` para que los mocks sigan aplicando.
- Revision estructural: el adaptador es la unica pieza nueva; no duplica logica y deja intactos `verifyAuth(event)`, `reply()` y los handlers de `lib/`.

## Pendientes

- En previews y `netlify dev` tambien se publican `_auth`, `_platform-admin`, `_sentry`, `_usage` y `_v2` como functions Lambda sin handler (ya pasaba con `_auth` y los demas antes de este cambio). Produccion no los incluye. Si Netlify rechaza esos deploys despues de julio 2027, mover los helpers a `lib/`.
- `billing-pdf` en produccion: como Netlify lo reempaqueta, los source maps subidos a Sentry no coinciden linea a linea con el codigo que corre.
- Los 5 archivos con logica propia siguen con forma Lambda adentro del adaptador. Netlify no exige reescribirlos a `Request` nativo.
