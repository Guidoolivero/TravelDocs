# GROK.md

This file provides guidance to Grok when working with code in this repository. Misma guía que `CLAUDE.md`.


## Qué es este proyecto

DocTravel (marca actual: **TradingDocs**) es un sistema web multi-tenant para que agencias de viajes argentinas gestionen los documentos de sus pasajeros (DNI, pasaportes ARG/extranjeros, visas) y generen los strings SSR/FOID que se cargan en los GDS (Amadeus, Sabre, Galileo). Incluye lectura de documentos por IA (Gemini) y análisis de requisitos de vuelo por país.

El repo vive en `DocTravel/` (raíz git). La carpeta padre `TradingDocs/` solo contiene este proyecto más el brief original (`DocTravel_Brief_Desarrollador.md`).

## Stack

- **Frontend:** HTML + CSS + JavaScript vanilla (ES modules, sin framework). Los módulos de Firebase se cargan vía CDN ESM desde `https://www.gstatic.com/firebasejs/10.12.0/`.
- **Backend:** Firebase Auth + Firestore, con hosting y serverless functions en **Netlify**.
- **IA:** Google Gemini vía SDK oficial `@google/genai`, llamado siempre desde Netlify Functions (la API key nunca vive en el browser).
- **Node 20** (definido en `netlify.toml`). Funciones en CommonJS (`.cjs`), empaquetadas con esbuild.

## Comandos habituales

```bash
npm test                      # tests de lógica de alertas (node --test, sin emulator)
npm run test:alerts           # ídem
npm run test:rules:emulator   # valida aislamiento multi-tenant de firestore.rules contra el emulador
npm run migrate:seed          # crea agencia 'trading-travel' + equipo (scripts/seed-trading-travel.mjs)
npm run pilot:create -- <email>            # crea agencia 'agencia-piloto' + usuario owner
npm run pilot:seed-passengers              # 5 pasajeros dummy x 2 agencias
npm run auth:set-claims      # sincroniza custom claims del JWT desde users/{uid}
npm run migrate:data          # migración a multi-tenant (ver scripts/migrate-to-multi-tenant.mjs)
npm run import:legacy         # import desde la versión HTML legacy (ver docs/IMPORT-LEGACY.md)
```

Tests individuales: `node --test js/alerts.test.mjs` (corre un solo archivo). Los scripts de seed/migración requieren credenciales de service account: `GOOGLE_APPLICATION_CREDENTIALS=./keys/<proyecto>.json npm run ...` (la carpeta `keys/` está gitignorada).

**Test end-to-end de Netlify Functions protegidas:** usuario de test en `.env` (gitignored) — `OCR_TEST_EMAIL` / `OCR_TEST_PASSWORD`. Cargar con `node --env-file=.env`. Patrón (ya implementado en `scripts/ocr-regression.mjs`): login REST contra `identitytoolkit.googleapis.com` con la apiKey pública de `js/config.js` → `idToken` → `fetch` a la función con header `Authorization: Bearer <idToken>`. Sirve para probar funciones ya deployadas (preview o prod) sin abrir la app.

No hay build step de frontend: los archivos se sirven estáticos. Para desarrollo local de las Netlify Functions usá `netlify dev`.

## Arquitectura

### Frontend (carpeta `js/`, módulos ESM cargados por `index.html` / `login.html`)

