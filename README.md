# TravelDocs

Sistema web multi-tenant para agencias de viajes argentinas. Gestiona documentos
de pasajeros (DNI, pasaportes ARG/extranjeros, visas), genera strings SSR/FOID
para GDS (Amadeus, Sabre, Galileo), lee documentos con IA y analiza requisitos
de viaje por ruta y nacionalidad.

Marca en produccion: **TravelDocs** (`traveldocs.com.ar`).
Repo privado: `Guidoolivero/TravelDocs`. Raiz git: este directorio (`DocTravel/`).

## Que resuelve

| Area | Comportamiento |
| --- | --- |
| Pasajeros | Alta, edicion, busqueda, deduplicacion, documentos adjuntos |
| Documentos / OCR | Subida de imagen → Netlify Function → Gemini (fallback Claude) → JSON tipado |
| SSR / FOID | Generacion de `SRDOCS`, `SRFOID`, `SRDOCO`, NM infante. Formatos IATA: no se inventan |
| Reservas / PNR | Parseo de itinerarios, check-in, pasajeros pendientes, itinerario PDF |
| Requisitos | Analisis por vuelo o PNR: visas, sanidad, fiebre amarilla / transitos, cabotaje |
| Alertas | Semaforo de vencimientos + cron diario de envios (EmailJS por agencia) |
| Facturacion | Emision / PDF / perfil fiscal por agencia (panel + Functions) |
| Admin | Panel super-admin de agencias, usuarios y uso (gasto estimado) |

Aislamiento multi-tenant: todo dato de pasajero vive bajo
`/agencies/{agencyId}/passengers|notifications|...`. El JWT lleva custom claims
`{ agencyId, role }` (`owner` | `admin` | `agent`). `firebase/firestore.rules`
niega por defecto y valida membresia + MFA TOTP.

## Stack

- **Frontend:** HTML/CSS/JS vanilla (ES modules). Sin framework. Firebase Auth +
  Firestore via CDN ESM (`firebasejs/10.12.0`).
- **Hosting / API:** Netlify (static + Functions CommonJS empaquetadas con esbuild).
- **IA:** `@google/genai` en Functions. Fallback OCR: Anthropic. Keys solo en env
  vars de Netlify, nunca en el browser.
- **Runtime CI/local:** Node 22 (workflow). `netlify.toml` fija `NODE_VERSION=22`.
- **Observabilidad:** Sentry en Functions (bundle de produccion con source maps).

No hay SPA framework ni build de React para la app. El unico uso de React es el
renderer PDF de facturacion (`@react-pdf/renderer`) en el backend.

## Arquitectura

```text
Browser (public/)          Netlify Functions              Firebase
─────────────────          ─────────────────              ────────
login / index HTML         *.cjs (entrada HTTP)           Auth + custom claims
public/js/<modulo>/        lib/<modulo>/ (impl)           Firestore multi-tenant
app.mjs (coordinador)      _auth / _usage / _sentry       travelCache (Admin SDK)
db.js (tenant + snaps)     gemini-scan / gemini-travel    usage diario por agencia
```

### Frontend (`public/js/`)

Organizado por funcionalidad. `app.mjs` inicia sesion, navegacion y listeners una
sola vez. El estado compartido (pasajeros, reservas, sesion) vive en
`compartido/estado.mjs`. Cada pantalla expone `init...()` y se monta desde el
coordinador.

| Carpeta | Rol |
| --- | --- |
| `pasajeros/` | Lista, formulario, busqueda, duplicados, pendientes |
| `documentos/` | Scanner UI, SSR/FOID |
| `reservas/` | Check-ins, PNR, itinerario PDF |
| `requisitos/` | Consulta de requisitos, conocidos, segmentos GDS |
| `alertas/` | Modelo y envio fallback cliente |
| `facturacion/` | Pantalla y formularios de facturacion |
| `administracion/` | Panel de agencias / usuarios |
| `importacion/`, `ciudades/`, `dashboard/` | Import CSV/Excel, catalogo GDS, home |
| `compartido/` | Firebase, UI, utils, PDF viewer, seguridad |

`public/js/config.js` tiene la config publica de Firebase. Las claves sensibles
(Gemini, Anthropic, service account, costos) van en Netlify.

### Backend (`netlify/functions/`)

Las entradas de la raiz (`gemini-scan.cjs`, `admin-api.cjs`, etc.) conservan el
nombre publico de la URL y delegan en `netlify/functions/lib/<modulo>/`. Asi no
se rompen rutas, el cron de `send-alerts` ni el discovery de
`scripts/bundle-functions.mjs`.

Logica sanitaria reutilizable (fuera de `public/`):

