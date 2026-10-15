# Checklist de validación — Staging antes del cutover

**Site:** https://tradingdocs-staging.netlify.app  
**Firebase destino:** `tradingdocs-mt`  
**Firebase origen (producción actual):** `doctravel-agencia` — no tocar hasta el cutover

Marcá cada ítem cuando lo pruebes. Todos los de **Bloque A** deben estar OK antes de reemplazar producción.

---

## Bloque A — Obligatorio (bloquea cutover)

### A1. Datos importados

- [x] En Console → `tradingdocs-mt` → `agencies/trading-travel/passengers` hay **~584** documentos
- [x] En Console → `agencies/trading-travel/notifications` hay **~30** documentos
- [x] En Console → `doctravel-agencia` → `/passengers` sigue con **584** (origen intacto)

### A2. Login y sesión

- [x] Login con `guido@tradingtravel.com.ar` (proyecto **nuevo**) funciona
- [x] No aparece `permission-denied` en consola del navegador
- [x] Dashboard carga sin quedarse en loading infinito
- [x] Logout y re-login funcionan

### A3. Listado de pasajeros

- [x] Se ven **~584** pasajeros en la lista (ordenados, sin lista vacía)
- [x] Reconocés al menos **3 pasajeros** por nombre que existían en producción
- [x] Buscador / filtros responden (si los usan habitualmente)
- [x] Abrir detalle de un pasajero muestra DNI, pasaporte, visas, etc.

### A4. CRUD (crear, editar, borrar)

- [x] **Editar** un pasajero importado → guardar → recargar → cambio persiste
- [x] **Crear** pasajero de prueba `TEST-STAGING-DELETE` → aparece en la lista
- [x] **Borrar** `TEST-STAGING-DELETE` → desaparece de la lista
- [x] Los cambios se ven en Console bajo `agencies/trading-travel/passengers` (no en `/passengers` global)

### A5. Alertas de vencimiento

- [x] Vista de alertas carga sin error
- [x] Badge / contador de alertas coherente con datos importados
- [x] (Opcional) Descartar una alerta de prueba y verificar que no vuelve a aparecer en la misma sesión

### A6. Scanner (Gemini)

- [x] Escanear una imagen JPG/PDF de prueba completa sin error 502
- [x] Los campos del formulario se rellenan con datos razonables
- [x] No aparece `HandlerNotFound` en logs de Netlify Functions

### A7. Producción vieja sin cambios

- [x] El TradingDocs de **producción** (URL/dominio que usa el equipo hoy) sigue operando normal
- [x] Pasajeros en `doctravel-agencia` no disminuyeron ni cambiaron IDs masivamente
- [x] El equipo puede seguir trabajando en prod mientras validás staging

---

## Bloque B — Recomendado (no bloquea, pero conviene)

### B1. Requisitos de vuelo (Gemini travel)

- [ ] Consultar un vuelo de prueba (ej. ruta que usen seguido) devuelve resultado
Jun 17, 03:14:48 PM: cfea5236 ERROR  gemini-travel: analisisJSON: intento 1/1 con gemini-2.5-flash falló (transitorio): This operation was abortedJun 17, 03:14:48 PM: cfea5236 ERROR  gemini-travel: error en llamada JSON final: This operation was abortedJun 17, 03:14:48 PM: cfea5236 Duration: 28258.05 ms	Memory Usage: 121 MB
- [ ] No error 403/502 en `gemini-travel`

### B2. EmailJS / alertas por email (unificado + check-ins configurables)

