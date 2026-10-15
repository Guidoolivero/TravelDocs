# Instructivo — Usuarios, agencias y multi-tenant

Guía paso a paso para **crear usuarios**, **dar de alta agencias** y entender cómo funciona DocTravel con varias agencias.

**Proyecto Firebase:** `tradingdocs-mt`  
**App staging:** https://tradingdocs-staging.netlify.app  
**Agencia actual (producción de prueba):** `trading-travel`

---

## 1. Cómo funciona (en 2 minutos)

Cada persona que entra a la app pertenece a **una sola agencia**. Eso se define en Firestore y en el token de login.

```
Login (email + contraseña)
    ↓
Firebase Auth devuelve el UID  (ej: tttP8Q0GC2NhGY97dh6gry0ipIz1)
    ↓
La app lee  users/{UID}  en Firestore
    ↓
Obtiene agencyId  (ej: "trading-travel" o "agencia-piloto")
    ↓
Todo lo que hace el usuario queda bajo:
    agencies/{agencyId}/passengers
    agencies/{agencyId}/notifications
```

### Estructura en Firestore

```
Firestore (raíz)
│
├── users/                              ← el login lee acá
│   └── {UID}                           ← el ID del doc ES el UID de Auth (no hay campo "uid")
│       ├── email
│       ├── agencyId      → "trading-travel"
│       ├── role          → owner | admin | agent
│       ├── active        → true
│       └── displayName
│
└── agencies/
    └── {agencyId}/                     ← ej: trading-travel, agencia-piloto
        ├── name, status, plan
        ├── branding                    → nombre app, logo, color
        ├── alerts                      → email + keys EmailJS (+ private key)
        ├── passengers/                 ← pasajeros de ESA agencia
        ├── notifications/              → ledger de alertas ya enviadas (ESA agencia)
        ├── reservations/               ← check-ins de vuelo: piernas[], alertEmail,
        │                                  alertHorasAntes (24/48/72hs), fecha (= mínima
        │                                  de piernas, la recalcula js/db.js al guardar)
        └── members/
            └── {UID}                   ← copia del miembro (email, role)
```

**Importante:** `{UID}` no es un campo dentro del documento. Es el **nombre del documento** (el string que ves en Authentication → User UID).

---

## 2. Antes de empezar (una sola vez)

### 2.1 Credenciales para los scripts

Los scripts necesitan acceso de administrador a Firebase. Tenés que tener el archivo JSON de la service account:

1. Firebase Console → proyecto `tradingdocs-mt`
2. ⚙️ Project settings → **Service accounts**
3. **Generate new private key** → guardá el `.json` (no lo subas a git)
4. Ponelo en una ruta local, por ejemplo: `keys/tradingdocs-mt.json`

### 2.2 Terminal en la carpeta del proyecto

```bash
cd /Users/guidoolivero/Documents/TradingDocs/DocTravel
```

### 2.3 Variable de entorno (usala en cada comando)

```bash
export GOOGLE_APPLICATION_CREDENTIALS=./keys/tradingdocs-mt.json
```

(Ajustá la ruta si guardaste el JSON en otro lugar.)

---

## 3. Crear el usuario piloto (agencia de prueba)

La **agencia piloto** (`agencia-piloto`) sirve para probar que dos agencias no se mezclan. El usuario piloto es independiente de Guido / Trading Travel.

### Paso 1 — Crear el usuario en Firebase Auth

1. Abrí https://console.firebase.google.com → proyecto **`tradingdocs-mt`**
2. Menú izquierdo → **Authentication** → pestaña **Users**
3. Clic en **Add user**
4. Completá:
   - **Email:** `piloto@tuagencia.com` (o el que quieras usar en QA)
   - **Password:** una contraseña temporal (ej: `Piloto2026!`)
5. Clic **Add user**
6. **Copiá el User UID** que aparece en la tabla (ej: `xYz9abc...`). Lo vas a ver después como ID del doc en `users/`.

### Paso 2 — Crear la agencia piloto y vincular el usuario

En la terminal (con `GOOGLE_APPLICATION_CREDENTIALS` configurado):

