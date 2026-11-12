# Guia operativa del proyecto (TravelDocs / DocTravel)

Fuente unica para Codex, Claude, Grok y Cursor. Las entradas de raiz
(`AGENTS.md`, `CLAUDE.md`, `GROK.md`) solo apuntan aca.

## SDD y revision estructural (obligatorio)

Antes de implementar cambios, leer `docs/DESARROLLO-IA.md`. Aplicar SDD con criterios de aceptacion verificables y mantener la spec junto al cambio. En cambios no triviales, realizar la revision estructural de untangle-codebase dentro del alcance pedido. La guia compartida define el flujo, la plantilla y los limites del refactor completo; conserva TDD, Ponytail, Humanizer y Hallmark.

## Qué es este proyecto

DocTravel (marca actual: **TravelDocs**) es un sistema web multi-tenant para que agencias de viajes argentinas gestionen los documentos de sus pasajeros (DNI, pasaportes ARG/extranjeros, visas) y generen los strings SSR/FOID que se cargan en los GDS (Amadeus, Sabre, Galileo). Incluye lectura de documentos por IA (Gemini) y análisis de requisitos de vuelo por país.

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
npm run test:rules:emulator   # valida aislamiento multi-tenant de firebase/firestore.rules contra el emulador
npm run migrate:seed          # crea agencia 'trading-travel' + equipo (scripts/seed-trading-travel.mjs)
npm run pilot:create -- <email>            # crea agencia 'agencia-piloto' + usuario owner
npm run pilot:seed-passengers              # 5 pasajeros dummy x 2 agencias
npm run auth:set-claims      # sincroniza custom claims del JWT desde users/{uid}
npm run migrate:data          # migración a multi-tenant (ver scripts/migrate-to-multi-tenant.mjs)
npm run import:legacy         # import desde la versión HTML legacy (ver docs/IMPORT-LEGACY.md)
```

Tests individuales: `node --test tests/alerts.test.mjs` (corre un solo archivo). Los scripts de seed/migración requieren credenciales de service account: `GOOGLE_APPLICATION_CREDENTIALS=./keys/<proyecto>.json npm run ...` (la carpeta `keys/` está gitignorada).

**Test end-to-end de Netlify Functions protegidas:** usuario de test en `.env` (gitignored) — `OCR_TEST_EMAIL` / `OCR_TEST_PASSWORD`. Cargar con `node --env-file=.env`. Patrón (ya implementado en `scripts/ocr-regression.mjs`): login REST contra `identitytoolkit.googleapis.com` con la apiKey pública de `public/js/config.js` → `idToken` → `fetch` a la función con header `Authorization: Bearer <idToken>`. Sirve para probar funciones ya deployadas (preview o prod) sin abrir la app.

No hay build step de frontend: los archivos se sirven estáticos. Para desarrollo local de las Netlify Functions usá `netlify dev`.

**Qué se publica:** Netlify sirve SOLO `public/` (`publish = "public"` en `netlify.toml`): HTML, `css/`, `js/` (solo browser), `assets/`, `_headers`, `_redirects`, `robots.txt`, `sitemap.xml`. Todo lo demás (`docs/`, `tests/`, `scripts/`, `lib/`) NO se publica: ahí hay datos personales. Nunca agregar a `public/` tests, módulos solo-backend ni documentos. Los tests unitarios viven en `tests/`.

## Arquitectura

### Frontend (carpeta `public/js/`, módulos ESM cargados por `public/index.html` / `public/login.html`)

- `config.js` — `FIREBASE_CONFIG` (proyecto `tradingdocs-mt`). La API key de Firebase acá es pública por diseño; **las claves sensibles van como env vars de Netlify**.
- `tenant.js` — contexto de agencia y branding multi-tenant. `agencyId` se guarda en `sessionStorage`; `applyBranding()` aplica nombre/logo/color por agencia.
- `db.js` — CRUD de Firestore con tenant. **Todo dato de pasajero vive bajo `/agencies/{agencyId}/passengers|notifications`**. El tenant se setea con `setTenantContext(id)` antes de operar. `listenPassengers()` usa `onSnapshot` (tiempo real). `getUserAgency(uid)` resuelve usuario → agencia leyendo `users/{uid}`.
- `login.js` — flujo de login (email/password). Tras autenticar resuelve la agencia, valida que esté activa y aplica branding.
- `app.mjs` - arranque, sesion, snapshots y navegacion. Las pantallas viven en carpetas por funcionalidad (`facturacion/`, `pasajeros/`, `reservas/`, etc.). Antes de cambiar una funcionalidad, consultar `docs/MODULOS.md` para ubicar su frontend, backend y pruebas. `compartido/estado.mjs` conserva la unica instancia del estado de sesion; cada pantalla se inicializa una sola vez.
- `compartido/utils.js` — helpers compartidos (formato de fechas, semáforo de vencimientos, `daysUntil`, `docStatus`). **Exporta las funciones que testea `alerts.test.mjs`** — si cambiás firmas acá, rompés los tests.
- `documentos/ssr.js` — generador de strings SSR/FOID (SRDOCS, SRFOID, SRDOCO, NM infante). Los formatos son **estándares IATA: no se modifican**. Contexto GDS/pasajero/segmento configurable.
- `requisitos/conocidos.mjs` — **GENERADO** por `node scripts/gen-conocidos.mjs` desde `docs/conocidos.json`: fuente única de PAISES_CONOCIDOS + ALERTAS_CONOCIDAS (los requisitos inyectados deterministicamente). Lo consumen `requisitos/travel-reqs.mjs` (frontend, tests) y `gemini-travel.cjs` (backend, vía require que esbuild bundlea). No editar a mano: editar el JSON y regenerar. `docs/travel-db.json` es la base consolidada de los Excel (generada por `scripts/excel-to-travel-db.py` + `scripts/normalize-travel-db.py`, testeada por `tests/travel-db.test.mjs`). `lib/requisitos/matriz.mjs` (generado por `scripts/gen-matriz.mjs`, misma fuente) + `lib/requisitos/travel-matriz.mjs` implementan la inyección de visas y sanidad por nacionalidad y el fallback de URLs — solo backend (fuera de `public/`, junto con `lib/requisitos/requisitos-checkin.mjs` y `lib/requisitos/iata-iso2.mjs`).
- `documentos/scanner.js` — orquesta la subida y preprocesamiento de imágenes para el escaneo con IA.
- `main.js` — versión anterior/legacy (login simple pre-multi-tenant). Conservada como referencia.

### Multi-tenant (lo central para no romper aislamiento)

- Colecciones raíz: `users/{uid}`, `agencies/{agencyId}` con subcolecciones `passengers`, `notifications`, `members`, `invites`, `settings`.
- El `agencyId` y `role` viajan como **custom claims en el JWT** de Firebase Auth (`{ agencyId, role }`). Roles: `owner`, `admin`, `agent`. Esto es necesario porque `get()` sobre `users/{uid}` falla dentro de `onSnapshot` — los claims permiten validar queries solo con el token.
- `firebase/firestore.rules` fuerza el aislamiento: `isMemberOf(agencyId)` chequea claims + rol. Las colecciones raíz legacy (`/passengers`, `/notifications`, `/config`) se eliminaron — el default es deny. La subcolección `agencies/{agencyId}/usage/{dayId}` (medición de uso) y la colección raíz `travelCache` (cache de resultados de gemini-travel) son `allow read, write: if false`: las escriben/leen las Functions vía Admin SDK (service account, saltea rules); el cliente no accede. Cualquier cambio a las rules **debe** validarse con `npm run test:rules:emulator`.
- Onboarding de una agencia nueva: procedimiento manual en `docs/ONBOARDING-AGENCIA.md` (hasta que exista panel super-admin). Requiere service account key.

### Netlify Functions (carpeta `netlify/functions/`, CommonJS)

Las entradas HTTP conservan sus nombres y delegan en `lib/<funcionalidad>/`. La implementacion de facturacion esta en `lib/facturacion/`, con tests en `tests/facturacion/` y scripts en `scripts/facturacion/`.

- `_auth.cjs` — helper compartido. Verifica el ID token de Firebase con Admin SDK, lee `users/{uid}`, valida `agencyId`/`role` y que la agencia esté `active`. Las funciones de la app llaman a `verifyAuth(event)` primero. `route-agent.cjs` no lo usa: Slack y MCP lo llaman sin token de TravelDocs. Requiere la env var `FIREBASE_SERVICE_ACCOUNT` (JSON inline).
- `gemini-scan.cjs` — OCR de documentos. Recibe `{ mimeType, data }` (base64) y devuelve `{ text, source }` donde `text` es un JSON string con el schema de `scan-prompt.cjs` (un `{ "documentos": [...] }` con 1 o más docs de la misma persona). **Cadena de fallback:** Gemini primario (2 intentos + backoff) → Gemini secundario (1 intento) → **Codex (Anthropic)** como fallback final si toda la cadena Gemini falla. Primario y secundario configurables por env vars `GEMINI_MODEL` (default `gemini-3.1-flash-lite`) y `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash`, el de mayor calidad pero con 503 por alta demanda). El secundario se omite si coincide con el primario. Codex usa el mismo prompt + schema → cero mapeo, contrato `{ text }` sin cambios para el frontend. Reintentos propios sobre 529/429/500 de Anthropic. `source` vale `gemini` o `Codex` (para monitoreo).
- `gemini-travel.cjs` — dos modos: vuelo individual (Gemini + Google Search para ruta con paradas técnicas) e itinerario GDS (segmentos parseados del PNR de Amadeus). Analiza requisitos por país. Modelo propio `GEMINI_TRAVEL_MODEL` (default `gemini-3.5-flash-lite` con thinking High en el análisis JSON), aislado de `GEMINI_MODEL` (que queda solo para gemini-scan). **Cache de resultados** en la colección raíz `travelCache` (compartido entre agencias, solo Admin SDK): la fase análisis se cachea por vuelo/origen/destino (o segmentos) + nacionalidad y la fase verificación por firma de la ruta (iatas+tipos) + nacionalidad. Solo se cachean rutas verificadas y verificaciones web exitosas. TTL configurable `TRAVEL_CACHE_TTL_DAYS` (default 30). Hit = 0 tokens y no registra uso (costo cero). El contador `hits` de cada doc alimenta la decisión de qué rutas promover a `docs/conocidos.json`.
- `_usage.cjs` — medición de uso por agencia. `recordUsage({agencyId, kind, source})` incrementa (con `FieldValue.increment`, best-effort, 1 write) el contador diario `agencies/{agencyId}/usage/{YYYY-MM-DD}` (`scans`/`travel` + `bySource.{gemini,Codex}`). El día se calcula en hora de Argentina (UTC-3) vía `Intl`, independiente del TZ del runtime. **Sin límite por agencia**: la red de seguridad es el tope mensual de la key de Google. Lo llaman `gemini-scan` (kind `scans`, source según proveedor) y `gemini-travel` (kind `travel`, source `gemini`).
- `admin-api.cjs` — endpoint único del panel super-admin. Rutas CRUD de agencias/usuarios + `GET /usage?range=daily|weekly|monthly|historical&month=YYYY-MM` (reporte de uso y gasto para cobro manual; devuelve conteos + gasto estimado en USD por agencia). Todo protegido por `requirePlatformAdmin()`.
- `lib/documentos/scan-prompt.cjs` — system instruction y prompt de extracción del scanner.

Modelo Gemini por env vars `GEMINI_MODEL` (primario, default `gemini-3.1-flash-lite`) y `GEMINI_FALLBACK_MODEL` (secundario, default `gemini-3.5-flash`); `GEMINI_API_KEY` obligatoria. Fallback Codex por env vars `ANTHROPIC_API_KEY` (obligatoria para que el fallback corra) y `ANTHROPIC_MODEL` (default `Codex-sonnet-4-5`). Ambas keys viven solo en Netlify, nunca en código. Deps: `@google/genai` y `@anthropic-ai/sdk` declaradas en el **root** `package.json` (esbuild las resuelve desde `node_modules` del root).

**Medición de uso (gasto estimado para cobro manual):** env vars `COST_PER_SCAN_GEMINI`, `COST_PER_SCAN_CLAUDE` y `COST_PER_TRAVEL` (USD por unidad = precio de venta a la agencia, no costo). Las alimenta la ruta `GET /usage` de `admin-api.cjs` para la columna "Gasto est." del panel super-admin. Defaults chicos de placeholder; setear los reales en Netlify.

**Headers de seguridad:** `_headers` (raíz) define HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy y CSP. El CSP arranca en modo `Content-Security-Policy-Report-Only` — revisar la consola del browser en un deploy de preview y luego renombrarlo a `Content-Security-Policy` para enforced. Cubre Firebase (`gstatic.com`), EmailJS/Tesseract (`cdn.jsdelivr.net`, `unpkg.com`) y Google Fonts.

### Semáforo de vencimientos (regla de negocio compartida frontend/tests)

Definido en `compartido/utils.js` y testeado en `alerts.test.mjs`: 🔴 Vencido (días < 0), 🔴 Crítico (0–30), 🟡 Por vencer (31–90), 🟢 Vigente (> 90). Alertas por email vía EmailJS (configurado por agencia en `agencies/{id}.alerts`).

## Convenciones de código

- **Comentarios y UI en español** (audiencia: agencias argentianas). Código simple, pensado para presentaciones.
- Estilo definido en `docs/CLAUDE.md` / `docs/GROK.md` (perfil de coding): solución más simple que funcione, sin abstracciones prematuras, sin type annotations en código que no se esté tocando. **ASCII plano: sin em dashes, sin comillas tipográficas, sin Unicode decorativo** — el output debe ser copy-paste safe.
- Leé el archivo antes de modificarlo. No edites a ciegas.
- **Exploración de código:** usar primero las herramientas MCP (codebase-memory: `search_graph`, `trace_path`, `get_code_snippet`, `query_graph`, `search_code`). Si el repo no está indexado, correr `index_repository` antes. Grep/Glob/Read para texto, configs y no-código.
- **Plugins obligatorios** (los de `~/.Codex/AGENTS.md`; también en `~/.grok/rules/plugins-obligatorios.md`). Leer el SKILL.md y seguirlo, sin esperar a que los pidan.
  - **TDD** (`tdd` de mattpocock): todo cambio de lógica arranca con un test que falle. Correrlo, verlo fallar, después el código mínimo. Un bug: primero el test que lo reproduce. No aplica a HTML, estilos ni configs.
  - **Ponytail:** antes de escribir código, la escalera (¿hace falta? ¿ya existe? ¿stdlib? ¿feature nativa?). Al terminar un cambio no trivial, ponytail-review del diff antes de entregar.
  - **Humanizer:** toda prosa que va a ver otra persona (docs, manuales, propuestas, emails, copy) se revisa antes de entregar. No aplica a código, commits ni comentarios.
  - **Hallmark** (`.agents/skills/hallmark/SKILL.md`): UI visible. Leer el skill antes de tocar HTML/CSS. Landing y paginas nuevas: flujo completo + `node .agents/skills/hallmark/scripts/sloplint.mjs --render`. App existente: Floor/Reflex en lo que se toca; no restylear toda la SPA salvo redesign pedido.
- **Al cerrar un cambio de código:** correr `npm test` y reindexar el grafo con `index_repository` en el mismo turno. No esperar a que lo pidan. Si se tocaron `firebase/firestore.rules`, también `npm run test:rules:emulator`.
- **Después de cada cambio, además de reindexar:** commit y `git push` a `origin main` (repo privado `Guidoolivero/TravelDocs`). Solo `main`: nunca `git push --all` ni subir `historial-viejo` o `feat/*`, que tienen en su historial PDFs con datos de pasajeros. Antes del commit, mirar `git status` para confirmar que no entre nada con datos personales.
- **Deploy automático:** el push a `main` corre `.github/workflows/tests.yml` y, si pasan los tests, publica en producción (`traveldocs.com.ar`) con `netlify deploy --prod`. Todo push a `main` sale en vivo para las agencias; si fallan los tests, no se publica. Deploy manual sigue andando igual (`netlify deploy --prod` desde `DocTravel/`).
- Los strings SSR/FOID y los formatos de fecha GDS no se tocan salvo bug confirmado.

## Documentación relevante (en `docs/`)

- `SETUP.md` — configuración Firebase + Gemini + deploy Netlify desde cero.
- `ONBOARDING-AGENCIA.md` — alta manual de una agencia multi-tenant.
- `PLAN-ESCALABILIDAD-MULTI-AGENCIA.md` — roadmap de fases del multi-tenant.
- `QA-MULTI-TENANT.md` — checklist de validación de aislamiento.
- `IMPORT-LEGACY.md` — migración desde la versión HTML+localStorage original.
- `MIGRATION_TO_GOOGLE_GENAI_SDK.md` — migración del fetch directo al SDK `@google/genai`.
- `GUIA-WORKSPACES-PARALELOS.md` — flujo de trabajo con workspaces paralelos.
