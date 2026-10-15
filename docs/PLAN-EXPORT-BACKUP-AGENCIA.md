# Plan: Export Excel de agencia (backup antes de baja)

## Context

Hoy `deleteAgency()` ([admin-api.cjs:365-422](DocTravel/netlify/functions/admin-api.cjs#L365-L422)) borra la agencia con `recursiveDelete` sin backup previo, y no existe ningún endpoint para que el super-admin lea los pasajeros de una agencia. Antes de dar de baja una agencia hace falta poder descargar un Excel con todos sus datos (pasajeros + reservas).

**Decisiones tomadas con el usuario:** alcance = pasajeros + reservas; botón en la fila de la tabla de agencias del panel super-admin (disponible siempre, no solo al borrar); Excel con hojas separadas.

**Enfoque:** endpoint nuevo en `admin-api.cjs` que devuelve JSON (Admin SDK ya está), y el Excel se arma en el browser con SheetJS, que ya está cargado por CDN en `index.html:1120` (lo usa el import masivo). Cero dependencias nuevas, cero generación binaria server-side.

## Cambios

### 1. Backend: `netlify/functions/admin-api.cjs`

- **Routing** (handler, ~líneas 49-57): agregar rama `GET /agencies/:agencyId/export` (segments `[agencies, :id, export]`).
- **Nueva función `exportAgency(event)`** (~40 líneas):
  - `requirePlatformAdmin()` igual que el resto.
  - Lee el doc raíz `agencies/{id}` (nombre/slug para el frontend).
  - `db().collection('agencies/{id}/passengers').get()` → mapear `doc.data()` + `id`. Convertir timestamps `createdAt`/`updatedAt` a ISO string para que sean JSON-serializables.
  - `db().collection('agencies/{id}/reservations').get()` → ídem.
  - `audit(adminAuth, 'export-agency-data', { agencyId, passengerCount, reservationCount })` reutilizando `audit()` existente (línea 671).
  - Responder con `reply(200, { agency: {name, slug}, passengers, reservations })`.
- No paginación en v1: una agencia de viajes tiene cientos/miles de pasajeros y el JSON plano entra holgado en el límite de 6 MB de Netlify. Si alguna agencia lo excede, agregar paginación después.

### 2. Frontend panel: `js/app.mjs` (sección ADMINISTRACIÓN, 3964-4614)

- **`renderAgenciesTable()`** (~4031-4053): agregar botón con `data-agency-export="${a.id}"` junto al de eliminar (4050), ícono de descarga + título "Descargar backup Excel".
- **Delegación de clicks** (4593-4610): agregar rama para `data-agency-export` → `exportAgencyData(agencyId)`.
- **Nueva `exportAgencyData(agencyId)`** (~80 líneas):
  1. `adminFetch('/agencies/' + id + '/export')` (patrón existente, app.mjs:3981).
  2. Aplanar cada pasajero a una fila: columnas planas `dni_num`, `dni_issue`, `dni_exp`, `parg_*`, `pext_*`, `visa1_country`, `visa1_exp`, `visa2_*`, `ffn1_airline`, `ffn1_number`, etc. (nested objects con spread manual; `visas`/`asistencias`/`ffn` son arrays cortos).
  3. Armar workbook con `XLSX.utils.json_to_sheet()` (ya disponible, mismo global que usa `startExcelImport()` en 2235):
     - Hoja **Pasajeros**: una fila por pasajero, visas/asistencias aplanadas a columnas numeradas.
     - Hoja **Reservas**: una fila por pierna de vuelo (`piernas[]`), repitiendo columnas de la reserva (pasajero, fecha, vuelo, origen, destino, escalas, checkin, compania, reservaVuelo).
  4. `XLSX.writeFile(wb, 'backup-' + slug + '-YYYY-MM-DD.xlsx')`.
  5. Toast de éxito/error con `showToast`; deshabilitar el botón con spinner mientras corre (patrón `btn-spinner` existente).

### 3. Modal de baja (opcional, un toque): `index.html` 1091-1110

Agregar al texto del modal de eliminación una línea: "Si necesitás conservar los datos, descargá el backup antes de confirmar" (sin botón extra; el de la fila queda al lado).

## Archivos tocados

1. [netlify/functions/admin-api.cjs](DocTravel/netlify/functions/admin-api.cjs) — ruta + `exportAgency()` + audit
2. [js/app.mjs](DocTravel/js/app.mjs) — botón, delegación, `exportAgencyData()`
3. [index.html](DocTravel/index.html) — texto del modal de baja (1 línea)

## Qué NO se hace

- No se agregan deps npm (SheetJS ya está vía CDN).
- No se exportan notifications (solo `{sentAt}`, sin valor para la agencia), members, usage ni auditLogs.
- No se toca el flujo de `deleteAgency()`.
- No se cambia `firestore.rules` (el endpoint usa Admin SDK, que saltea rules).

## Verificación

1. `netlify dev` local + login con usuario `platformAdmin` (claim + email en `PLATFORM_SUPER_ADMIN_EMAILS`).
2. Panel administración → pestaña Agencias → botón descarga en una fila → baja `backup-<slug>-<fecha>.xlsx` y abrirlo: hoja Pasajeros con todos los pasajeros de esa agencia y hoja Reservas con las piernas.
3. Verificar en consola Firebase que `auditLogs` registró `export-agency-data`.
4. Verificar que el botón no aparece para usuarios no platform-admin (la vista admin entera ya está gateada por claim, app.mjs:205).
5. `npm test` para confirmar que nada del frontend se rompió.
6. Re-indexar el grafo con `index_repository` después de los cambios (convención del repo).
