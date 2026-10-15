# Plan de Migración: De Fetch Manual a @google/genai SDK

**Fecha de creación:** 2026
**Objetivo principal:** Migrar las dos Netlify Functions de Gemini (`gemini-scan.js` y `gemini-travel.js`) al SDK oficial `@google/genai` para poder usar modelos más potentes de forma estable (especialmente `gemini-3.5-flash` y modelos Pro), mejorar la calidad de extracción y reducir errores misteriosos (502).

**Contexto del usuario:**
- Quiere máxima calidad posible en la extracción de documentos de viaje.
- Actualmente tiene problemas de 502 cuando intenta usar modelos mejores.
- Volumen bajo (~10 archivos por mes), por lo que el costo no es el factor principal.
- Prefiere que el sistema esté "mejor hecho" a largo plazo.

---

## 1. Estado Actual

### Archivos involucrados
- `netlify/functions/gemini-scan.js`
- `netlify/functions/gemini-travel.js`
- `netlify/functions/_auth.js` (solo auth, no se toca)

### Cómo funcionan hoy
- Usan `fetch` directo contra `https://generativelanguage.googleapis.com/v1beta/models/...`
- Manejan `GEMINI_MODEL` vía variable de entorno (con fallback).
- `gemini-scan.js`: Envía imágenes/PDFs como `inline_data` + system instruction + `responseMimeType: application/json`.
- `gemini-travel.js`: 
  - Parte 1: Usa Google Search grounding (tools) para buscar rutas.
  - Parte 2: Hace una segunda llamada para generar JSON estructurado.

### Problemas actuales
- Difícil usar modelos nuevos o Preview de forma confiable.
- Errores poco descriptivos cuando falla la llamada a Gemini.
- Código repetitivo y frágil para manejar respuestas.

---

## 2. Estado Deseado

- Usar el SDK oficial `@google/genai`.
- Poder usar cómodamente `gemini-3.5-flash` (y eventualmente modelos Pro) con buena calidad.
- Mejor manejo de errores.
- Código más limpio y mantenible.
- Aprovechar mejor las capacidades modernas del SDK (`responseSchema`, thinking, etc.).

---

## 3. Beneficios Esperados de la Migración

- Mejor soporte y estabilidad con modelos recientes (`gemini-3.5-flash`, Pro series).
- Mensajes de error mucho más claros cuando algo falla (gran ayuda para diagnosticar 502).
- Facilidad para usar `responseSchema` (JSON forzado de forma nativa y más confiable).
- Mejor manejo de PDFs e imágenes.
- Facilidad para evolucionar hacia uso de `thinking`, grounding mejorado, etc.
- Código más legible y profesional.

---

## 4. Alcance de la Migración

### Dentro del alcance
- Migrar completamente `gemini-scan.js`
- Migrar completamente `gemini-travel.js` (la parte más compleja por el grounding)
- Actualizar `package.json` para agregar la dependencia
- Actualizar documentación relevante (SETUP.md)
- Estrategia de testing

### Fuera del alcance (por ahora)
- Cambios en el frontend (`js/scanner.js` o `app.mjs`)
- Cambios en la lógica de negocio o prompts (solo la capa de comunicación con Gemini)
- Migración de `gemini-3.1-pro-preview-customtools` (evaluar después)

---

## 5. Plan de Migración Paso a Paso

### Paso 0: Preparación

- [ ] Crear un branch nuevo (`feat/migrate-to-google-genai-sdk`)
- [ ] Leer y entender bien ambos archivos actuales
- [ ] Revisar la documentación oficial del SDK: https://ai.google.dev/gemini-api/docs/sdks

### Paso 1: Agregar la Dependencia

```bash
npm install @google/genai
```

- Actualizar `package.json`
- Hacer commit de este cambio primero (separado)

### Paso 2: Migrar `gemini-scan.js` (Más simple)

**Cambios clave:**
- Reemplazar todo el bloque de `fetch` por el SDK.
- Usar `ai.models.generateContent` con `contents` que incluya el inline data.
- Manejar `systemInstruction`.
- Usar `responseMimeType: 'application/json'` o preferiblemente `responseSchema` (mejor opción a futuro).
- Mejor manejo de errores.

**Estructura recomendada después de la migración:**
```js
const ai = new GoogleGenAI({ apiKey });

const response = await ai.models.generateContent({
  model,
  contents: [
    { text: PROMPT },
    { inlineData: { mimeType, data } }
  ],
  config: {
    systemInstruction: SYSTEM_INSTRUCTION,
    responseMimeType: 'application/json',
    temperature: 0,
  }
});
```

