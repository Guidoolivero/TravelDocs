// ============================================================
//  Netlify Function: gemini-scan
//  Proxy seguro entre el frontend y la API de Gemini + Claude (fallback).
//  Las API keys (GEMINI_API_KEY, ANTHROPIC_API_KEY) viven solo en las
//  env vars de Netlify (nunca en el browser).
//
//  Migrado a @google/genai SDK (Paso 1 - 2026)
//
//  Resiliencia (2026-06):
//  - Reintentos automáticos con backoff exponencial ante errores transitorios.
//  - Fallback a 'gemini-3.1-flash-lite' si el modelo principal da 503 / "high demand".
//  - Fallback final a Claude (Anthropic) si toda la cadena Gemini falla.
//    Pool de capacidad independiente de Gemini → ataca el 503 de capacidad.
//    Mismo prompt + mismo JSON schema → contrato { text } con el frontend sin cambios.
//  - Mensajes de error amigables para el usuario.
// ============================================================

const { verifyAuth } = require('./_auth.cjs');
const { recordUsage } = require('./_usage.cjs');

const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai');
const { Anthropic } = require('@anthropic-ai/sdk');
const { SYSTEM_INSTRUCTION, PROMPT } = require('./prompts/scan-prompt.cjs');

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
];

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method Not Allowed' });
  }

  const auth = await verifyAuth(event);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  console.log(`gemini-scan: agencyId=${auth.agencyId} uid=${auth.uid}`);

  const apiKey = process.env.GEMINI_API_KEY;
  // Cadena de modelos Gemini (configurable vía env vars):
  // - GEMINI_MODEL: modelo principal (default 'gemini-3.1-flash-lite', rápido y estable).
  // - GEMINI_FALLBACK_MODEL: modelo secundario si el principal falla con error transitorio
  //   (default 'gemini-3.5-flash', más calidad pero con 503 por alta demanda). 1 solo intento.
  // El secundario se omite si coincide con el principal. Después de la cadena Gemini viene Claude.
  const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash';

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    console.error('gemini-scan: body JSON inválido:', err?.message || err);
    return reply(400, { error: 'Body inválido (JSON requerido).' });
  }

  const { mimeType, data } = payload;
  if (!mimeType || !data) {
    return reply(400, { error: 'Faltan campos mimeType o data.' });
  }

  // Validar tipo de archivo permitido
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
  if (!allowedMimes.includes(mimeType)) {
    return reply(400, { error: 'Tipo de archivo no permitido. Solo JPG, PNG, WebP, GIF o PDF.' });
  }

  // Validar tamaño del payload (base64 agrega ~33% de overhead, limitar a ~30MB para archivos de hasta 20MB)
  if (event.body.length > 30 * 1024 * 1024) {
    return reply(413, { error: 'Archivo demasiado grande. Máximo 20MB.' });
  }

  // ── Intento 1: cadena Gemini (principal + secundario) ──────
  try {
    if (!apiKey) throw new Error('GEMINI_API_KEY no está configurada en Netlify.');
    const ai = new GoogleGenAI({ apiKey });

    const response = await generateContentWithRetries(ai, primaryModel, fallbackModel, {
      contents: [
        { text: PROMPT },
        { inlineData: { mimeType, data } }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        temperature: 0,
        safetySettings: SAFETY_SETTINGS
      }
    });

    const text = response.text || '';
    // Si Gemini responde vacío, lanzamos para que caiga al fallback a Claude
    // (mismo camino que un error transitorio) en vez de rendirse con un 502.
    if (!text) throw new Error('Respuesta vacía de Gemini.');

    console.log(`gemini-scan: OK source=gemini agencyId=${auth.agencyId}`);
    await recordUsage({ agencyId: auth.agencyId, kind: 'scans', source: 'gemini' });
    return reply(200, { text, source: 'gemini' });

  } catch (geminiErr) {
    // Gemini agotó reintentos + fallback de modelo. Probar Claude antes de rendirse.
    console.warn(
      `gemini-scan: cadena Gemini agotada, intentando fallback a Claude. ` +
      `Último error: ${(geminiErr?.message || geminiErr).toString().slice(0, 200)}`
    );

    try {
      const text = await processWithClaude(mimeType, data);
      console.log(`gemini-scan: OK source=claude agencyId=${auth.agencyId} uid=${auth.uid}`);
      await recordUsage({ agencyId: auth.agencyId, kind: 'scans', source: 'claude' });
      return reply(200, { text, source: 'claude' });
    } catch (claudeErr) {
      console.error('gemini-scan: Claude también falló:', (claudeErr?.message || claudeErr).toString().slice(0, 220));

      const message = (geminiErr?.message || 'error desconocido');
      const friendlyError = isTransientGeminiError(geminiErr)
        ? 'Los servicios de IA están con alta demanda en este momento. Esperá 30-60 segundos e intentá de nuevo.'
        : `No se pudo procesar el documento: ${message}`;

      return reply(502, { error: friendlyError });
    }
  }
};

// ============================================================
//  Claude (Anthropic) — fallback final
// ============================================================

/**
 * Procesa el documento con Claude. Mismo SYSTEM_INSTRUCTION + PROMPT que Gemini,
 * devuelve el texto (JSON string) que el frontend ya sabe parsear.
 * Reintenta ante 529 (overloaded) / 429 / 500.
 */