- [x] Variables EmailJS siguen en código (Fase 2 las externalizará)
- [x] Si probás envío de alerta, el email llega a `contacto@tradingtravel.com.ar` (o el configurado)
- [ ] Email unificado: con vencimiento + check-in + cumpleaños pendientes llega UN solo email con secciones "Vencimientos | Check Ins | Cumpleaños" (asunto dinámico: solo las secciones con contenido) y columnas alineadas
- [ ] Check-in con "Email para el aviso" completo: el aviso llega SOLO a ese email y NO aparece en el unificado de la agencia
- [ ] Check-in sin email: aparece en la sección Check Ins del unificado de la agencia
- [ ] Selector de anticipación: reserva con 48hs y vuelo a 30hs NO envía; con 24hs y vuelo mañana (entrando hoy) SÍ envía (días de anticipación, no reloj)
- [ ] `piernas[].notified` queda en `true` en Firestore tras el envío (no reenvía la próxima corrida)
- [ ] El select 24/48/72 y el email persisten al editar el check-in; email inválido bloquea el guardado con toast
- [ ] Scheduled function: `send-alerts` aparece en Functions del site con schedule diario (9:00 AM ART = 12:00 UTC); "Run now" devuelve conteos y envía lo pendiente
- [ ] Si la cuenta EmailJS tiene strict mode: env var `EMAILJS_PRIVATE_KEY` seteada en el site Netlify (la private key NO se guarda en el doc de la agencia: lo lee el browser de los miembros), sino el envío server-side falla con 403
- [ ] Template EmailJS con `{{{message}}}` (TRIPLE llave: las dobles escapan el HTML y el unificado llega crudo) y contenido HTML (`<html><body>{{{message}}}</body></html>`); verificar con `node --env-file=.env scripts/test-email-html.mjs`

### B3. SSR / documentos

- [x] Generar SSR de un pasajero importado funciona
- [x] Vista documentos muestra estados (ok / warning / vencido) coherentes

### B4. Importación masiva

- [ ] Si usan import CSV/Excel, probar con un archivo chico de prueba

### B5. Rendimiento básico

- [x] Dashboard con ~584 pasajeros carga en **< 10 segundos**
- [x] No errores repetidos en consola del navegador

---

## Bloque C — Pre-cutover (día del switch)

Hacer **el día acordado**, en horario de poca actividad (~30 min).

### C1. Antes del switch

- [ ] Avisar al equipo: ventana de mantenimiento corta
- [ ] Backup Firestore de `doctravel-agencia` (por las dudas)
- [ ] Último `npm run import:legacy` si hubo cambios en prod ese día (origen sigue intacto)
- [ ] Checklist Bloque A todo marcado

### C2. Durante el switch

- [ ] Deploy staging → site de **producción** (o cambiar dominio a `tradingdocs-staging`)
- [ ] Confirmar `js/config.js` apunta a `tradingdocs-mt`
- [ ] Confirmar `GEMINI_API_KEY` y `FIREBASE_API_KEY` en Netlify prod
- [ ] Dominio en Firebase Authorized domains (prod + staging)

### C3. Después del switch (15 min)

- [ ] Los 3 usuarios pueden loguear (Guido primero; Guillermo/Mariela cuando se den de alta)
- [ ] Listado ~584 pasajeros visible
- [ ] Crear y editar un pasajero real
- [ ] Scanner en un documento real
- [ ] Sin `permission-denied` en consola

### C4. Rollback (si algo falla)

- [ ] Revertir deploy Netlify al release anterior
- [ ] Equipo vuelve a `doctravel-agencia` automáticamente (config vieja)
- [ ] Datos origen nunca se borraron — sin pérdida de datos

---

## Bloque D — Post-cutover (primera semana)

- [ ] Alta de Guillermo y Mariela en Auth nuevo + `npm run migrate:seed` o `auth:set-claims`
- [ ] Monitorear logs Netlify Functions (errores Gemini/auth)
- [ ] Confirmar que alertas email siguen llegando (schedule `send-alerts` activo en UN solo site publicado: si hay staging contra el mismo Firestore, `ALERTS_CRON_OFF=1` ahí)
- [ ] Confirmar que el fallback cliente no duplica (abrir la app tras una corrida del server: los flags ya marcados no reenvían)
- [ ] Archivar o dejar `doctravel-agencia` como backup (no borrar semanas)

---

## Resumen rápido

| Bloque | ¿Cuándo? | ¿Bloquea cutover? |
|--------|----------|-------------------|
| A | Ahora, en staging | **Sí** |
| B | Antes del cutover | No (recomendado) |
| C | Día del switch | — |
| D | Después | — |

---

## Registro de validación

| Campo | Valor |
|-------|--------|
| Fecha prueba | |
| Probado por | |
| Pasajeros visibles en staging | |
| Bloque A completo | Sí / No |
| Listo para cutover | Sí / No |
| Notas | |

---

*Complementa `docs/IMPORT-LEGACY.md` y `docs/GUIA-WORKSPACES-PARALELOS.md`.*