# QA Multi-Tenant — Checklist de aceptación

**Proyecto:** `tradingdocs-mt`  
**Staging:** https://tradingdocs-staging.netlify.app  
**Agencias de prueba:** `trading-travel` (A) · `agencia-piloto` (B)

Marcá cada ítem al validar. Todos los de **Bloque obligatorio** deben pasar antes de dar acceso a una agencia externa.

---

## Preparación (una vez)

```bash
# 1. Agencia piloto + usuario vinculado (crear usuario en Auth primero)
GOOGLE_APPLICATION_CREDENTIALS=./keys/tradingdocs-mt.json \
  npm run pilot:create -- piloto@tuagencia.com --alerts-email tu-email@ejemplo.com

# 2. Pasajeros dummy (5 por agencia)
GOOGLE_APPLICATION_CREDENTIALS=./keys/tradingdocs-mt.json \
  npm run pilot:seed-passengers

# 3. Tests de reglas (requiere Java 21+)
npm run test:rules:emulator
```

| Campo | Valor |
|-------|-------|
| Usuario agencia A | ej. `guido@tradingtravel.com.ar` |
| Usuario agencia B | ej. `piloto@tuagencia.com` |
| Fecha QA | |
| Probado por | |

---

## Bloque obligatorio

### 1. Aislamiento de datos (Firestore)

- [ ] Usuario A logueado ve pasajeros de `trading-travel` (~584 + 5 dummy `PILOTO-TT-*`)
- [ ] Usuario A **no** ve pasajeros `PILOTO-AP-*` de `agencia-piloto`
- [ ] Usuario B logueado ve solo pasajeros `PILOTO-AP-*` (5 dummy)
- [ ] Usuario B **no** ve los ~584 pasajeros de Trading Travel
- [ ] En consola del navegador: sin `permission-denied` tras login válido
- [ ] `npm run test:rules:emulator` pasa (10 tests)

**Cómo probar manualmente:** login con A → buscar `PILOTO-AP` en el buscador (debe dar 0). Logout → login con B → buscar `GARCIA` o un pasajero real de TT (debe dar 0).

### 2. Alertas por agencia

- [ ] Usuario A: alertas email van a `agencies/trading-travel.alerts.email`
- [ ] Usuario B: alertas email van a `agencies/agencia-piloto.alerts.email` (distinto)
- [ ] Asunto del mail usa el `branding.appName` de cada agencia (`TradingDocs` vs `PilotoDocs`)

### 3. Branding por agencia

- [ ] Usuario A: sidebar/logo/título muestran **TradingDocs** (azul `#1a4fd6`)
- [ ] Usuario B: sidebar/logo/título muestran **PilotoDocs** (naranja `#c45c26`)

### 4. Functions Gemini (backend)

- [ ] Usuario A escanea documento → OK, logs muestran `agencyId=trading-travel`
- [ ] Usuario B escanea documento → OK, logs muestran `agencyId=agencia-piloto`
- [ ] Token sin `agencyId` válido → 403 (probar con usuario Auth sin doc en `users/{uid}`)

### 5. Notificaciones de vencimiento

- [ ] Descartar alerta en agencia A no afecta agencia B
- [ ] Paths: `agencies/{agencyId}/notifications/{key}` separados por tenant

### 6. Alta de pasajero

- [ ] Usuario A crea pasajero → aparece en `agencies/trading-travel/passengers`
- [ ] Usuario B crea pasajero → aparece en `agencies/agencia-piloto/passengers`
- [ ] Ninguno aparece en la colección de la otra agencia

### 7. Migración Trading Travel

- [ ] `agencies/trading-travel/passengers` tiene datos de producción importados
- [ ] `/passengers` global legacy no se usa para operación diaria

---

## Bloque recomendado

### Gemini travel (2 tenants)

- [ ] Usuario A consulta requisitos de vuelo → OK
- [ ] Usuario B consulta requisitos de vuelo → OK
- [ ] Logs `gemini-travel` con `agencyId` correcto por usuario

### Filtro duplicados

- [ ] Escanear pasajero existente en agencia A no duplica en A
- [ ] Mismo DNI en agencia B (tenant distinto) se permite si aplica la regla de negocio

---

## Escenarios Gemini — 2 tenants

| # | Usuario | Acción | Resultado esperado |
|---|---------|--------|-------------------|
| G1 | A (TT) | Escanear pasaporte JPG | 200, campos rellenados, log `agencyId=trading-travel` |
| G2 | B (Piloto) | Escanear mismo JPG | 200, campos rellenados, log `agencyId=agencia-piloto` |
| G3 | B (Piloto) | Requisitos de vuelo EZE-MIA | 200 o timeout transitorio, log con `agencia-piloto` |
| G4 | Sin users/{uid} | Cualquier call Gemini | 403 Usuario sin agencia asignada |
| G5 | A (TT) | Crear pasajero post-scan | Doc bajo `agencies/trading-travel/passengers` |

---

## Registro de QA

| Campo | Valor |
|-------|-------|
| Bloque obligatorio completo | Sí / No |
| Listo para onboarding agencia externa | Sí / No |
| Notas | |

---

*Complementa `docs/PLAN-ESCALABILIDAD-MULTI-AGENCIA.md` (sección 16) y `docs/ONBOARDING-AGENCIA.md`.*