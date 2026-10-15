# Funciones del Proyecto DocTravel

Este documento resume las funciones principales del sistema y el rol de cada modulo.

## 1) Gestion de pasajeros

- Alta, edicion y baja de pasajeros.
- Campos principales: apellido, nombre, fecha de nacimiento, sexo, nacionalidad, email, WhatsApp y observaciones.
- Sincronizacion en tiempo real para todos los usuarios conectados.
- Persistencia en Firestore con fechas de creacion y actualizacion.

## 2) Gestion de documentos

Cada pasajero puede tener:

- DNI argentino.
- Pasaporte argentino.
- Pasaporte extranjero (con pais emisor).
- Visa 1 y Visa 2 (pais, numero, lugar, tipo, emision, vencimiento y pasaporte asociado).

El sistema permite completar, editar y mantener todos estos datos por pasajero.

## 3) Alertas y vencimientos

- Semaforo por estado documental:
  - Vencido
  - Critico (0 a 30 dias)
  - Por vencer (31 a 90 dias)
  - Vigente
- Estado general por pasajero segun sus documentos.
- Badges visuales para identificar urgencias rapidamente.

## 4) Generador SSR / FOID para GDS

Genera automaticamente strings operativos para:

- `SRDOCS` (pasaporte completo y version corta sin pasaporte).
- `SRFOID` (DNI y pasaporte como FOID).
- `SRDOCO` (visas).
- `SRCTCE` (email de contacto).
- `CTCM` (celular de contacto).
- `NM` y `SRDOCS` para infantes vinculados a un adulto.

Parametros configurables:

- GDS (`YY`, `1S`, `1G`).
- Numero de pasajero (`P1`, `P2`, etc.).
- Numero de segmento (`S1`, `S2`, etc.).

## 5) Lectura de documentos con IA

- Carga de imagen del documento (JPG/PNG/WebP).
- Procesamiento principal con Gemini a traves de una Netlify Function (sin exponer API keys en frontend).
- Extraccion automatica de datos (tipo de documento, nombre, numero, fechas, sexo, nacionalidad, paises).
- Mapeo del resultado OCR/IA al formulario del pasajero.
- Fallback local con Tesseract.js cuando el servicio remoto no esta disponible.

## 6) Base tecnica por modulos

- `js/db.js`: CRUD y escucha en tiempo real de pasajeros en Firestore.
- `js/utils.js`: helpers de fechas, estados de vencimiento y utilidades compartidas.
- `js/ssr.js`: logica completa de armado y render de strings SSR/FOID.
- `js/scanner.js`: flujo OCR/IA, normalizacion de datos y mapeo al modelo de la app.
- `netlify/functions/gemini-scan.js`: endpoint backend para invocar Gemini de forma segura.

## 7) Beneficio operativo

DocTravel centraliza la gestion documental de la agencia, reduce errores de carga manual en GDS y acelera el trabajo diario gracias a sincronizacion multiusuario, alertas de vencimiento y lectura asistida por IA.