- `config.js` — `FIREBASE_CONFIG` (proyecto `tradingdocs-mt`). La API key de Firebase acá es pública por diseño; **las claves sensibles van como env vars de Netlify**.
- `tenant.js` — contexto de agencia y branding multi-tenant. `agencyId` se guarda en `sessionStorage`; `applyBranding()` aplica nombre/logo/color por agencia.
- `db.js` — CRUD de Firestore con tenant. **Todo dato de pasajero vive bajo `/agencies/{agencyId}/passengers|notifications`**. El tenant se setea con `setTenantContext(id)` antes de operar. `listenPassengers()` usa `onSnapshot` (tiempo real). `getUserAgency(uid)` resuelve usuario → agencia leyendo `users/{uid}`.
- `login.js` — flujo de login (email/password). Tras autenticar resuelve la agencia, valida que esté activa y aplica branding.
- `app.mjs` — **núcleo de la SPA** (~2300 líneas, una sola sección por feature marcada con `// ==== SECCIÓN ====`). Vistas: dashboard, pasajeros, documentos, alertas, import masivo, requisitos de vuelo. Maneja formularios, scanner IA, modal, toasts, confirmaciones.
- `utils.js` — helpers compartidos (formato de fechas, semáforo de vencimientos, `daysUntil`, `docStatus`). **Exporta las funciones que testea `alerts.test.mjs`** — si cambiás firmas acá, rompés los tests.
- `ssr.js` — generador de strings SSR/FOID (SRDOCS, SRFOID, SRDOCO, NM infante). Los formatos son **estándares IATA: no se modifican**. Contexto GDS/pasajero/segmento configurable.
- `conocidos.mjs` — **GENERADO** por `node scripts/gen-conocidos.mjs` desde `docs/conocidos.json`: fuente única de PAISES_CONOCIDOS + ALERTAS_CONOCIDAS (los requisitos inyectados deterministicamente). Lo consumen `travel-reqs.mjs` (frontend, tests) y `gemini-travel.cjs` (backend, vía require que esbuild bundlea). No editar a mano: editar el JSON y regenerar. `docs/travel-db.json` es la base consolidada de los Excel (generada por `scripts/excel-to-travel-db.py` + `scripts/normalize-travel-db.py`, testeada por `js/travel-db.test.mjs`). `js/matriz.mjs` (generado por `scripts/gen-matriz.mjs`, misma fuente) + `js/travel-matriz.mjs` implementan la inyección de visas y sanidad por nacionalidad y el fallback de URLs — solo backend.
- `scanner.js` — orquesta la subida y preprocesamiento de imágenes para el escaneo con IA.
- `main.js` — versión anterior/legacy (login simple pre-multi-tenant). Conservada como referencia.

### Multi-tenant (lo central para no romper aislamiento)

- Colecciones raíz: `users/{uid}`, `agencies/{agencyId}` con subcolecciones `passengers`, `notifications`, `members`, `invites`, `settings`.
- El `agencyId` y `role` viajan como **custom claims en el JWT** de Firebase Auth (`{ agencyId, role }`). Roles: `owner`, `admin`, `agent`. Esto es necesario porque `get()` sobre `users/{uid}` falla dentro de `onSnapshot` — los claims permiten validar queries solo con el token.
- `firestore.rules` fuerza el aislamiento: `isMemberOf(agencyId)` chequea claims + rol. Las colecciones raíz legacy (`/passengers`, `/notifications`, `/config`) se eliminaron — el default es deny. La subcolección `agencies/{agencyId}/usage/{dayId}` (medición de uso) y la colección raíz `travelCache` (cache de resultados de gemini-travel) son `allow read, write: if false`: las escriben/leen las Functions vía Admin SDK (service account, saltea rules); el cliente no accede. Cualquier cambio a las rules **debe** validarse con `npm run test:rules:emulator`.
- Onboarding de una agencia nueva: procedimiento manual en `docs/ONBOARDING-AGENCIA.md` (hasta que exista panel super-admin). Requiere service account key.

### Netlify Functions (carpeta `netlify/functions/`, CommonJS)