```bash
cd /Users/guidoolivero/Documents/TradingDocs/DocTravel

export GOOGLE_APPLICATION_CREDENTIALS=./keys/tradingdocs-mt.json

npm run pilot:create -- piloto@tuagencia.com --alerts-email tu-email@gmail.com
```

Reemplazá:
- `piloto@tuagencia.com` → el mismo email del Paso 1
- `tu-email@gmail.com` → donde querés recibir las alertas de prueba de la agencia piloto

**Qué hace este comando:**

| Acción | Dónde queda |
|--------|-------------|
| Crea la agencia | `agencies/agencia-piloto` |
| Branding naranja "PilotoDocs" | `agencies/agencia-piloto.branding` |
| Config de alertas | `agencies/agencia-piloto.alerts` |
| Vincula al usuario | `users/{UID}` con `agencyId: "agencia-piloto"` |
| Registra como miembro | `agencies/agencia-piloto/members/{UID}` |
| Actualiza el JWT | custom claims `agencyId` + `role` |

Si ves `[pilot] OK users/...` → salió bien.

### Paso 3 — (Opcional) Pasajeros de prueba

```bash
npm run pilot:seed-passengers
```

Crea 5 pasajeros dummy en cada agencia:
- `PILOTO-TT-*` en `trading-travel`
- `PILOTO-AP-*` en `agencia-piloto`

### Paso 4 — Probar el login del piloto

1. Abrí https://tradingdocs-staging.netlify.app/login.html
2. **Cerrá sesión** si estabas con Guido
3. Entrá con `piloto@tuagencia.com` y la contraseña del Paso 1
4. Deberías ver:
   - Título/app **PilotoDocs** (naranja)
   - Solo pasajeros `PILOTO-AP-*` (no los ~584 de Trading Travel)

### Paso 5 — Volver a probar Trading Travel

1. Cerrá sesión
2. Entrá con `guido@tradingtravel.com.ar`
3. Deberías ver **TradingDocs** (azul) y los pasajeros de Trading Travel

Checklist completo: `docs/QA-MULTI-TENANT.md`

---

## 4. Crear una agencia nueva (no piloto)

Hoy no hay panel en la app (eso es Fase 4). Para una agencia real nueva seguí este flujo.

### Paso 1 — Definir los datos

Anotá esto antes de tocar Firebase:

| Dato | Ejemplo | Regla |
|------|---------|-------|
| **agencyId** (slug) | `viajes-del-sur` | Minúsculas, sin espacios, único, no se cambia fácil |
| Nombre comercial | Viajes del Sur | Texto libre |
| Plan | `trial` / `starter` / `pro` | Según contrato |
| Nombre en la app | ViajesDelSur Docs | `branding.appName` |
| Color | `#2d6a4f` | `branding.primaryColor` |
| Email alertas | alertas@viajesdelsur.com | Inbox default del email unificado (vencimientos + check-ins + cumpleaños). Cada check-in puede sobreescribirlo con su propio email y adelanto 24/48/72hs |
| EmailJS | public key, service id, template id | Una config por agencia (recomendado). La private key NO va acá: si la cuenta tiene "strict mode", va como env var `EMAILJS_PRIVATE_KEY` del site Netlify (la usa el envío server-side) |

### Paso 2 — Crear el documento de la agencia en Firestore

1. Firebase Console → **Firestore Database** → proyecto `tradingdocs-mt`
2. Colección `agencies` → **Add document**
3. **Document ID:** `viajes-del-sur` (tu `agencyId`)
4. Campos (tipo → valor):

```
name          string    Viajes del Sur
slug          string    viajes-del-sur
status        string    active
plan          string    trial

branding      map
  appName       string    ViajesDelSur Docs
  logoUrl       string    assets/logo.jpeg
  primaryColor  string    #2d6a4f

alerts        map
  email               string    alertas@viajesdelsur.com
  emailjsPublicKey    string    (tu key EmailJS)
  emailjsServiceId    string    (tu service id)
  emailjsTemplateId   string    (tu template id)

  OJO: la Private Key de EmailJS NO va en este documento (el browser de
  cualquier miembro lee el doc completo de la agencia). Si la cuenta EmailJS
  tiene "strict mode", va como env var EMAILJS_PRIVATE_KEY del site Netlify
  y la usa send-alerts.cjs para el envío server-side.

createdAt     timestamp  (ahora)
updatedAt     timestamp  (ahora)
trialEndsAt   null
```

