# DocTravel v2 — Guía de configuración y deploy

## Pasos para poner en producción

### 1. Crear proyecto Firebase

1. Ir a https://console.firebase.google.com
2. **Crear proyecto** → darle un nombre (ej: `doctravel-agencia`)
3. En el panel del proyecto → **Authentication** → **Get started**
   - Habilitar proveedor: **Email/Password**
4. Crear los 3 usuarios del equipo:
   - Authentication → Users → **Add user**
   - Repetir para cada agente
5. En el panel → **Firestore Database** → **Create database**
   - Elegir región más cercana (ej: `southamerica-east1` para Argentina)
   - Empezar en **production mode**
6. En Firestore → **Rules**, reemplazar con:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /passengers/{docId} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
   → **Publish**

7. En el panel → **Project settings** (ícono ⚙) → **Your apps** → **Add app** → Web (`</>`)
   - Registrar app → copiar el objeto `firebaseConfig`

### 2. Obtener API key de Gemini (GRATIS)

1. Ir a https://aistudio.google.com/app/apikey
2. **Create API key** → seleccionar el proyecto de Firebase
3. Copiar la key

### 3. Configurar el proyecto

Editar el archivo `js/config.js` y completar solo Firebase:

```javascript
export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",        // de Firebase Console
  authDomain:        "doctravel-xxx.firebaseapp.com",
  projectId:         "doctravel-xxx",
  storageBucket:     "doctravel-xxx.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc"
};
```

La API key de Gemini ya NO va en frontend.

Configurar variables de entorno en Netlify:

1. Site settings → Environment variables
2. Agregar:
    - `GEMINI_API_KEY` = tu key de AI Studio
    - `GEMINI_MODEL` = `gemini-3.5-flash` (opcional — recomendado para mejor precisión en documentos)

**Sobre GEMINI_MODEL:**
- Default actual: `gemini-3.5-flash` (mejor calidad de extracción en pasaportes, visas y ESTA).
- Si querés minimizar costos: setealo en `gemini-3.1-flash-lite`.
- El cambio es instantáneo vía variable de entorno (no requiere redeploy de código).

**Medición de uso y gasto (reporte del panel super-admin):**
- Cada escaneo/análisis se cuenta en `agencies/{agencyId}/usage/{YYYY-MM-DD}` (lo escriben las Functions vía Admin SDK; el cliente no accede).
- El reporte "Uso y gasto" del panel super-admin muestra conteos + **gasto estimado en USD** por agencia (diario/semanal/mensual/histórico).
- El gasto se calcula con tarifas de venta por unidad (lo que cobrás a la agencia, no tu costo):
    - `COST_PER_SCAN_GEMINI` = `0.10` (USD por escaneo OCR resuelto con Gemini)
    - `COST_PER_SCAN_CLAUDE` = `0.10` (USD por escaneo OCR resuelto con el fallback Claude)
    - `COST_PER_TRAVEL` = `0.15` (USD por análisis de requisitos de vuelo)
- Sin límite por agencia: la red de seguridad es el tope mensual de la key de Google. Ajustá estas tarifas cuando cambies tu precio de venta.

**Migración al SDK oficial `@google/genai` (2026):**
- El proyecto ahora usa la biblioteca oficial de Google en lugar de `fetch` directo.
- Se agregó `package.json` + dependencia `@google/genai`.
- Netlify está configurado para usar Node 20 (`netlify.toml` → `NODE_VERSION = "20"`).
- No es necesario hacer nada extra al deployar.

### 4. Deploy en Netlify

**Opción A — Desde la interfaz web (más simple):**
1. Ir a https://app.netlify.com → **Add new site** → **Deploy manually**
2. Arrastrar la carpeta `DocTravel/` completa
3. ¡Listo! Te da una URL tipo `https://xxxx.netlify.app`

**Opción B — Con GitHub (recomendado para actualizaciones fáciles):**
1. Subir la carpeta a un repositorio de GitHub (privado)
2. En Netlify → **Add new site** → **Import from Git**
3. Conectar el repo → deploy automático en cada push

### 5. Dominio personalizado (opcional)
En Netlify → **Domain settings** → **Add custom domain**
Ejemplo: `docs.tuagencia.com`

---

## Estructura de archivos

```
DocTravel/
├── index.html
├── login.html
├── netlify.toml
├── SETUP.md
├── package.json
├── package-lock.json
├── .gitignore
├── MIGRATION_TO_GOOGLE_GENAI_SDK.md
├── js/
│   ├── config.js
│   ├── db.js
│   ├── utils.js
│   ├── ssr.js
│   ├── scanner.js
│   └── app.mjs
└── netlify/
    └── functions/
        ├── gemini-scan.js
        ├── gemini-travel.js
        └── _auth.js
```

---

## Funcionalidades

- ✅ Login con email/password (Firebase Auth)
- ✅ Sincronización en tiempo real entre los 3 usuarios (Firestore)
- ✅ Gestión completa de pasajeros (CRUD)
- ✅ Documentos: DNI, Pasaporte ARG, Pasaporte Extranjero, Visa 1, Visa 2
- ✅ Semáforo de vencimientos (🔴 Vencido / 🔴 Crítico / 🟡 Por vencer / 🟢 Vigente)
- ✅ Dashboard con estadísticas y alertas urgentes
- ✅ Vista de todos los documentos ordenados por vencimiento
- ✅ Generador SSR/FOID para Amadeus, Sabre y Galileo
- ✅ NM de infantes vinculados a adulto
- ✅ Lectura de documentos por IA (Gemini, vía backend seguro)
- ✅ Búsqueda global por nombre, apellido o número de documento
- ✅ Toast notifications y confirmaciones de borrado

---

## Límites gratuitos

| Servicio | Límite gratuito |
|----------|----------------|
| Firebase Auth | 10.000 usuarios gratis |
| Firestore | 50.000 lecturas/día, 20.000 escrituras/día |
| Netlify Hosting | 100 GB bandwidth/mes |
| Gemini (3.5 Flash / similares) | Límites variables según modelo (ver AI Studio) |

Para una agencia con 3 usuarios, estos límites son más que suficientes.