- `_auth.cjs` — helper compartido. Verifica el ID token de Firebase con Admin SDK, lee `users/{uid}`, valida `agencyId`/`role` y que la agencia esté `active`. Todas las funciones llaman a `verifyAuth(event)` primero. Requiere la env var `FIREBASE_SERVICE_ACCOUNT` (JSON inline).
- `gemini-scan.cjs` — OCR de documentos. Recibe `{ mimeType, data }` (base64) y devuelve `{ text, source }` donde `text` es un JSON string con el schema de `scan-prompt.cjs` (un `{ "documentos": [...] }` con 1 o más docs de la misma persona). **Cadena de fallback:** Gemini primario (2 intentos + backoff) → Gemini secundario (1 intento) → **Claude (Anthropic)** como fallback final si toda la cadena Gemini falla. Primario y secundario configurables por env vars `GEMINI_MODEL` (default `gemini-3.1-flash-lite`) y `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash`, el de mayor calidad pero con 503 por alta demanda). El secundario se omite si coincide con el primario. Claude usa el mismo prompt + schema → cero mapeo, contrato `{ text }` sin cambios para el frontend. Reintentos propios sobre 529/429/500 de Anthropic. `source` vale `gemini` o `claude` (para monitoreo).
- `gemini-travel.cjs` — dos modos: vuelo individual (Gemini + Google Search para ruta con paradas técnicas) e itinerario GDS (segmentos parseados del PNR de Amadeus). Analiza requisitos por país. Modelo propio `GEMINI_TRAVEL_MODEL` (default `gemini-3.5-flash-lite` con thinking High en el análisis JSON), aislado de `GEMINI_MODEL` (que queda solo para gemini-scan). **Cache de resultados** en la colección raíz `travelCache` (compartido entre agencias, solo Admin SDK): la fase análisis se cachea por vuelo/origen/destino (o segmentos) + nacionalidad y la fase verificación por firma de la ruta (iatas+tipos) + nacionalidad. Solo se cachean rutas verificadas y verificaciones web exitosas. TTL configurable `TRAVEL_CACHE_TTL_DAYS` (default 30). Hit = 0 tokens y no registra uso (costo cero). El contador `hits` de cada doc alimenta la decisión de qué rutas promover a `docs/conocidos.json`.
- `_usage.cjs` — medición de uso por agencia. `recordUsage({agencyId, kind, source})` incrementa (con `FieldValue.increment`, best-effort, 1 write) el contador diario `agencies/{agencyId}/usage/{YYYY-MM-DD}` (`scans`/`travel` + `bySource.{gemini,claude}`). El día se calcula en hora de Argentina (UTC-3) vía `Intl`, independiente del TZ del runtime. **Sin límite por agencia**: la red de seguridad es el tope mensual de la key de Google. Lo llaman `gemini-scan` (kind `scans`, source según proveedor) y `gemini-travel` (kind `travel`, source `gemini`).
- `admin-api.cjs` — endpoint único del panel super-admin. Rutas CRUD de agencias/usuarios + `GET /usage?range=daily|weekly|monthly|historical&month=YYYY-MM` (reporte de uso y gasto para cobro manual; devuelve conteos + gasto estimado en USD por agencia). Todo protegido por `requirePlatformAdmin()`.
- `prompts/scan-prompt.cjs` — system instruction y prompt de extracción del scanner.

Modelo Gemini por env vars `GEMINI_MODEL` (primario, default `gemini-3.1-flash-lite`) y `GEMINI_FALLBACK_MODEL` (secundario, default `gemini-3.5-flash`); `GEMINI_API_KEY` obligatoria. Fallback Claude por env vars `ANTHROPIC_API_KEY` (obligatoria para que el fallback corra) y `ANTHROPIC_MODEL` (default `claude-sonnet-4-5`). Ambas keys viven solo en Netlify, nunca en código. Deps: `@google/genai` y `@anthropic-ai/sdk` declaradas en el **root** `package.json` (esbuild las resuelve desde `node_modules` del root).

**Medición de uso (gasto estimado para cobro manual):** env vars `COST_PER_SCAN_GEMINI`, `COST_PER_SCAN_CLAUDE` y `COST_PER_TRAVEL` (USD por unidad = precio de venta a la agencia, no costo). Las alimenta la ruta `GET /usage` de `admin-api.cjs` para la columna "Gasto est." del panel super-admin. Defaults chicos de placeholder; setear los reales en Netlify.