5. **Save**

### Paso 3 — Crear el usuario owner en Authentication

1. **Authentication** → **Users** → **Add user**
2. Email del dueño: `owner@viajesdelsur.com`
3. Contraseña temporal
4. Copiá el **User UID**

### Paso 4 — Vincular usuario ↔ agencia

**Opción A — Manual en Firestore (si no querés script)**

1. Firestore → colección **`users`** (raíz, no dentro de `agencies`)
2. **Add document**
3. **Document ID:** el UID del Paso 3 (pegá el string completo)
4. Campos:

```
agencyId      string    viajes-del-sur
email         string    owner@viajesdelsur.com
role          string    owner
displayName   string    Nombre del dueño
active        boolean   true
createdAt     timestamp (ahora)
```

5. Firestore → `agencies` → `viajes-del-sur` → subcolección **`members`**
6. **Add document** con **Document ID** = mismo UID
7. Campos:

```
email         string    owner@viajesdelsur.com
role          string    owner
active        boolean   true
invitedAt     timestamp (ahora)
lastLoginAt   null
```

8. En terminal, sincronizar el JWT:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=./keys/tradingdocs-mt.json
npm run auth:set-claims
```

**Opción B — Con script (recomendado para repetir)**

1. Copiá `scripts/create-pilot-agency.mjs` → `scripts/create-mi-agencia.mjs`
2. Cambiá `AGENCY_ID` y el objeto `AGENCY_DOC` con los datos del Paso 1
3. Ejecutá:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=./keys/tradingdocs-mt.json
node scripts/create-mi-agencia.mjs owner@viajesdelsur.com --alerts-email alertas@viajesdelsur.com
```

### Paso 5 — El owner entra a la app

1. URL: https://tradingdocs-staging.netlify.app (o prod cuando corresponda)
2. Login con `owner@viajesdelsur.com`
3. Primera vez: **cerrar sesión y volver a entrar** si ves error de permisos (refresca los custom claims)

### Paso 6 — Agregar más agentes a la misma agencia

Por cada agente nuevo:

1. **Authentication** → Add user (email + contraseña)
2. Copiar su UID
3. Crear `users/{UID}` con el **mismo** `agencyId: viajes-del-sur` y `role: agent` (o `admin`)
4. Crear `agencies/viajes-del-sur/members/{UID}`
5. `npm run auth:set-claims`

Roles válidos:

| Rol | Permisos |
|-----|----------|
| `owner` | Dueño de la agencia |
| `admin` | Administración |
| `agent` | Uso diario (pasajeros, scanner, etc.) |

**Regla v1:** un usuario = **una sola agencia**. No se puede estar en dos agencias con el mismo email.

---

## 5. Cómo verificar que quedó bien

### En Firebase Console

| Qué buscar | Dónde | OK si… |
|------------|-------|--------|
| Agencia existe | `agencies/{agencyId}` | `status: active` |
| Usuario vinculado | `users/{UID}` | `agencyId` correcto, `active: true` |
| Miembro registrado | `agencies/{id}/members/{UID}` | email y role coinciden |
| UID correcto | Authentication → Users | Mismo string que el ID del doc en `users/` |

### En la app

| Prueba | Resultado esperado |
|--------|-------------------|
| Login con el usuario nuevo | Entra sin "no autorizado" |
| Branding | Nombre y color de **su** agencia |
| Crear pasajero | Aparece en `agencies/{su-id}/passengers` |
| Otro usuario de otra agencia | No ve esos pasajeros |

---

## 6. Problemas frecuentes

### "Tu cuenta no está autorizada"

- No existe `users/{UID}` para ese usuario, o `active: false`
- El `agencyId` en `users/{UID}` no coincide con ninguna agencia `active`
- **Solución:** revisar Pasos 3–4 de la sección que corresponda + `npm run auth:set-claims`

### `permission-denied` en la consola del navegador

- Faltan custom claims en el JWT
- **Solución:** `npm run auth:set-claims`, cerrar sesión, volver a entrar

