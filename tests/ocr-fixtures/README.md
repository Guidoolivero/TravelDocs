# Fixtures OCR — Harness de regresión

Documentos de prueba para `scripts/ocr-regression.mjs`. **No subir a git** (contienen
datos personales): el directorio está en `.gitignore` salvo este README.

## Cómo usarlo

1. Poné acá 5-8 documentos reales (los mismos que usarías en QA manual).
   Nombrálos en snake-case:
   - `passport-arg.jpg` — pasaporte argentino (foto de celular, idealmente 3-8 MB)
   - `visa-usa.jpg` — visa USA
   - `dni-arg.jpg` — DNI argentino
   - `esta.jpg` — ESTA (si hay muestra)
   - `passport.pdf` — pasaporte en PDF (valida que PDF no regresa)
   - Acepta: `.jpg .jpeg .png .webp .gif .pdf`

2. Configurá las credenciales del usuario de test de Firebase (ej. `agencia-piloto`):
   ```bash
   export OCR_TEST_EMAIL=piloto@tuagencia.com
   export OCR_TEST_PASSWORD=...
   # opcional, default es netlify dev local:
   export OCR_SCAN_URL=https://<tu-staging>/.netlify/functions/gemini-scan
   ```

3. Armá el golden la primera vez (captura la extracción actual como baseline):
   ```bash
   npm run ocr:snapshot
   ```
   Revisá `golden.json` a ojo. Si un campo está mal, corregilo a mano — ese es
   tu baseline de corrección.

4. Cada vez que toques el pipeline OCR (2A, Claude, prompt, modelo), corré:
   ```bash
   npm run ocr:regression
   ```
   Pasa si ≥90% de los campos críticos matchean (con normalización). Exit 1 si
   hay regresión → no deployar hasta resolver.

## Qué cubre

- Regresión de extracción de Gemini ante cambios de prompt/modelo/compresión.
- Efecto de la compresión 2A (el runner comprime con `sharp` a 1600px/JPEG 0.80
  antes de enviar, igual que `prepareImageForScan` en el browser).
- `source=gemini|claude` por fixture: si Gemini estuvo caído en el run, veás
  qué fixtures usaron Claude.

## Qué NO cubre

- UI del browser (preview, toasts). Solo extracción.
- Claude a voluntad: solo se ejercita si Gemini falla en el run. Para forzar
  Claude haría falta un flag dev-only en `gemini-scan.cjs` (no implementado).
- No determinismo del LLM: por eso el umbral es 90% y no match exacto.