**Headers de seguridad:** `_headers` (raíz) define HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy y CSP. El CSP arranca en modo `Content-Security-Policy-Report-Only` — revisar la consola del browser en un deploy de preview y luego renombrarlo a `Content-Security-Policy` para enforced. Cubre Firebase (`gstatic.com`), EmailJS/Tesseract (`cdn.jsdelivr.net`, `unpkg.com`) y Google Fonts.

### Semáforo de vencimientos (regla de negocio compartida frontend/tests)

Definido en `utils.js` y testeado en `alerts.test.mjs`: 🔴 Vencido (días < 0), 🔴 Crítico (0–30), 🟡 Por vencer (31–90), 🟢 Vigente (> 90). Alertas por email vía EmailJS (configurado por agencia en `agencies/{id}.alerts`).

## Convenciones de código

- **Comentarios y UI en español** (audiencia: agencias argentianas). Código simple, pensado para presentaciones.
- Estilo definido en `docs/CLAUDE.md` y, para Grok, en `docs/GROK.md` (perfil de coding): solución más simple que funcione, sin abstracciones prematuras, sin type annotations en código que no se esté tocando. **ASCII plano: sin em dashes, sin comillas tipográficas, sin Unicode decorativo** — el output debe ser copy-paste safe.
- Leé el archivo antes de modificarlo. No edites a ciegas.
- **Exploración de código:** usar primero las herramientas MCP (codebase-memory: `search_graph`, `trace_path`, `get_code_snippet`, `query_graph`, `search_code`). Si el repo no está indexado, correr `index_repository` antes. Grep/Glob/Read para texto, configs y no-código.
- **Plugins obligatorios** (los de `~/.claude/CLAUDE.md`; también en `~/.grok/rules/plugins-obligatorios.md`). Leer el SKILL.md y seguirlo, sin esperar a que los pidan.
  - **TDD** (`tdd` de mattpocock): todo cambio de lógica arranca con un test que falle. Correrlo, verlo fallar, después el código mínimo. Un bug: primero el test que lo reproduce. No aplica a HTML, estilos ni configs.
  - **Ponytail:** antes de escribir código, la escalera (¿hace falta? ¿ya existe? ¿stdlib? ¿feature nativa?). Al terminar un cambio no trivial, ponytail-review del diff antes de entregar.
  - **Humanizer:** toda prosa que va a ver otra persona (docs, manuales, propuestas, emails, copy) se revisa antes de entregar. No aplica a código, commits ni comentarios.
- **Al cerrar un cambio de código:** correr `npm test` y reindexar el grafo con `index_repository` en el mismo turno. No esperar a que lo pidan. Si se tocaron `firestore.rules`, también `npm run test:rules:emulator`.
- **Después de cada cambio, además de reindexar:** commit y `git push` a `origin main` (repo privado `Guidoolivero/TravelDocs`). Solo `main`: nunca `git push --all` ni subir `historial-viejo` o `feat/*`, que tienen en su historial PDFs con datos de pasajeros. Antes del commit, mirar `git status` para confirmar que no entre nada con datos personales.
- Los strings SSR/FOID y los formatos de fecha GDS no se tocan salvo bug confirmado.

## Documentación relevante (en `docs/`)

- `SETUP.md` — configuración Firebase + Gemini + deploy Netlify desde cero.
- `ONBOARDING-AGENCIA.md` — alta manual de una agencia multi-tenant.
- `PLAN-ESCALABILIDAD-MULTI-AGENCIA.md` — roadmap de fases del multi-tenant.
- `QA-MULTI-TENANT.md` — checklist de validación de aislamiento.
- `IMPORT-LEGACY.md` — migración desde la versión HTML+localStorage original.
- `MIGRATION_TO_GOOGLE_GENAI_SDK.md` — migración del fetch directo al SDK `@google/genai`.
- `GUIA-WORKSPACES-PARALELOS.md` — flujo de trabajo con workspaces paralelos.