### El script dice "no existe en Firebase Auth"

- Creaste el doc en Firestore pero **no** el usuario en Authentication
- **Solución:** Authentication → Add user primero, después el script

### Confundí `users` con `members`

| Colección | Ubicación | Para qué |
|-----------|-----------|----------|
| `users/{UID}` | Raíz de Firestore | **Login y tenant** (obligatorio) |
| `members/{UID}` | Dentro de `agencies/{id}/` | Registro del equipo (también necesario) |

### Alertas no llegan

- Revisá `agencies/{id}.alerts.email` y las keys EmailJS
- Cada agencia puede usar su propia cuenta EmailJS
- El envío principal es la scheduled function `send-alerts` (Netlify, cada hora, independiente de sesión): en el dashboard de Netlify → **Functions** → `send-alerts` están los logs de cada corrida y el botón **Run now** para dispararla a mano
- La function corre cada hora SOLO en el deploy publicado (los deploy previews no ejecutan schedules)
- Si la cuenta EmailJS tiene "strict mode", el envío server-side exige la private key como env var `EMAILJS_PRIVATE_KEY` del site Netlify (NO va en el doc de la agencia: lo lee el browser de los miembros)
- **El template debe usar TRIPLE llave para el mensaje**: `{{{message}}}` (las dobles `{{message}}` ESCAPAN el HTML). El código envía el documento HTML completo (charset, modo oscuro con `prefers-color-scheme`, estilos inline); da igual si el template lo envuelve en `<html><body>...` o es solo la variable (verificado en ambos formatos, los clientes toleran el anidado).
  Asunto: `{{subject}}` · To Email: `{{to_email}}`. Verificar con `node --env-file=.env scripts/test-email-html.mjs`
- Si hay dos sites publicados contra el mismo Firestore (ej. producción + staging), setear la env var `ALERTS_CRON_OFF=1` en el que NO debe enviar, para no duplicar emails (cubre el cron y el "Run now")

---

## 7. Comandos de referencia rápida

```bash
cd /Users/guidoolivero/Documents/TradingDocs/DocTravel
export GOOGLE_APPLICATION_CREDENTIALS=./keys/tradingdocs-mt.json

# Trading Travel (equipo original)
npm run migrate:seed

# Agencia piloto + usuario piloto
npm run pilot:create -- piloto@tuagencia.com --alerts-email tu@gmail.com
npm run pilot:seed-passengers

# Sincronizar JWT después de cambios manuales en users/
npm run auth:set-claims

# Tests de aislamiento (requiere Java 21+)
npm run test:rules:emulator
```

---

## 8. Resumen visual del flujo

```
┌─────────────────────────────────────────────────────────┐
│  NUEVA AGENCIA                                          │
├─────────────────────────────────────────────────────────┤
│  1. Definir agencyId, branding, alerts                  │
│  2. Crear doc  agencies/{agencyId}                      │
│  3. Crear usuario en Authentication                     │
│  4. Crear  users/{UID}  +  members/{UID}                │
│  5. npm run auth:set-claims                             │
│  6. Owner hace login → opera aislado de otras agencias  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  USUARIO PILOTO (atajo con script)                      │
├─────────────────────────────────────────────────────────┤
│  1. Authentication → Add user (piloto@...)              │
│  2. npm run pilot:create -- piloto@...                  │
│  3. npm run pilot:seed-passengers  (opcional)           │
│  4. Login en staging → ver PilotoDocs naranja           │
└─────────────────────────────────────────────────────────┘
```

---

## 9. Documentos relacionados

| Archivo | Contenido |
|---------|-----------|
| `docs/QA-MULTI-TENANT.md` | Checklist para validar aislamiento entre agencias |
| `docs/ONBOARDING-AGENCIA.md` | Procedimiento operativo resumido |
| `docs/PLAN-ESCALABILIDAD-MULTI-AGENCIA.md` | Plan técnico completo |
| `scripts/create-pilot-agency.mjs` | Script agencia piloto |
| `scripts/seed-trading-travel.mjs` | Script agencia Trading Travel |

---

*Última actualización: Fase 3 — multi-tenant en staging (`tradingdocs-mt`).*