- `lib/requisitos/fiebre-transito.mjs`
- `lib/requisitos/travel-matriz.mjs`
- `lib/requisitos/requisitos-checkin.mjs`
- `lib/requisitos/matriz.mjs` (generado)

### Que se publica

Netlify construye desde `public/` hacia `.netlify/site` (`npm run build:frontend`).
En produccion el workflow tambien corre `scripts/bundle-functions.mjs` y publica
Functions desde `netlify/functions-dist/`.

**No** se publican: `docs/`, `tests/`, `scripts/`, `lib/`, specs, ni datos de
pasajeros. El default de seguridad del repo es: si no esta en `public/`, no va
al site.

### Semaforo de vencimientos

Definido en utils del frontend y cubierto por tests:

| Estado | Dias hasta vencimiento |
| --- | --- |
| Vencido | `< 0` |
| Critico | `0–30` |
| Por vencer | `31–90` |
| Vigente | `> 90` |

### OCR (cadena)

1. Gemini primario (reintentos + backoff)
2. Gemini secundario (si difiere del primario)
3. Claude / Anthropic como fallback final

Contrato estable al frontend: `{ text, source }` donde `text` es JSON con el
schema de `scan-prompt`.

### Requisitos de viaje

Dos modos en `gemini-travel`: vuelo puntual (con busqueda) e itinerario GDS.
Hay cache en coleccion raiz `travelCache` (solo Admin SDK, TTL configurable).
Rutas frecuentes se pueden promover a `docs/conocidos.json` y regenerar
`public/js/requisitos/conocidos.mjs`.

## Estructura del repo (raiz de GitHub)

```text
public/                 # Unico codigo servido al browser
netlify/                # Functions + lib por modulo
firebase/               # firestore.rules + indexes
lib/                    # Logica backend compartida (no publica)
e2e/                    # Configs del runner e2e
scripts/ tests/ docs/ specs/
.agents/                # Guia PROJECT.md, skills, locks, mcp
.github/                # CI + deploy
```

En la raiz quedan solo archivos que las herramientas exigen ahi:

| Archivo | Por que no se mueve |
| --- | --- |
| `package.json` / `package-lock.json` | npm |
| `netlify.toml` | Netlify |
| `firebase.json` | Firebase CLI (apunta a `firebase/`) |
| `README.md` / `.gitignore` | GitHub / git |
| `AGENTS.md` `CLAUDE.md` `GROK.md` | Stubs de descubrimiento de agentes |
| `.mcp.json` | Symlink a `.agents/mcp.json` |

Detalle de agentes: `.agents/README.md`. Skills canonicos en `.agents/skills/`;
los clientes solo tienen symlinks.

## Comandos

```bash
npm ci
npm test                      # unitarios listados en package.json
npm run test:rules:emulator   # aislamiento Firestore
npm run test:billing:emulator
npm run build:frontend        # copia versionada a .netlify/site
netlify dev                   # Functions + front local
netlify deploy --prod         # solo a proposito; CI ya lo hace en main
```

Seeds / claims / migraciones requieren service account
(`GOOGLE_APPLICATION_CREDENTIALS=./keys/...`, carpeta `keys/` ignorada).

Test de Functions ya deployadas: login REST con usuario de `.env`
(`OCR_TEST_EMAIL` / `OCR_TEST_PASSWORD`) → `Authorization: Bearer <idToken>`.
Patron en `scripts/ocr-regression.mjs`.

## Deploy

1. Push a `main`
2. `.github/workflows/tests.yml` corre unitarios, reglas, smokes UI
3. Si pasan, `netlify deploy --prod` publica `traveldocs.com.ar`

Un push a `main` sale en vivo para las agencias. Para probar sin tocar
produccion: `netlify deploy` (draft) o un alias
(`https://<alias>--tradingdocs-staging.netlify.app`).

## Convenciones

- UI y comentarios en español.
- Solucion minima; sin abstracciones prematuras.
- Cambios de logica: TDD (`node --test`).
- Specs en `specs/` para cambios no triviales (`docs/DESARROLLO-IA.md`).
- No modificar strings SSR/FOID salvo bug confirmado.
- No commitear PII (pasaportes, PDFs, fixtures OCR reales).

## Docs utiles

| Archivo | Contenido |
| --- | --- |
| `docs/MODULOS.md` | Mapa actual frontend/backend por feature |
| `docs/PLAN-MODULARIZACION.md` | Plan e inventario del refactor |
| `docs/SETUP.md` | Firebase + Gemini + Netlify desde cero |
| `docs/ONBOARDING-AGENCIA.md` | Alta manual de una agencia |
| `docs/DESARROLLO-IA.md` | SDD + revision estructural compartida |
| `AGENTS.md` | Guia operativa completa para agentes |