**Notas importantes:**
- El SDK maneja mejor los errores → el catch debería dar información más útil.
- Probar bien con imágenes y PDFs.

### Paso 3: Migrar `gemini-travel.js` (La parte más compleja)

Esta función tiene dos llamadas a Gemini:

1. **Primera llamada (grounding)**: Usa Google Search para buscar rutas de vuelo.
2. **Segunda llamada**: Genera el JSON estructurado.

**Desafíos:**
- El grounding con Google Search se hace de forma distinta en el SDK nuevo (usando `tools`).
- Hay lógica de timeout y fallback cuando la búsqueda web falla.
- Se debe mantener el mismo comportamiento actual.

**Estrategia recomendada:**
- Migrar primero la segunda llamada (la de JSON), que es más parecida a `gemini-scan`.
- Luego migrar la lógica de grounding. Revisar la documentación actualizada de Grounding con Google Search en el SDK.

**Posible mejora futura (después de migrar):**
- Evaluar si se puede hacer todo en una sola llamada con function calling + grounding, pero **no** hacerlo en esta migración para mantener el comportamiento actual.

### Paso 4: Manejo de Variables de Entorno

Mantener el comportamiento actual:
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (con fallback)

El SDK acepta el modelo como string, así que no debería haber cambios grandes aquí.

### Paso 5: Testing

**Pruebas mínimas recomendadas:**

Para `gemini-scan.js`:
- Imagen de pasaporte argentino
- PDF de ESTA
- Imagen de visa B1/B2
- Caso con múltiples páginas
- Imagen de mala calidad

Para `gemini-travel.js`:
- Búsqueda de vuelo individual
- Itinerario GDS con varios segmentos
- Caso donde falla la búsqueda web (debe caer al fallback)

**Estrategia:**
- Probar primero con `gemini-1.5-flash` o `gemini-2.0-flash` (modelos estables).
- Una vez que funcione estable, probar con `gemini-3.5-flash`.

### Paso 6: Documentación y Limpieza

- Actualizar `SETUP.md` con el nuevo paquete y cualquier instrucción nueva.
- Actualizar comentarios en las funciones.
- Considerar eliminar código viejo de manejo manual de respuestas una vez que esté estable.

---

## 6. Riesgos y Gotchas Conocidos

- El grounding con Google Search tiene una API diferente en el SDK nuevo. Requiere atención especial.
- Algunos parámetros de `generationConfig` tienen nombres ligeramente distintos en el SDK.
- El manejo de errores cambia bastante (es una mejora, pero hay que adaptarse).
- Netlify Functions: verificar que el bundle con el nuevo SDK no se vuelva demasiado grande.
- Modelos Preview pueden seguir dando problemas ocasionales (aunque deberían ser menos frecuentes que con fetch manual).

---

## 7. Plan de Rollback

- Mantener el branch anterior limpio.
- Si algo sale muy mal, volver a la versión con `fetch` es sencillo (es solo revertir los dos archivos de funciones + remover la dependencia).

---

## 8. Orden Sugerido de Implementación

1. Agregar dependencia + PR pequeño.
2. Migrar `gemini-scan.js` primero (más simple y de alto impacto).
3. Probar exhaustivamente el escaneo de documentos.
4. Migrar `gemini-travel.js`.
5. Probar los dos flujos de travel.
6. Actualizar documentación.
7. Deploy a producción con modelo `gemini-3.5-flash`.

---

## 9. Preguntas Abiertas para Resolver Durante la Implementación

- ¿Cómo se implementa exactamente Google Search grounding con el SDK nuevo en 2026?
- ¿Vale la pena empezar a usar `responseSchema` en lugar de `responseMimeType: 'application/json'` durante esta migración?
- ¿Queremos mantener la lógica de dos llamadas en `gemini-travel.js` o intentar simplificarla?

---

**Notas finales para la implementación:**

Este archivo está pensado para ser leído en una sesión futura. El objetivo es que cualquier persona (o yo mismo en otra sesión) pueda seguir este plan sin perder contexto.

Priorizar calidad y estabilidad del sistema por sobre velocidad de implementación.

---

**Estado de implementación (2026):**
- ✅ Paso 0: Dependencia + NODE_VERSION + .gitignore
- ✅ Paso 1: `gemini-scan.js` migrado
- ✅ Paso 2: `gemini-travel.js` migrado (incluyendo correcciones de QA)
- Documentación actualizada (SETUP.md + comentarios en funciones)