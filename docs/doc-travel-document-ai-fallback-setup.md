# DocTravel - Configuración de Google Document AI como Fallback

## Contexto y Problema Original

El sistema **DocTravel** usa principalmente **Gemini Flash** (`gemini-3.5-flash`) para procesar documentos (pasaportes, visas, etc.).

**Problema principal:**
- Gemini Flash presenta errores frecuentes de **503 "This model is currently experiencing high demand"**.
- Esto afecta la confiabilidad del producto cuando se quiere vender a otras agencias.
- El retry actual (1/2 intentos) es insuficiente.

**Objetivo:**
Implementar una cadena de fallback robusta para que el sistema **casi nunca falle** visiblemente para el cliente final.

---

## Decisión de Arquitectura

Se definió la siguiente cadena de fallback:

```
Gemini Flash (principal - barato y rápido)
   ↓ (si falla después de retries)
Claude Sonnet 4.6 o Mistral OCR (fallback intermedio)
   ↓ (si también falla)
Google Document AI - Form Parser (fallback final - alta confiabilidad)
```

**Document AI** se eligió como último recurso porque:
- Usa el mismo billing account que ya tienen configurado.
- Es mucho más estable que los modelos LLM en picos de demanda.
- Está especializado en extracción estructurada de formularios.

---

## Estado Actual (22 de junio 2026)

### Lo que ya está configurado en Google Cloud

| Elemento                  | Valor / Estado                          | Notas |
|---------------------------|-----------------------------------------|-------|
| Proyecto                  | `doctravel-agencia`                     | Project Number: `924458842` |
| Document AI API           | **Habilitada**                          | - |
| Processor                 | `doc-travel-form-parser`                | Tipo: **Form Parser** |
| Processor ID              | `6ccef284ca71a0ce`                      | Location: `us` |
| Endpoint                  | `https://us-documentai.googleapis.com/v1/projects/924458842/locations/us/processors/6ccef284ca71a0ce:process` | - |
| Service Account           | `doc-travel-processor@doctravel-agencia.iam.gserviceaccount.com` | Creada |
| Clave JSON                | Descargada y guardada localmente        | Variable de entorno recomendada: `GOOGLE_CREDENTIALS` |

### Variable de entorno pendiente en Netlify

- **Nombre recomendado**: `GOOGLE_CREDENTIALS`
- **Valor**: Contenido completo del archivo JSON de la Service Account

---

## Próximos Pasos (Pendientes)

### 1. Configurar credenciales en Netlify

1. Ir a Netlify → Site configuration → Environment variables
2. Crear variable:
   - **Key**: `GOOGLE_CREDENTIALS`
   - **Value**: Pegar todo el contenido del archivo `.json` descargado
3. Redeploy

### 2. Implementar el código de Document AI

Crear / actualizar la función `processWithDocumentAI()` en `netlify/functions/document-scan.js` (o similar).

### 3. Integrar la cadena completa de fallback

Implementar lógica de retry + fallback:
- Gemini Flash (con exponential backoff)
- Claude Sonnet / Mistral OCR
- Document AI (último recurso)
- Guardar como "pendiente" si todo falla

### 4. (Opcional) Mejorar extracción de campos

El Form Parser devuelve entidades. Se puede mejorar el mapeo de campos específicos (número de pasaporte, fecha de vencimiento, nacionalidad, etc.).

---

## Código Base - processWithDocumentAI

```js
// netlify/functions/document-scan.js

import { DocumentProcessorServiceClient } from '@google-cloud/documentai';

async function processWithDocumentAI(imageBase64, mimeType = 'image/jpeg') {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

  const client = new DocumentProcessorServiceClient({
    credentials,
    projectId: credentials.project_id,
  });

  const name = `projects/924458842/locations/us/processors/6ccef284ca71a0ce`;

  const request = {
    name,
    rawDocument: {
      content: Buffer.from(imageBase64, 'base64'),
      mimeType,
    },
  };

  const [result] = await client.processDocument(request);
  const document = result.document;

  // Extraer campos
  const fields = {};
  if (document.entities) {
    document.entities.forEach(entity => {
      if (entity.type && entity.mentionText) {
        fields[entity.type] = entity.mentionText;
      }
    });
  }

  return {
    success: true,
    source: 'document-ai',
    text: document.text || '',
    fields,
    rawEntities: document.entities || [],
  };
}

export { processWithDocumentAI };
```

---

## Comandos útiles (Terminal / Cursor)

```bash
# Verificar que la variable de entorno esté disponible en Netlify
netlify env:list

# Redeploy solo las funciones
netlify deploy --prod --build

# Probar la función localmente (si usás netlify dev)
netlify dev
```

---

## Notas Importantes

- El Processor actual es **Form Parser**. Es bueno para pasaportes y formularios estructurados.
- Si en el futuro necesitan extracción más personalizada, pueden crear un **Custom Extractor** y entrenarlo.
- Document AI es más caro que Gemini Flash, pero como es fallback, el costo adicional debería ser bajo.
- Guardar la clave JSON de la Service Account en un lugar seguro (nunca subirla a Git).

---

## Resumen de Decisiones

| Decisión                    | Razón |
|----------------------------|-------|
| Usar Document AI como fallback final | Alta estabilidad + mismo billing |
| Form Parser como primer Processor | Bueno para documentos de viaje estructurados |
| Service Account dedicada     | Mejor práctica de seguridad |
| Variable de entorno en Netlify | Más seguro que subir el archivo JSON |

---

**Fecha de última actualización:** 22 de junio de 2026

Podés seguir trabajando desde acá. Cuando quieras, decime qué paso querés hacer ahora y te ayudo con el código o los comandos exactos.