async function processWithClaude(mimeType, data) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('gemini-scan: ANTHROPIC_API_KEY no configurada, se omite fallback a Claude.');
    throw new Error('ANTHROPIC_API_KEY no configurada');
  }
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  // Timeout 8s por llamada a Claude (límite 30s de la Netlify Function).
  const client = new Anthropic({ apiKey, timeout: 8000 });
  const content = claudeContentBlocks(mimeType, data);

  const maxAttempts = 2;
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const msg = await client.messages.create({
        model,
        max_tokens: 2000,
        temperature: 0,
        system: SYSTEM_INSTRUCTION,
        messages: [{ role: 'user', content }]
      });

      const text = (msg.content || []).find(b => b.type === 'text')?.text || '';
      if (!text) throw new Error('Respuesta vacía de Claude.');
      return text;
    } catch (err) {
      lastErr = err;
      const status = err?.status;
      const transient = isTransientClaudeError(err);
      console.error(
        `gemini-scan: Claude intento ${attempt}/${maxAttempts} falló` +
        `${transient ? ' (transitorio)' : ''} (status=${status || '?'}, type=${err?.error?.type || '?'}): ` +
        `${(err?.message || '').slice(0, 220)}`
      );
      if (!transient || attempt === maxAttempts) throw err;
      const delay = 600 * attempt + Math.random() * 300;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// Construye los content blocks para Claude: imagen o documento PDF + texto del prompt.
function claudeContentBlocks(mimeType, data) {
  if (mimeType === 'application/pdf') {
    return [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
      { type: 'text', text: PROMPT }
    ];
  }
  return [
    { type: 'image', source: { type: 'base64', media_type: mimeType, data } },
    { type: 'text', text: PROMPT }
  ];
}

function isTransientClaudeError(err) {
  if (!err) return false;
  const status = err?.status;
  if (status === 529 || status === 429 || status === 500 || status === 503) return true;
  const type = err?.error?.type || '';
  if (type === 'overloaded_error' || type === 'rate_limit_error' || type === 'api_error') return true;
  return false;
}

// ============================================================
//  Helpers de resiliencia Gemini: reintentos + fallback de modelo
// ============================================================

/**
 * Detecta errores transitorios de Gemini (alta demanda / capacidad / temporales).
 * Cubre tanto el código HTTP como el texto del mensaje que devuelve el SDK.
 */
function isTransientGeminiError(err) {
  if (!err) return false;

  const status = err.status ?? err.code;
  const rawMessage = (err.message || err.toString() || '').toLowerCase();

  // Códigos claros de error del servidor / rate / overload
  if (status === 503 || status === 429) return true;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;

  // Mensajes típicos que devuelve Google cuando un modelo específico está saturado
  if (rawMessage.includes('high demand')) return true;
  if (rawMessage.includes('unavailable')) return true;
  if (rawMessage.includes('overloaded')) return true;
  if (rawMessage.includes('temporarily')) return true;
  if (rawMessage.includes('503')) return true;
  if (rawMessage.includes('429')) return true;

  return false;
}

/**
 * Ejecuta generateContent con reintentos automáticos + fallback a modelo secundario.
 *
 * Cadena: primario (2 intentos) -> secundario (1 intento) -> Claude (en el handler).
 * - Primario (default 'gemini-3.1-flash-lite'): rápido y estable.
 * - Secundario (default 'gemini-3.5-flash'): más calidad, pero con 503 por alta demanda.
 *   Solo se prueba si el primario falla con error transitorio. Se omite si == primario.
 * - Backoff exponencial corto (700ms, 1400ms, ...) + jitter para no golpear todos al mismo tiempo.
 * - Errores no transitorios (4xx de cliente, errores de auth, etc.) fallan inmediatamente.
 */
async function generateContentWithRetries(ai, primaryModel, fallbackModel, requestBody, maxAttemptsPerModel = 2) {
  // Construimos la cadena de modelos a probar (sin duplicados)
  const modelsToTry = [primaryModel];
  if (fallbackModel && fallbackModel !== primaryModel) {
    modelsToTry.push(fallbackModel);
  }

  let lastErr = null;

  for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
    const currentModel = modelsToTry[modelIndex];
    const attempts = (modelIndex === 0) ? maxAttemptsPerModel : 1; // 2 en primary, 1 en fallback

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        // Sin withTimeout: dejamos que Gemini corra hasta completar (igual que el
        // sitio viejo, que anda sin cap). Si Gemini cuelga de verdad, la función
        // cae contra el muro de 30s de Netlify sin llegar al fallback de Claude.
        const response = await ai.models.generateContent({ model: currentModel, ...requestBody });

        if (modelIndex > 0) {
          console.log(`gemini-scan: fallback exitoso con modelo ${currentModel} (primary era ${primaryModel})`);
        }
        return response;

      } catch (err) {
        lastErr = err;
        const transient = isTransientGeminiError(err);
        const shortMsg = (err?.message || '').slice(0, 220);

        console.error(
          `gemini-scan: intento ${attempt}/${attempts} con ${currentModel} falló` +
          `${transient ? ' (transitorio)' : ''}: ${shortMsg}`
        );

        // Errores fatales (no de capacidad) → no reintentamos ni hacemos fallback de modelo
        // (igual caemos al fallback a Claude en el handler).
        if (!transient) {
          throw err;
        }

        // Si todavía hay más intentos o más modelos, esperamos antes de reintentar
        const isLastOverall = (attempt === attempts) && (modelIndex === modelsToTry.length - 1);
        if (!isLastOverall) {
          const baseDelay = 700 * Math.pow(2, attempt - 1);
          const jitter = Math.random() * 350;
          const delay = Math.min(baseDelay + jitter, 4500);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
  }

  // Si llegamos acá es porque todos los intentos + fallback de modelo fallaron
  throw lastErr;
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

exports.handler = require('./_sentry.cjs').wrapHandler(exports.handler);
