# DocTravel - Especificacion Tecnica de Funciones

## 1. Objetivo del sistema

Aplicacion web para gestion documental de pasajeros en agencias de viaje.  
Core funcional: CRUD de pasajeros + monitoreo de vencimientos + generacion de strings SSR/FOID + OCR/IA para precarga de formularios.

## 2. Alcance funcional

### 2.1 Entidad principal: `Passenger`

Campos base:
- `lastname`, `firstname`, `dob`, `gender`, `nationality`
- `email`, `whatsapp`, `notes`

Subdocumentos:
- `dni`: `{ num, issue, exp }`
- `parg`: `{ num, issue, exp }` (pasaporte argentino)
- `pext`: `{ country, num, issue, exp }` (pasaporte extranjero)
- `visa1`, `visa2`: `{ country, num, issued_at, type, issue, exp, passport }`

Metadatos:
- `createdAt`, `updatedAt` (server timestamp)

### 2.2 Operaciones de dominio

- Alta de pasajero (`addPassenger`)
- Actualizacion de pasajero (`updatePassenger`)
- Baja de pasajero (`deletePassenger`)
- Sincronizacion realtime de lista (`listenPassengers`)

## 3. Arquitectura tecnica

Frontend:
- HTML/CSS/JavaScript vanilla (sin framework)

Backend serverless:
- Netlify Functions (`/.netlify/functions/gemini-scan`)

Persistencia:
- Firebase Firestore (coleccion `passengers`)

Auth:
- Firebase Auth email/password

IA/OCR:
- Camino principal: Gemini via function backend
- Fallback: Tesseract.js en cliente

## 4. Modulos y responsabilidades

### `js/db.js`
- Inicializa Firestore (`initDB`)
- Implementa CRUD asincrono para `passengers`
- Implementa listener realtime con `onSnapshot`
- Sanitiza payload para evitar `undefined` en Firestore

### `js/utils.js`
- Parseo y formateo de fechas (`parseDate`, `fmtDate`, `fmtDateGDS`, `fmtDateFull`)
- Calculo de dias a vencimiento (`daysUntil`)
- Clasificacion documental (`docStatus`, `passengerOverallStatus`)
- Render de badge de estado (`statusBadge`)
- Helpers auxiliares (`initials`, `escStr`, `genId`)

### `js/ssr.js`
- Generadores:
  - `generateSRDOCS`, `generateSRDOCSShort`
  - `generateSRFOID`
  - `generateSRDOCO`
  - `generateSRCTCE`, `generateCTCM`
  - `generateInfantNM`, `generateSRDOCSInfant`
- Builder central: `buildSSRStrings`
- Render de salida y acciones de copiado: `renderSSROutput`

### `js/scanner.js`
- Orquestador de escaneo: `scanDocument`
- Llamada segura backend: `scanWithGemini`
- OCR local fallback (Tesseract)
- Normalizacion robusta de OCR:
  - deteccion de tipo documental (`inferType`)
  - extraccion MRZ (`extractMrz`)
  - normalizacion de fechas (`normalizeDate`, `mrzDateToIso`)
  - normalizacion de sexo/pais/nacionalidad
- Mapeo a modelo interno de formulario: `mapScanToForm`

### `netlify/functions/gemini-scan.js`
- Proxy backend para IA
- Aisla API key del cliente
- Retorna payload parseable por `scanner.js`

## 5. Reglas de negocio relevantes

- Estados de vencimiento:
  - `expired`: dias < 0
  - `critical`: 0-30
  - `warning`: 31-90
  - `ok`: > 90
  - `nodata`: sin fecha
- Estado global del pasajero = peor estado entre documentos cargados
- Si no hay pasaporte, se permite `SRDOCS` corto
- Soporte de infantes vinculado a adulto (NM + SRDOCS infante)

## 6. Entradas / salidas clave

Entradas:
- Formularios manuales de pasajero/documentos
- Imagen documental para OCR/IA (`image/*`, limite tamano)

Salidas:
- Registros persistidos en Firestore
- Alertas visuales por estado
- Strings GDS listos para copiar/pegar
- Payload mapeado automaticamente al formulario tras escaneo

## 7. Consideraciones no funcionales

- Multiusuario en tiempo real
- Seguridad de API keys (nunca en frontend)
- Funcionamiento degradado sin backend IA (fallback OCR local)
- Costos operativos bajos usando planes gratuitos (Firebase + Netlify + Gemini)
