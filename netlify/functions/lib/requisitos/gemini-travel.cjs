// ============================================================
//  Netlify Function: gemini-travel
//  Modo A — vuelo individual: Gemini + Google Search busca la
//            ruta real (con paradas técnicas), luego analiza
//            requisitos por país.
//  Modo B — itinerario GDS: recibe los segmentos parseados del
//            PNR de Amadeus, busca paradas técnicas ocultas y
//            analiza requisitos del itinerario completo.
//
//  Variables de entorno en Netlify:
//    GEMINI_API_KEY   — requerida
//    GEMINI_TRAVEL_MODEL — opcional (default gemini-3.5-flash-lite)
//    FIREBASE_API_KEY — requerida (para validar el ID token del usuario)
//
//  Migrado a @google/genai SDK (Paso 2 - 2026)
// ============================================================

const { verifyAuth } = require('../../_auth.cjs');
const { recordUsage } = require('../../_usage.cjs');
const { createHash } = require('node:crypto');

const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai');

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
];

const NETLIFY_DEADLINE_MS        = 22000; // margen antes del corte duro de Netlify: las sync functions tienen limite de 26s (10s default, max 26s por sitio). El 55s anterior asumia 60s inexistente y provocaba 502 intermitentes (~30s).
const ROUTE_STEP_BUDGET_MS       = 9000;  // presupuesto total del Paso 1 (thinking High + googleSearch): 1 intento de 8.5s + margen, deja ~13s para el analisis JSON
const ROUTE_ATTEMPT_TIMEOUT_MS   = 8500;  // timeout por intento del Paso 1 (thinking High + googleSearch); si aborta hay degradacion graceful (ruta inferida sin busqueda)
const VERIFY_ATTEMPT_TIMEOUT_MS  = 15000; // intento de la fase verificacion (Paso 2b en su propia llamada de 26s): con presupuesto propio puede razonar mas
const ANALYSIS_FALLBACK_RESERVE_MS = 8000; // ventana garantizada para el round 1 (fallback 3.1-flash-lite): sin esto, un intento principal lento (thinking High) podia comerse todo el presupuesto y el fallback quedaba sin chance -> "No se pudo conectar con Gemini"
const STABLE_FALLBACK_MODEL      = 'gemini-3.1-flash-lite';
const JSON_RETRY_SUFFIX =
  '\n\nCRÍTICO: Devolvé ÚNICAMENTE JSON válido y COMPLETO (sin markdown). ' +
  'Descripciones breves (máx 100 caracteres). Máximo 5 requisitos por parada. ' +
  'Omití campos opcionales vacíos.';

const sanitize = v => (v || '').toString()
  .replace(/[\r\n\t]/g, ' ')
  .replace(/[^\x20-\x7E\u00C0-\u024F]/g, '')
  .trim()
  .slice(0, 200);

function isTransientGeminiError(err) {
  if (!err) return false;

  const status = err.status ?? err.code;
  const rawMessage = (err.message || err.toString() || '').toLowerCase();

  if (status === 503 || status === 429) return true;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;
  if (err.name === 'AbortError') return true;

  return (
    rawMessage.includes('high demand') ||
    rawMessage.includes('unavailable') ||
    rawMessage.includes('overloaded') ||
    rawMessage.includes('temporarily') ||
    rawMessage.includes('aborted') ||
    rawMessage.includes('503') ||
    rawMessage.includes('429')
  );
}

function backoffDelay(attempt) {
  const baseDelay = 400 * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 200;
  return Math.min(baseDelay + jitter, 2000);
}

function isAbortError(err) {
  const rawMessage = (err?.message || '').toLowerCase();
  return err?.name === 'AbortError' || rawMessage.includes('aborted');
}

function remainingMs(deadlineMs) {
  return deadlineMs ? Math.max(0, deadlineMs - Date.now()) : Infinity;
}

/**
 * generateContent con reintentos + fallback a gemini-3.1-flash-lite ante 503/alta demanda.
 * requestFactory() se invoca en cada intento para permitir un AbortSignal nuevo (Paso 1).
 */
async function generateContentWithRetries(ai, primaryModel, requestFactory, logLabel = 'gemini-travel', options = {}) {
  const {
    maxAttemptsPrimary = 2,
    maxAttemptsFallback = 1,
    skipBackoffOnAbort = false,
    deadlineMs = null,
    minMsBeforeAttempt = 1500
  } = options;

  const modelsToTry = [primaryModel];
  if (primaryModel !== STABLE_FALLBACK_MODEL) {
    modelsToTry.push(STABLE_FALLBACK_MODEL);
  }

  let lastErr = null;

  for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
    const currentModel = modelsToTry[modelIndex];
    const attempts = modelIndex === 0 ? maxAttemptsPrimary : maxAttemptsFallback;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (remainingMs(deadlineMs) < minMsBeforeAttempt) {
        console.error(`${logLabel}: deadline alcanzado, omitiendo intentos restantes`);
        throw lastErr || new Error('Deadline de función alcanzado');
      }

      const request = requestFactory(attempt, remainingMs(deadlineMs));
      const cleanup = request._cleanup;
      delete request._cleanup;

      try {
        const response = await ai.models.generateContent({
          model: currentModel,
          ...request
        });

        if (cleanup) cleanup();

        if (modelIndex > 0) {
          console.log(`${logLabel}: fallback exitoso con ${currentModel} (primary era ${primaryModel})`);
        }

        return { response, modelUsed: currentModel };
      } catch (err) {
        if (cleanup) cleanup();
        lastErr = err;
        const transient = isTransientGeminiError(err);
        const shortMsg = (err?.message || '').slice(0, 220);

        console.error(
          `${logLabel}: intento ${attempt}/${attempts} con ${currentModel} falló` +
          `${transient ? ' (transitorio)' : ''}: ${shortMsg}`
        );

        if (!transient) throw err;

        const isLastOverall = attempt === attempts && modelIndex === modelsToTry.length - 1;
        if (!isLastOverall && !(skipBackoffOnAbort && isAbortError(err))) {
          await new Promise(r => setTimeout(r, backoffDelay(attempt)));
        }
      }
    }
  }

  throw lastErr;
}

function makeTimedRouteRequest(text, timeoutMs = ROUTE_ATTEMPT_TIMEOUT_MS, thinkingLevel = 'HIGH') {
  return (_attempt, budgetMs) => {
    const attemptTimeout = Math.min(timeoutMs, budgetMs || timeoutMs);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), attemptTimeout);

    return {
      contents: [{ text }],
      config: {
        tools: [{ googleSearch: {} }],
        // Thinking High en grounding (search + reglas): la verify-fill razona sobre
        // los resultados de busqueda. Requiere ROUTE_ATTEMPT_TIMEOUT_MS subido (sino corta a 5s).
        // El Paso 1 (extraccion de ruta) pasa LOW: es extraccion simple y su budget
        // le roba tiempo al analisis JSON, que es el que necesita HIGH.
        thinkingConfig: { thinkingLevel },
        safetySettings: SAFETY_SETTINGS,
        abortSignal: ctrl.signal
      },
      _cleanup: () => clearTimeout(timer)
    };
  };
}

function makeJsonRequest(promptText, thinkingLevel = 'HIGH') {
  return (_attempt, budgetMs) => {
    const request = {
      contents: [{ text: promptText }],
      config: {
        systemInstruction: SYSTEM_REQUIREMENTS,
        responseMimeType: 'application/json',
        temperature: 0.1,
        // Thinking High: gran delta en 3.5-flash-lite para razonamiento con reglas.
        // Tanto aca (analisis JSON) como en el helper de grounding (makeTimedRouteRequest,
        // que tiene su ROUTE_ATTEMPT_TIMEOUT_MS propio para que no corte).
        // El round de rescate (fallback 3.1-flash-lite) pasa LOW: camino de
        // emergencia, prioriza llegar a tiempo sobre profundidad.
        thinkingConfig: { thinkingLevel },
        safetySettings: SAFETY_SETTINGS
      }
    };

    if (budgetMs && budgetMs > 0 && typeof AbortSignal.timeout === 'function') {
      request.config.abortSignal = AbortSignal.timeout(budgetMs);
    }

    return request;
  };
}

async function runRouteSearch(ai, model, text, logLabel, fnStart, stepDeadlineMs, attemptTimeoutMs, thinkingLevel) {
  try {
    const { response } = await generateContentWithRetries(
      ai,
      model,
      makeTimedRouteRequest(text, attemptTimeoutMs, thinkingLevel),
      logLabel,
      {
        maxAttemptsPrimary: 1,
        maxAttemptsFallback: 1,
        skipBackoffOnAbort: true,
        deadlineMs: stepDeadlineMs || (fnStart + ROUTE_STEP_BUDGET_MS),
        minMsBeforeAttempt: (attemptTimeoutMs || ROUTE_ATTEMPT_TIMEOUT_MS) + 300
      }
    );

    return response.text || null;
  } catch (err) {
    console.error(`${logLabel} falló:`, err?.message || err);
    return null;
  }
}

function extractJsonCandidate(raw) {
  let t = (raw || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  if (start === -1) return '';
  const end = t.lastIndexOf('}');
  return end > start ? t.slice(start, end + 1) : t.slice(start);
}

function repairJsonText(text) {
  let t = text.replace(/,\s*([}\]])/g, '$1');
  t = t.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"\\]*(?:\\.[^"\\]*)*"?$/, '');
  t = t.replace(/,\s*$/, '');

  const openBraces = (t.match(/\{/g) || []).length;
  const closeBraces = (t.match(/\}/g) || []).length;
  const openBrackets = (t.match(/\[/g) || []).length;
  const closeBrackets = (t.match(/\]/g) || []).length;

  for (let i = 0; i < openBrackets - closeBrackets; i++) t += ']';
  for (let i = 0; i < openBraces - closeBraces; i++) t += '}';
  return t;
}

function parseTravelJson(raw) {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) return null;

  const attempts = [candidate, repairJsonText(candidate)];
  for (const text of attempts) {
    try {
      const data = JSON.parse(text);
      if (data && typeof data === 'object' && Array.isArray(data.ruta)) {
        return data;
      }
    } catch (_) { /* siguiente intento */ }
  }
  return null;
}

async function analizarRequisitosJSON(ai, primaryModel, promptText, fnStart) {
  const deadlineMs = fnStart + NETLIFY_DEADLINE_MS;
  let modelUsed = primaryModel;
  let lastErr = null;

  for (let round = 0; round < 2; round++) {
    const remaining = remainingMs(deadlineMs);
    if (remaining < 5000) break;

    const prompt = round === 0 ? promptText : `${promptText}${JSON_RETRY_SUFFIX}`;
    const roundModel = round === 0 ? primaryModel : STABLE_FALLBACK_MODEL;
    const label = round === 0 ? 'gemini-travel: analisisJSON' : 'gemini-travel: analisisJSON:retry';
    // Round 0 (principal, thinking High): su deadline reserva ventana para el
    // round 1 (fallback). Si el principal tarda mas que la ventana, aborta y el
    // fallback tiene tiempo asegurado para completar.
    const roundDeadline = round === 0 ? deadlineMs - ANALYSIS_FALLBACK_RESERVE_MS : deadlineMs;

    try {
      const result = await generateContentWithRetries(
        ai,
        roundModel,
        makeJsonRequest(prompt, round === 0 ? 'HIGH' : 'LOW'),
        label,
        {
          maxAttemptsPrimary: round === 0 && remaining > 14000 ? 2 : 1,
          maxAttemptsFallback: round === 0 && roundModel !== STABLE_FALLBACK_MODEL ? 1 : 0,
          skipBackoffOnAbort: true,
          deadlineMs: roundDeadline,
          minMsBeforeAttempt: 3500
        }
      );

      modelUsed = result.modelUsed;
      const text = result.response.text || '';
      if (!text) {
        lastErr = new Error('Respuesta vacía de Gemini.');
        continue;
      }

      const parsed = parseTravelJson(text);
      if (parsed) return { resultData: parsed, modelUsed };

      lastErr = new Error(`JSON inválido (${text.length} caracteres)`);
      console.error(
        `${label}: parse falló — ${lastErr.message}. ` +
        `Inicio: ${text.slice(0, 160).replace(/\s+/g, ' ')}`
      );
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('No se pudo obtener JSON válido');
}

// ── Paso 2b: verificación web en vivo de requisitos de ingreso ─

// Normaliza texto para comparar nombres/países (mayus, sin acentos, sin puntuacion).
function normReq(s) {
  return (s || '').toString().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// True si un nombre es una visa Schengen de corta estancia (Tipo C / uniforme):
// el modelo la redacta de mil formas ("Visa Schengen", "Visa de corta estancia",
// "Visa tipo C", "visa uniforme") y la verificacion web con otra, lo que dejaba
// dos tarjetas duplicadas del mismo tramite. Se ejecuta sobre normReq (mayus, sin
// acentos, solo alfanum + espacios): el regex va SIN acentos porque normReq ya los
// saco. Excluye transito (Tipo A/B), larga duracion y residencia, que son tramites
// distintos aunque compartan la palabra "visa".
const VISA_SCHENGEN_INCLUDE = /\bschengen\b|corta\s+(estancia|estadia|duracion)|breve\s+(estancia|estadia|duracion)|tipo\s+c\b|categoria\s+c\b|visa\s+c\b|uniforme/i;
const VISA_SCHENGEN_EXCLUDE = /\btransito\b|\btransit\b|airport|aeroportu|tipo\s+a\b|tipo\s+b\b|tipo\s+d\b|categoria\s+(a|b|d)\b|\bnacional\b|\blarga\b|\blargo\b|\bresidencia\b|long\s+stay|\blonga\b|\blongo\b|\bpermanente\b/i;
function isSchengenVisa(name) {
  const n = normReq(name);
  return VISA_SCHENGEN_INCLUDE.test(n) && !VISA_SCHENGEN_EXCLUDE.test(n);
}
// Misma visa Schengen de corta estancia. Conservativo: ante la duda devuelve false
// (dos tarjetas duplicadas es un menor mal que una tarjeta silenciosamente
// sobreescrita con la URL/costo de otra visa distinta).
function sameVisa(a, b) {
  return isSchengenVisa(a) && isSchengenVisa(b);
}

// Extrae y parsea un JSON array desde texto (puede venir con markdown/prosa).
function parseJsonArray(raw) {
  let t = (raw || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  const candidate = t.slice(start, end + 1);
  for (const text of [candidate, repairJsonText(candidate)]) {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) return data;
    } catch (_) { /* siguiente intento */ }
  }
  return null;
}

// Recorre paradas destino/escala, busca en la web los requisitos oficiales
// (URL + costo) y merguea/agrega a la lista que armó el modelo. Graceful.
async function verifyAndFillRequirements(ai, model, resultData, nacionalidad, fnStart, attemptTimeoutMs) {
  const ruta = Array.isArray(resultData.ruta) ? resultData.ruta : [];
  const paradas = ruta.filter(s => s && s.tipo !== 'origen' && (s.pais || s.pais_codigo || s.aeropuerto_iata || s.ciudad));
  if (!paradas.length) return false;

  const deadlineMs = fnStart + NETLIFY_DEADLINE_MS;
  if (remainingMs(deadlineMs) < 7000) return false; // sin tiempo suficiente, saltear

  const lista = paradas.map((s, i) => {
    const donde = s.pais_codigo || s.pais || s.aeropuerto_iata || s.ciudad || `parada ${i + 1}`;
    const tipo = s.tipo === 'parada_tecnica' ? 'parada técnica'
      : s.tipo === 'escala_comercial' ? 'escala comercial'
      : 'destino';
    return `${i + 1}. ${donde} (${tipo})`;
  }).join('\n');

  const text =
    `Nacionalidad/pasaporte del pasajero: ${nacionalidad}\n` +
    `Itinerario (destinos y escalas):\n${lista}\n\n` +
    `REGLAS OBLIGATORIAS:\n` +
    `1. Usá SÍ o SÍ la herramienta de búsqueda web para cada destino antes de responder. Priorizá información vigente a 2026; si hay un cambio reciente, citá la fuente oficial.\n` +
    `2. Distinguí el tipo de cada parada según el identificador entre paréntesis:\n` +
    `   - (parada técnica): no desembarca. Por lo general sin requisitos (salvo normativa de tránsito del país).\n` +
    `   - (escala comercial): desembarca y reconnecta. Verificá también VISA DE TRÁNSITO además de los de ingreso.\n` +
    `   - (destino): requisitos completos de ingreso.\n` +
    `3. Para cada destino buscá los requisitos oficiales vigentes para pasaporte ${nacionalidad}: visa/eVisa/eTA (ESTA, eTA Canadá/AU), formularios online obligatorios (ED Card, PLF, migratorio), tasas de ingreso/sostenibilidad/reciprocidad, vacunas/health (fiebre amarilla si proviene de país endémico).\n` +
    `4. NO inventes requisitos que no apliquen a esa nacionalidad (ej. no pidas visa si hay acuerdo de exención vigente). Si un destino no exige nada accionable, no agregues items para ese destino.\n` +
    `5. "url_oficial": EXCLUSIVAMENTE una URL real de dominio gubernamental/oficial (.gov, .gob, consulares, portales autorizados como vfsevisa.com). PROHIBIDO blogs o intermediarios. Si no verificás el enlace oficial, dejá el campo vacío (no "No disponible", no adivines).\n` +
    `6. "costo_aproximado": valor específico en USD ("USD 20") o "Gratuito". Si varía por edad/estadía, aclaralo en una palabra.\n` +
    `7. "anticipacion_recomendada": plazo concreto ("mín. 72hs antes", "a la llegada"). Nada de "con anticipación" a secas.\n` +
    `8. "pais": usá el mismo identificador que te pasé en el itinerario para ese destino (código IATA o ISO).\n\n` +
    `Devolvé SOLO un JSON array válido, texto plano crudo (sin markdown, sin fences), un item por requisito:\n` +
    `[{"pais":"...","categoria":"...","nombre":"...","obligatorio":true,"url_oficial":"https://...","costo_aproximado":"USD 20","anticipacion_recomendada":"..."}]`;

  let response;
  try {
    // Paso 2b: deadline completo (no el budget del Paso 1, que ya se vencio).
    response = await runRouteSearch(ai, model, text, 'gemini-travel: verifyReqs', fnStart, fnStart + NETLIFY_DEADLINE_MS, attemptTimeoutMs);
  } catch (err) {
    console.error('verifyAndFillRequirements: búsqueda falló:', err?.message || err);
    return false;
  }
  if (!response) return false;

  const arr = parseJsonArray(response);
  if (!Array.isArray(arr) || !arr.length) return false;

  for (const stop of paradas) {
    const stopKeys = [stop.pais_codigo, stop.pais, stop.aeropuerto_iata, stop.ciudad]
      .map(normReq).filter(k => k && k.length >= 2);
    if (!stopKeys.length) continue;
    const webReqs = arr.filter(x => {
      const wp = normReq(x && x.pais ? x.pais : '');
      if (!wp) return false;
      return stopKeys.some(k => wp.includes(k) || k.includes(wp));
    });
    if (!webReqs.length) continue;
    if (!Array.isArray(stop.requisitos)) stop.requisitos = [];

    for (const wr of webReqs) {
      const wrName = normReq(wr.nombre || '');
      if (!wrName) continue;
      const existing = stop.requisitos.find(r => {
        const rName = normReq(r.nombre || '');
        if (!rName) return false;
        // Mismo tramite si un nombre contiene al otro (caso general) o si ambos son
        // la misma visa Schengen de corta estancia, que el modelo y la verificacion
        // web suelen nombrar distinto ("Visa Schengen (Tipo C)" vs "Visa de corta
        // estancia (Tipo C)"). Sin sameVisa quedaban dos tarjetas duplicadas.
        return rName.includes(wrName) || wrName.includes(rName) || sameVisa(r.nombre, wr.nombre);
      });
      if (existing) {
        // Si mergueamos por sameVisa (misma visa Schengen-equivalente), la URL
        // verificada en vivo gana siempre: exteriores.gob.es > BLS hallucinada.
        // Para match por substring suelto, conservador: solo llenar si estaba vacia
        // (no sobreescribir una URL correcta del modelo con otra distinta).
        if (sameVisa(existing.nombre, wr.nombre) && wr.url_oficial) {
          existing.url_oficial = wr.url_oficial;
        } else if (!existing.url_oficial && wr.url_oficial) {
          existing.url_oficial = wr.url_oficial;
        }
        if (!existing.costo_aproximado && wr.costo_aproximado) existing.costo_aproximado = wr.costo_aproximado;
        if (!existing.anticipacion_recomendada && wr.anticipacion_recomendada) existing.anticipacion_recomendada = wr.anticipacion_recomendada;
        existing.verificado_web = true;
      } else {
        // Requisito omitido por el modelo → agregar.
        stop.requisitos.push({
          categoria: wr.categoria || 'otro',
          nombre: wr.nombre,
          obligatorio: wr.obligatorio !== false,
          descripcion: wr.descripcion || '',
          costo_aproximado: wr.costo_aproximado || '',
          anticipacion_recomendada: wr.anticipacion_recomendada || '',
          url_oficial: wr.url_oficial || '',
          verificado_web: true,
          nota_fuentes: 'Agregado por verificación web en vivo.'
        });
      }
    }
  }
  return true;
}

// ── Formularios/tasas conocidos por pais (extraidos del Excel verificado) ──
// Se inyectan deterministamente si el destino esta en la ruta y no
// aparecieron en la lista que armo Gemini (no depende de la IA ni
// de la verificacion web, que puede saltearse por timeout).
// Fuente unica de PAISES_CONOCIDOS/ALERTAS_CONOCIDAS: docs/conocidos.json ->
// js/conocidos.mjs (generado por scripts/gen-conocidos.mjs). El require de un
// modulo ESM desde este CJS lo resuelve esbuild al bundlear la function.
const { PAISES_CONOCIDOS, ALERTAS_CONOCIDAS } = require('../../../../public/js/requisitos/conocidos.mjs');
const { injectMatrizVisas, injectMatrizSanidad, fillKnownUrls } = require('../../../../lib/requisitos/travel-matriz.mjs');
const { flagUnverifiedRoute } = require('../../../../public/js/requisitos/travel-reqs.mjs');

function matchPaisStop(stop, p) {
  const code = normReq(stop.pais_codigo);
  const nombre = normReq(stop.pais);
  const iata = (stop.aeropuerto_iata || '').toUpperCase();
  if (code && p.iso3.includes(code)) return true;
  if (nombre && p.nombres.includes(nombre)) return true;
  if (iata && p.iatas.includes(iata)) return true;
  return false;
}

function sameAsReq(req, r) {
  const re = req.sameAs;
  if (!re) return false;
  return re.test((r && r.nombre) || '') || re.test((r && r.url_oficial) || '');
}

function injectKnownForms(resultData, nacionalidad = 'ARG') {
  // Guard por requisito (fix fino): los reqs marcados solo_arg:false son universales
  // (aplican a toda nacionalidad, ej ED Card, C5, e-Ticket, Air Suvidha). El resto
  // es argentino-especifico (default solo_arg:true) y solo se inyecta para argentinos,
  // para no sobrescribir el output de Gemini (que es nationality-aware).
  const isArg = /\bARG\b|ARGENTIN[AO]/i.test(nacionalidad);
  const ruta = Array.isArray(resultData.ruta) ? resultData.ruta : [];
  const paradas = ruta.filter(s => s && (s.tipo === 'destino' || s.tipo === 'escala_comercial'));
  // ETIAS no esta vigente (ago 2026): no es requisito para ninguna nacionalidad.
  // Se saca antes del loop de correctores para que no llegue a la UI. El corrector
  // argentino lo tapaba con "Argentina exenta"; los no-argentinos quedaban expuestos.
  for (const stop of paradas) {
    if (Array.isArray(stop.requisitos)) {
      stop.requisitos = stop.requisitos.filter(r => !/\betias\b|sistema europeo de informaci[oó]n y autorizaci[oó]n/i.test((r && r.nombre) || ''));
    }
  }
  let agregados = 0;
  for (const stop of paradas) {
    if (!Array.isArray(stop.requisitos)) stop.requisitos = [];
    for (const p of PAISES_CONOCIDOS) {
      if (!matchPaisStop(stop, p)) continue;
      for (const req of p.reqs) {
        if (!isArg && req.solo_arg !== false) continue;
        if (req.solo_escala && stop.tipo !== 'escala_comercial') continue;
        if (Array.isArray(req.iatas) && req.iatas.length) {
          const iata = String(stop.aeropuerto_iata || '').toUpperCase();
          if (!iata || !req.iatas.map(x => String(x).toUpperCase()).includes(iata)) continue;
        }
        stop.requisitos = stop.requisitos.filter(r => !sameAsReq(req, r));
        stop.requisitos.push({ ...req, verificado_web: true, nota_fuentes: req.nota_fuentes || 'Formulario oficial conocido (unificado).' });
        agregados++;
      }
    }
    // Misma URL oficial = mismo tramite (cubre destinos sin regla propia).
    const seenUrl = new Map();
    const deduped = [];
    for (const r of stop.requisitos) {
      const url = (r && r.url_oficial || '').toString().trim().toLowerCase()
        .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').split('?')[0];
      if (!url) { deduped.push(r); continue; }
      const prev = seenUrl.get(url);
      if (prev === undefined) { seenUrl.set(url, deduped.length); deduped.push(r); }
    }
    stop.requisitos = deduped;
  }
  return resultData;
}

// Alertas criticas conocidas: advertencias generales (sin URL/precio) que el modelo
// no conoce o omite y se inyectan deterministicamente. Van al array flight-level
// data.alertas_criticas (panel ALERTAS CRITICAS en la UI). Distinto de
// PAISES_CONOCIDOS: esas son tarjetas de requisito accionables con url_oficial/costo.

function injectKnownAlerts(resultData, nacionalidad = 'ARG') {
  const isArg = /\bARG\b|ARGENTIN[AO]/i.test(nacionalidad);
  const ruta = Array.isArray(resultData && resultData.ruta) ? resultData.ruta : [];
  const paradas = ruta.filter(s => s && (s.tipo === 'destino' || s.tipo === 'escala_comercial'));
  if (!Array.isArray(resultData.alertas_criticas)) resultData.alertas_criticas = [];
  for (const a of ALERTAS_CONOCIDAS) {
    if (a.solo_arg && !isArg) continue;
    if (!paradas.some(stop => matchPaisStop(stop, a))) continue;
    if (resultData.alertas_criticas.some(x => a.dedup.test(String(x)))) continue; // no duplicar
    resultData.alertas_criticas.push(a.texto);
  }
  return resultData;
}

// ── Paso 1A: buscar ruta de UN vuelo en Google ────────────────

// El Paso 1 responde con un contrato de texto plano. "PARADAS: VERIFICADAS"
// (citando fuente) habilita confianza alta; "NO VERIFICADAS" o búsqueda caída
// desactivan la verificación y el handler marca la ruta como no confiable.
const PARADAS_VERIFICADAS_RE = /PARADAS:\s*(?!NO\s+)(?:VERIFICADAS|CONFIRMADAS)/i;

async function buscarRutaVuelo(apiKey, model, vuelo, origen, destino, fnStart) {
  const ai = new GoogleGenAI({ apiKey });
  const text =
    `Buscá la ruta física REAL del vuelo ${vuelo}` +
    (origen  ? ` con origen ${origen}`  : '') +
    (destino ? ` y destino ${destino}`  : '') +
    `.\n` +
    `Hacé MÁS DE UNA búsqueda web antes de responder:\n` +
    `1) "${vuelo}" solo.\n` +
    (origen && destino
      ? `2) "${vuelo} ${origen} ${destino}" y "${vuelo} ${origen} ${destino} escala".\n`
      : `2) "${vuelo} ruta" y "${vuelo} escala".\n`) +
    `3) Sitios que publican la ruta física completa: probá "site:flightsfrom.com ${vuelo}", "site:flightaware.com ${vuelo}" y el vuelo inverso (mismo número, dígito final +-1).\n` +
    `REGLAS:\n` +
    `- Un mismo número de vuelo puede aterrizar en aeropuertos intermedios (parada técnica o escala) aunque se venda como un solo tramo.\n` +
    `- Si Google Flights muestra "Escala de X min en <ciudad>" bajo el MISMO número de vuelo, esa escala es un aterrizaje físico real y DEBE figurar en la ruta.\n` +
    `- EVIDENCIA PARCIAL VÁLIDA: si el número de vuelo aparece operando un tramo intermedio (ej: ASU-AEP) en un tracker o OTA, el avión SÍ aterriza en ese aeropuerto intermedio: incluílo en la RUTA y citá esa fuente.\n` +
    `- Si después de todas las búsquedas NO encontraste ninguna información sobre paradas intermedias, NO afirmes que el vuelo es directo: marcá NO VERIFICADAS.\n` +
    `Devolvé SOLO estas líneas:\n` +
    `AEROLÍNEA: <operadora>\n` +
    `RUTA: <IATA1> → <IATA2> → ... (TODOS los aterrizajes físicos en orden)\n` +
    `PARADAS: VERIFICADAS o NO VERIFICADAS. Solo podés escribir VERIFICADAS si en DETALLE citás la fuente concreta (sitio/URL) que confirma la ruta o una parada intermedia; sin fuente citada es NO VERIFICADAS.\n` +
    `DETALLE: <una línea: paradas técnicas vs escalas comerciales + la fuente que confirma la ruta (si hay)>\n` +
    `NOTA: MU746 y MU745 pasan por Auckland (AKL).\n` +
    `No analices visas, vacunas ni requisitos migratorios.`;

  return runRouteSearch(ai, model, text, 'gemini-travel: buscarRutaVuelo', fnStart, undefined, undefined, 'LOW');
}

// ── Paso 1B: buscar paradas técnicas de un itinerario GDS ─────

async function buscarRutaItinerario(apiKey, model, segmentos, fnStart) {
  const ai = new GoogleGenAI({ apiKey });

  const lista = segmentos.map((s, i) =>
    `Tramo ${i + 1}: ${s.vuelo} de ${s.origen} a ${s.destino}${s.fecha ? ` (${s.fecha})` : ''}`
  ).join('\n');

  const text =
    `Itinerario GDS Amadeus:\n${lista}\n\n` +
    `Buscá la ruta física REAL de cada tramo. Hacé MÁS DE UNA búsqueda web por tramo:\n` +
    `1) El número de vuelo solo.\n` +
    `2) "<vuelo> <origen> <destino>" y "<vuelo> <origen> <destino> escala".\n` +
    `3) Sitios que publican la ruta física completa: "site:flightsfrom.com <vuelo>", "site:flightaware.com <vuelo>" y el vuelo inverso (mismo número, dígito final +-1).\n` +
    `REGLAS:\n` +
    `- Un mismo número de vuelo puede aterrizar en aeropuertos intermedios (parada técnica o escala) aunque el GDS lo venda como un solo tramo.\n` +
    `- Si Google Flights muestra "Escala de X min en <ciudad>" bajo el MISMO número de vuelo, esa escala es un aterrizaje físico real y DEBE figurar en la ruta.\n` +
    `- EVIDENCIA PARCIAL VÁLIDA: si el número de vuelo aparece operando un tramo intermedio en un tracker o OTA, el avión SÍ aterriza ahí: incluílo en la RUTA y citá esa fuente.\n` +
    `- Si NO encontraste información sobre paradas intermedias de un tramo, NO afirmes que es directo: marcá NO VERIFICADAS.\n` +
    `Devolvé SOLO estas líneas:\n` +
    `AEROLÍNEA: <operadora(s)>\n` +
    `RUTA: <IATA1> → <IATA2> → ... (TODOS los aterrizajes físicos de TODO el itinerario, en orden)\n` +
    `PARADAS: VERIFICADAS o NO VERIFICADAS. Solo podés escribir VERIFICADAS si en DETALLE citás la fuente concreta (sitio/URL) que confirma la ruta o una parada intermedia; sin fuente citada es NO VERIFICADAS.\n` +
    `DETALLE: <una línea: paradas técnicas vs escalas comerciales + la fuente que confirma la ruta (si hay)>\n` +
    `NOTA: MU746 y MU745 pasan por Auckland (AKL).\n` +
    `No analices visas ni vacunas.`;

  return runRouteSearch(ai, model, text, 'gemini-travel: buscarRutaItinerario', fnStart, undefined, undefined, 'LOW');
}

// ── Destinos con tasas/formularios que Gemini suele omitir ─────

const REGLAS_DESTINOS_GENERICAS = `
REGLAS DE DESTINOS Y FORMULARIOS (genérico, sin datos por país):
- Por CADA parada donde el avión aterriza, revisá TODAS estas categorías y agregá las que apliquen: visa / eVisa / eTA / visa_transito, PLF o ED Card o formulario migratorio online, tasa de ingreso o sostenibilidad, vacuna / medicacion / seguro_medico / declaracion_salud.
- TODO trámite, formulario o tasa obligatoria de ingreso DEBE ir como requisito (no en alertas_criticas) con url_oficial y costo_aproximado. Si no conocés la URL exacta, dejá url_oficial vacío (se completa después con búsqueda web).
- Exponé los precios siempre en USD.
`;

// ── Paso 2A: prompt de requisitos para UN vuelo ───────────────

function buildPromptVuelo({ vuelo, rutaDescripcion, nacionalidad, soloNumeroVuelo }) {
  return `Analizá los requisitos de viaje para este vuelo y devolvé ÚNICAMENTE un JSON.

VUELO: ${vuelo}
NACIONALIDAD DEL PASAJERO: ${nacionalidad}

RUTA VERIFICADA (incluye paradas técnicas y estado actual de visas):
${rutaDescripcion}

INSTRUCCIONES CRÍTICAS:
${soloNumeroVuelo ? '0. SIN ORIGEN/DESTINO INFORMADOS: primero determiná aerolínea, origen, destino y paradas del vuelo ' + vuelo + ' usando horarios publicados; luego analizá requisitos. Marcá confianza_ruta "media" o "baja" si inferís la ruta.\n' : ''}1. Incluí TODOS los aeropuertos físicos donde el avión aterriza: TODA parada o escala que figure en la RUTA VERIFICADA (técnica o comercial) DEBE aparecer en "ruta", aunque parezca un vuelo directo.
2. Las paradas técnicas exigen cumplir normativa migratoria aunque el pasajero no desembarque.
${REGLAS_DESTINOS_GENERICAS}
3. ACUERDOS DE VISA VIGENTES 2024-2025 (usá esta información actualizada):
   - China: eliminó el requisito de visa para ciudadanos argentinos desde diciembre 2023 (hasta 15 días turismo/negocios). Si el pasajero es argentino, libre_ingreso:true para China.
   - Nueva Zelanda: requiere NZeTA (autorización electrónica online). Marcá alerta:true, categoria "eTA", url_oficial "https://www.immigration.govt.nz/new-zealand-visas/visas/visa/nzeta", costo_aproximado "~USD 35 (eTA NZD 23 + IVL NZD 35)".
   - Brasil: desde abril 2025 exige eVisa a ciudadanos de EE.UU., Canadá y Australia (NO a argentinos, europeos o sudamericanos). Si el pasajero es de esos países, marcá eVisa obligatoria (categoria "eVisa"). No marcar libre_ingreso para esos pasaportes.
   - Jamaica: exige el Formulario C5 (Declaración Electrónica de Inmigración y Aduanas) online obligatorio para todo pasajero que ingresa a la isla. categoria "PLF", nombre "Formulario C5 (Declaración de Inmigración y Aduanas)", obligatorio:true, url_oficial "https://www.enterjamaica.gov.jm/", costo_aproximado "Gratuito", anticipacion_recomendada "mín. 72hs antes".
   - Verificá otros países con tu conocimiento más reciente disponible.
4. PRECIOS: expresá SIEMPRE el costo_aproximado en USD, convirtiendo desde la moneda local si es necesario. Usá "~USD XX" para valores aproximados, "USD XX" para valores exactos, o "Gratuito".
5. SALUD Y VACUNAS: para cada parada incluí también, dentro del array "requisitos", los ítems sanitarios usando categoria "vacuna", "medicacion", "seguro_medico" o "declaracion_salud". Considerá la nacionalidad ${nacionalidad} y el país de origen del vuelo: una vacuna recomendada puede pasar a OBLIGATORIA si el pasajero proviene de país endémico (caso típico: fiebre amarilla). Si la vacuna aplica por el origen, llená el campo "motivo_origen" (ej: "Requerido por venir de Brasil").
6. FUENTES OFICIALES (PRIORIDAD): para vacunas/salud, comparar OMS/CDC con la fuente oficial del país de destino (ministerio de salud, turismo o embajada). Si difieren, PREVALECE la fuente oficial del país. Usá esa URL en "url_oficial" y explicá la discrepancia en "nota_fuentes" (ej: "OMS exige fiebre amarilla, pero el Ministerio de Salud de Sudáfrica exime a argentinos desde 2019 — fuente: embajada de Sudáfrica").
7. obligatorio:true SOLO si el país lo exige por regulación; si es recomendación sanitaria, obligatorio:false.
8. REGLA CRÍTICA — alertas vs requisitos: TODO trámite, formulario, declaración o documento accionable (ej: ED Card, PLF, eTA, formulario migratorio, seguro obligatorio) DEBE aparecer como tarjeta dentro de "requisitos" del país correspondiente, con su "url_oficial", "costo_aproximado" y "anticipacion_recomendada" completos. El array "alertas_criticas" es SOLO para advertencias generales sin URL/precio (ej: "Llevar pasaporte con 6 meses de vigencia", "Verificar restricciones de equipaje"). NUNCA pongas en alertas_criticas algo que tiene URL o precio: convertilo en requisito.
9. JSON COMPACTO: descripciones breves, máximo 5 requisitos por parada, sin campos opcionales vacíos.

${ESQUEMA_JSON}`;
}

// ── Paso 2B: prompt de requisitos para ITINERARIO GDS ─────────

function buildPromptItinerario({ segmentos, rutaDescripcion, nacionalidad }) {
  const lista = segmentos.map((s, i) =>
    `Tramo ${i + 1}: ${s.vuelo} (${s.origen} → ${s.destino})`
  ).join('\n');

  return `Analizá los requisitos de viaje para este itinerario completo y devolvé ÚNICAMENTE un JSON.

ITINERARIO COMPLETO (extraído del GDS Amadeus):
${lista}

NACIONALIDAD DEL PASAJERO: ${nacionalidad}

RUTA VERIFICADA (incluye paradas técnicas y estado actual de visas):
${rutaDescripcion}

INSTRUCCIONES CRÍTICAS:
1. Incluí TODOS los aeropuertos físicos donde el avión aterriza en TODO el itinerario:
   TODA parada o escala que figure en la RUTA VERIFICADA (técnica o comercial) DEBE aparecer en "ruta", aunque el tramo parezca directo.
2. Las paradas técnicas requieren cumplir normativa migratoria aunque el pasajero no desembarque.
${REGLAS_DESTINOS_GENERICAS}
3. ACUERDOS DE VISA VIGENTES 2024-2025 (usá esta información actualizada):
   - China: eliminó el requisito de visa para ciudadanos argentinos desde diciembre 2023 (hasta 15 días turismo/negocios). Si el pasajero es argentino, libre_ingreso:true para China.
   - Nueva Zelanda: requiere NZeTA (autorización electrónica online). Marcá alerta:true, categoria "eTA", url_oficial "https://www.immigration.govt.nz/new-zealand-visas/visas/visa/nzeta", costo_aproximado "~USD 35 (eTA NZD 23 + IVL NZD 35)".
   - Brasil: desde abril 2025 exige eVisa a ciudadanos de EE.UU., Canadá y Australia (NO a argentinos, europeos o sudamericanos). Si el pasajero es de esos países, marcá eVisa obligatoria (categoria "eVisa"). No marcar libre_ingreso para esos pasaportes.
   - Jamaica: exige el Formulario C5 (Declaración Electrónica de Inmigración y Aduanas) online obligatorio para todo pasajero que ingresa a la isla. categoria "PLF", nombre "Formulario C5 (Declaración de Inmigración y Aduanas)", obligatorio:true, url_oficial "https://www.enterjamaica.gov.jm/", costo_aproximado "Gratuito", anticipacion_recomendada "mín. 72hs antes".
   - Verificá otros países con tu conocimiento más reciente disponible.
4. PRECIOS: expresá SIEMPRE el costo_aproximado en USD, convirtiendo desde la moneda local si es necesario. Usá "~USD XX" para valores aproximados, "USD XX" para valores exactos, o "Gratuito".
5. En el campo "vuelo.numero" usá el itinerario completo (ej: "MU746 + MU5325 + MU5318 + MU745").
6. SALUD Y VACUNAS: para cada parada incluí también, dentro del array "requisitos", los ítems sanitarios usando categoria "vacuna", "medicacion", "seguro_medico" o "declaracion_salud". Considerá la nacionalidad ${nacionalidad} Y las paradas previas del itinerario: una vacuna recomendada pasa a OBLIGATORIA si el pasajero viene de país endémico (ej: fiebre amarilla obligatoria al entrar a Sudáfrica si pasó por Brasil). Si la vacuna aplica por el origen o escala previa, completá "motivo_origen" (ej: "Requerido por venir de Brasil").
7. FUENTES OFICIALES (PRIORIDAD): para vacunas/salud, comparar OMS/CDC con la fuente oficial del país de destino (ministerio de salud, turismo o embajada). Si difieren, PREVALECE la fuente oficial del país. Usá esa URL en "url_oficial" y explicá la discrepancia en "nota_fuentes" (ej: "OMS exige fiebre amarilla, pero el Ministerio de Salud de Sudáfrica exime a argentinos desde 2019 — fuente: embajada de Sudáfrica").
8. obligatorio:true SOLO si el país lo exige por regulación; si es recomendación sanitaria, obligatorio:false.
9. REGLA CRÍTICA — alertas vs requisitos: TODO trámite, formulario, declaración o documento accionable (ej: ED Card, PLF, eTA, formulario migratorio, seguro obligatorio) DEBE aparecer como tarjeta dentro de "requisitos" del país correspondiente, con su "url_oficial", "costo_aproximado" y "anticipacion_recomendada" completos. El array "alertas_criticas" es SOLO para advertencias generales sin URL/precio (ej: "Llevar pasaporte con 6 meses de vigencia", "Verificar restricciones de equipaje"). NUNCA pongas en alertas_criticas algo que tiene URL o precio: convertilo en requisito.
10. JSON COMPACTO: descripciones breves, máximo 5 requisitos por parada, sin campos opcionales vacíos.

${ESQUEMA_JSON}`;
}

// ── Esquema JSON compartido ───────────────────────────────────

const ESQUEMA_JSON = `Devolvé ÚNICAMENTE este JSON:

{
  "vuelo": {
    "numero": "número de vuelo o itinerario completo",
    "aerolinea": "nombre completo de la aerolínea",
    "origen_iata": "IATA del primer punto",
    "origen_ciudad": "ciudad y país",
    "destino_iata": "IATA del último punto",
    "destino_ciudad": "ciudad y país",
    "duracion_aproximada": "duración total estimada",
    "confianza_ruta": "alta",
    "nota_ruta": "Ruta verificada con información actualizada de fuentes oficiales"
  },
  "ruta": [
    {
      "orden": 1,
      "pais": "nombre del país en español",
      "pais_codigo": "ISO alpha-3 (ARG, NZL, CHN, etc.)",
      "ciudad": "nombre de la ciudad",
      "aeropuerto_iata": "código IATA",
      "aeropuerto_nombre": "nombre del aeropuerto",
      "tipo": "origen|destino|escala_comercial|parada_tecnica",
      "alerta": true,
      "libre_ingreso": false,
      "requisitos": [
        {
          "categoria": "visa|eVisa|eTA|visa_transito|vacuna|medicacion|PLF|seguro_medico|declaracion_salud|otro",
          "nombre": "nombre oficial del requisito",
          "obligatorio": true,
          "descripcion": "descripción práctica para el agente de viajes",
          "costo_aproximado": "siempre en USD (ej: USD 21, ~USD 35, Gratuito)",
          "anticipacion_recomendada": "cuánto antes tramitarlo",
          "url_oficial": "URL https:// completa (priorizar fuente oficial del país: ministerio, embajada, turismo) o vacío",
          "motivo_origen": "opcional: completar solo si la obligatoriedad/recomendación depende del país de origen o escala previa (ej: 'Requerido por venir de Brasil')",
          "nota_fuentes": "opcional: completar solo si OMS/CDC y la fuente oficial del país difieren, citando ambas (ej: 'OMS exige fiebre amarilla, pero el Ministerio de Salud de Sudáfrica exime a argentinos desde 2019 — fuente: embajada de Sudáfrica')"
        }
      ],
      "notas": "observaciones importantes para este tramo"
    }
  ],
  "alertas_criticas": [
    "advertencia 1 — redactada para comunicar directamente al pasajero"
  ],
  "recomendacion_verificacion": "cómo verificar (TIMATIC, aerolínea, consulado)"
}`;

const SYSTEM_REQUIREMENTS =
  'Sos un experto en requisitos migratorios y de salud para pasajeros aéreos internacionales. ' +
  'Analizás rutas de vuelo y determinás qué necesita un pasajero según su nacionalidad en cada ' +
  'punto donde el avión aterriza (incluyendo paradas técnicas). ' +
  'Respondés SIEMPRE con JSON válido, sin markdown, sin texto adicional.';

// ── Cache de resultados (colección global travelCache) ────────
// Los requisitos de una ruta no cambian día a día: una consulta repetida
// (misma ruta + nacionalidad, de CUALQUIER agencia) se sirve del cache sin
// gastar tokens de Gemini. Invisible para el usuario: mismos datos, mismo
// render, solo más rápido.
//   - Análisis: clave = vuelo/origen/destino (o segmentos) + nacionalidad.
//     La fecha NO entra en la clave: el análisis no depende de la fecha.
//   - Verificación: clave = firma de la ruta (iatas+tipos) + nacionalidad;
//     aislada por agencia y contenido completo recibido, incluidos segmentos.
// Solo se cachea lo confiable: análisis con paradas verificadas y
// verificaciones web exitosas (si falló, la próxima consulta reintenta en
// vivo y puede mejorar). Best-effort: un fallo de Firestore no rompe nada.
// TTL configurable con TRAVEL_CACHE_TTL_DAYS (default 30).
const CACHE_TTL_MS = (Number(process.env.TRAVEL_CACHE_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000;

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

function cacheKeyAnalisis(payload, modoGDS) {
  const nacionalidad = sanitize(payload.nacionalidad).toUpperCase();
  if (modoGDS) {
    const seg = (payload.segmentos || []).map(s =>
      `${sanitize(s.vuelo).toUpperCase()}-${sanitize(s.origen).toUpperCase()}-${sanitize(s.destino).toUpperCase()}`
    ).join('_');
    return `v1it_${seg}_${nacionalidad}`;
  }
  const vuelo   = sanitize(payload.vuelo).toUpperCase();
  const origen  = sanitize(payload.origen).toUpperCase();
  const destino = sanitize(payload.destino).toUpperCase();
  return `v1_${vuelo}_${origen}_${destino}_${nacionalidad}`;
}

function cacheKeyVerificacion(ruta, nacionalidad, agencyId, segmentos = []) {
  const firma = createHash('sha256').update(JSON.stringify({ ruta, nacionalidad: sanitize(nacionalidad).toUpperCase(), segmentos })).digest('hex');
  return `v2ver_${agencyId}_${firma}`;
}

// Devuelve el data cacheado si existe y no venció; null ante cualquier fallo.
async function cacheRead(key) {
  try {
    const ref = admin.firestore().collection('travelCache').doc(key);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const doc = snap.data() || {};
    if (!doc.data || !doc.expiresAt || Date.now() > doc.expiresAt.toMillis()) return null;
    // Contador de hits (best-effort): alimenta la decisión de qué rutas
    // conviene promover a conocidos.json.
    ref.update({ hits: FieldValue.increment(1) }).catch(() => {});
    return doc.data;
  } catch (err) {
    console.warn(`gemini-travel: cache read falló (key=${key}):`, err?.message || err);
    return null;
  }
}

// Escribe el resultado (best-effort: un fallo no rompe la respuesta).
async function cacheWrite(key, data, extra = {}) {
  try {
    await admin.firestore().collection('travelCache').doc(key).set({
      data,
      hits: 0,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
      ...extra
    });
  } catch (err) {
    console.warn(`gemini-travel: cache write falló (key=${key}):`, err?.message || err);
  }
}

// ── Handler principal ─────────────────────────────────────────

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method Not Allowed' });
  }
  if ((event.body || '').length > 16384) {
    // 16KB: la fase verificacion manda la ruta completa (con requisitos) para
    // que el dedup contra lo que armo el modelo funcione en el backend.
    return reply(413, { error: 'Payload demasiado grande.' });
  }

  // Validar sesión de Firebase Auth + whitelist
  const auth = await verifyAuth(event);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  console.log(`gemini-travel: agencyId=${auth.agencyId} uid=${auth.uid}`);

  const apiKey = process.env.GEMINI_API_KEY;
  // Modelo aislado de gemini-scan: gemini-travel usa GEMINI_TRAVEL_MODEL (default
  // gemini-3.5-flash-lite, thinking High en el análisis JSON). No lee GEMINI_MODEL,
  // así no hereda el 3.1-flash-lite que Netlify setea para el OCR de gemini-scan.
  const model  = process.env.GEMINI_TRAVEL_MODEL || 'gemini-3.5-flash-lite';

  if (!apiKey) {
    return reply(500, { error: 'GEMINI_API_KEY no está configurada en Netlify.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    console.error('gemini-travel: JSON body inválido:', err?.message || err);
    return reply(400, { error: 'Body inválido (JSON requerido).' });
  }

  const nacionalidad = sanitize(payload.nacionalidad);
  if (!nacionalidad) return reply(400, { error: 'La nacionalidad es obligatoria.' });

  // Fase (split en 2 llamadas): 'analisis' arma ruta + requisitos base;
  // 'verificacion' corre el Paso 2b con presupuesto propio de 26s. Sin fase
  // (clientes viejos) corre todo en una sola llamada como antes.
  const fase = sanitize(payload.fase);

  const fnStart = Date.now();

  // ── Fase verificación: solo el Paso 2b (verificación web en vivo) ──
  // Recibe la ruta que armo la fase analisis (con sus requisitos, para dedup).
  if (fase === 'verificacion') {
    const ruta = Array.isArray(payload.ruta) ? payload.ruta : [];
    if (!ruta.length) return reply(400, { error: 'La ruta es obligatoria en la fase verificación.' });

    // Nunca compartir una verificacion derivada del cliente con otra agencia
    // ni con una consulta de contenido o contexto distintos.
    const vKey = cacheKeyVerificacion(ruta, nacionalidad, auth.agencyId, payload.segmentos || []);
    const cachedV = await cacheRead(vKey);
    if (cachedV) {
      console.log(`gemini-travel: cache hit verificación (key=${vKey})`);
      // La sanidad se inyecta despues del cache: un hit viejo igual recibe la tarjeta.
      injectMatrizSanidad(cachedV, nacionalidad, payload.segmentos);
      fillKnownUrls(cachedV);
      cachedV._meta = { fase: 'verificacion', verificoWeb: true, deCache: true, duracionVerificacionMs: Date.now() - fnStart };
      return reply(200, { data: cachedV });
    }

    const resultData = { ruta };
    const ai = new GoogleGenAI({ apiKey });
    const verificoWeb = await verifyAndFillRequirements(ai, model, resultData, nacionalidad, fnStart, VERIFY_ATTEMPT_TIMEOUT_MS);

    // Idempotentes (dedup): ya se aplicaron en la fase analisis, re-aplicar es seguro.
    injectKnownForms(resultData, nacionalidad);
    injectKnownAlerts(resultData, nacionalidad);
    // Pasos 4 y 5: visas y sanidad por nacionalidad, y URLs faltantes desde el Excel.
    injectMatrizVisas(resultData, nacionalidad);
    injectMatrizSanidad(resultData, nacionalidad, payload.segmentos);
    fillKnownUrls(resultData);

    resultData._meta = { fase: 'verificacion', verificoWeb: !!verificoWeb, duracionVerificacionMs: Date.now() - fnStart };
    // Solo se cachea la verificación exitosa (si la web falló, reintenta vivo).
    if (verificoWeb) await cacheWrite(vKey, resultData, { tipo: 'verificacion', nacionalidad: sanitize(nacionalidad) });
    // Sin recordUsage aca: la consulta completa ya se conto en la fase analisis.
    return reply(200, { data: resultData });
  }

  // ── Detectar modo ─────────────────────────────────────────────
  const modoGDS = Array.isArray(payload.segmentos) && payload.segmentos.length > 0;

  // Cache de análisis: consulta repetida (misma ruta + nacionalidad, de
  // cualquier agencia) se sirve sin gastar tokens. Se responde con el data
  // cacheado completo (_meta incluido) y sin recordUsage: costo cero.
  const aKey = cacheKeyAnalisis(payload, modoGDS);
  const cachedA = await cacheRead(aKey);
  if (cachedA) {
    console.log(`gemini-travel: cache hit análisis (key=${aKey})`);
    // La sanidad se inyecta despues del cache: un hit viejo igual recibe la tarjeta.
    injectMatrizSanidad(cachedA, nacionalidad, payload.segmentos);
    fillKnownUrls(cachedA);
    cachedA._meta = { ...(cachedA._meta || {}), deCache: true, duracionMs: Date.now() - fnStart };
    return reply(200, { data: cachedA });
  }

  let vuelo, segmentos, rutaDescripcion, fuenteRuta, usoBusqueda, paradasVerificadas = false;

  if (modoGDS) {
    // Validar y sanitizar segmentos
    segmentos = payload.segmentos.slice(0, 12).map(s => ({
      vuelo:   sanitize(s.vuelo).toUpperCase(),
      origen:  sanitize(s.origen).toUpperCase(),
      destino: sanitize(s.destino).toUpperCase(),
      fecha:   sanitize(s.fecha)
    })).filter(s => s.vuelo && /^[A-Z0-9]{2,3}\d{1,4}$/.test(s.vuelo));

    if (segmentos.length === 0) {
      return reply(400, { error: 'Ningún segmento GDS tiene formato válido (ej: MU746).' });
    }

    vuelo      = segmentos.map(s => s.vuelo).join(' + ');
    fuenteRuta = 'GDS Amadeus (búsqueda web falló)';
    usoBusqueda = false;

    try {
      rutaDescripcion = await buscarRutaItinerario(apiKey, model, segmentos, fnStart);
      if (rutaDescripcion) {
        paradasVerificadas = PARADAS_VERIFICADAS_RE.test(rutaDescripcion);
        fuenteRuta  = paradasVerificadas
          ? 'GDS Amadeus + búsqueda web (paradas técnicas verificadas)'
          : 'GDS Amadeus + búsqueda web (paradas intermedias no verificadas)';
        usoBusqueda = true;
      }
    } catch (err) {
      console.error('gemini-travel: análisis GDS sin ruta web:', err?.message || err);
      rutaDescripcion = null;
    }

    if (!rutaDescripcion) {
      rutaDescripcion = segmentos.map((s, i) =>
        `Tramo ${i + 1}: ${s.vuelo} de ${s.origen} a ${s.destino}${s.fecha ? ` el ${s.fecha}` : ''}`
      ).join('\n') + '\nRuta exacta con paradas técnicas desconocida — inferir por conocimiento de la aerolínea.';
    }

  } else {
    // Modo vuelo individual
    vuelo         = sanitize(payload.vuelo).toUpperCase();
    const origen  = sanitize(payload.origen).toUpperCase();
    const destino = sanitize(payload.destino).toUpperCase();

    if (!vuelo) return reply(400, { error: 'El número de vuelo es obligatorio.' });
    if (!/^[A-Z0-9]{2,3}\d{1,5}$/.test(vuelo)) {
      return reply(400, { error: `Formato inválido: "${vuelo}". Ejemplo: MU746, AR1102, AA100.` });
    }
    if (!origen || !/^[A-Z]{3}$/.test(origen)) {
      return reply(400, { error: 'El origen (IATA de 3 letras) es obligatorio. Ejemplo: EZE.' });
    }
    if (!destino || !/^[A-Z]{3}$/.test(destino)) {
      return reply(400, { error: 'El destino (IATA de 3 letras) es obligatorio. Ejemplo: AUA.' });
    }

    fuenteRuta  = 'Búsqueda web (sin Google Search)';
    usoBusqueda = false;

    try {
      rutaDescripcion = await buscarRutaVuelo(apiKey, model, vuelo, origen, destino, fnStart);
      if (rutaDescripcion) {
        paradasVerificadas = PARADAS_VERIFICADAS_RE.test(rutaDescripcion);
        fuenteRuta  = paradasVerificadas
          ? 'Búsqueda web en tiempo real + análisis'
          : 'Búsqueda web (paradas intermedias no verificadas) + análisis';
        usoBusqueda = true;
      }
    } catch (err) {
      console.error('gemini-travel: análisis de vuelo sin ruta web:', err?.message || err);
      rutaDescripcion = null;
    }

    if (!rutaDescripcion) {
      rutaDescripcion = `Vuelo ${vuelo} de ${origen} a ${destino}. Ruta exacta desconocida — inferir paradas técnicas por conocimiento de la aerolínea.`;
      fuenteRuta = 'Origen/destino informados (sin búsqueda web)';
    }
  }

  // ── Paso 2: análisis JSON de requisitos ───────────────────────
  const promptText = modoGDS
    ? buildPromptItinerario({ segmentos, rutaDescripcion, nacionalidad })
    : buildPromptVuelo({ vuelo, rutaDescripcion, nacionalidad, soloNumeroVuelo: false });

  const step2Remaining = remainingMs(fnStart + NETLIFY_DEADLINE_MS);
  if (step2Remaining < 4000) {
    return reply(502, {
      error: 'La búsqueda de ruta tardó demasiado. Intentá de nuevo en unos segundos.'
    });
  }

  let verificoWeb = false;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const { resultData, modelUsed } = await analizarRequisitosJSON(ai, model, promptText, fnStart);

    // 2b: verificación web en vivo de requisitos (completa URLs + agrega omitidos).
    // Solo en modo 1 llamada (clientes viejos): con el split la hace la fase
    // 'verificacion' con presupuesto propio. Graceful si falla (queda la lista del 2a).
    if (fase !== 'analisis') {
      try {
        verificoWeb = await verifyAndFillRequirements(ai, model, resultData, nacionalidad, fnStart);
      } catch (err) {
        console.error('verifyAndFillRequirements (no rompe):', err?.message || err);
      }
    }

    // 2c: inyección deterministica de formularios conocidos (ej: C5 Jamaica).
    // Garantiza que aparezcan aunque Gemini los omita o la verificación web se saltee.
    // Universales (solo_arg:false) se inyectan para toda nacionalidad; el resto solo argentinos.
    injectKnownForms(resultData, nacionalidad);
    injectKnownAlerts(resultData, nacionalidad);
    // Si el Paso 1 no confirmó las paradas intermedias (NO VERIFICADAS o búsqueda
    // caída), bajar la confianza de la ruta y alertar al agente: nunca presentar
    // como directo un vuelo con paradas sin confirmar.
    if (!paradasVerificadas) flagUnverifiedRoute(resultData);
    const origenDeclarado = modoGDS
      ? (segmentos[0] && segmentos[0].origen)
      : sanitize(payload.origen).toUpperCase();
    if (origenDeclarado) {
      if (!resultData.vuelo || typeof resultData.vuelo !== 'object') resultData.vuelo = {};
      if (!resultData.vuelo.origen_iata) resultData.vuelo.origen_iata = origenDeclarado;
    }
    // Pasos 4 y 5: visas y sanidad por nacionalidad (matrices del Excel) y URLs
    // faltantes. Aqui llenan lo basico; la fase verificacion re-aplica (idempotente).
    injectMatrizVisas(resultData, nacionalidad);
    injectMatrizSanidad(resultData, nacionalidad, modoGDS ? segmentos : undefined);
    fillKnownUrls(resultData);

    resultData._meta = {
      fuenteRuta,
      usoBusquedaWeb: usoBusqueda,
      // Con el split arranca false; el frontend la actualiza tras la fase verificacion.
      verificoWeb,
      modoGDS,
      modeloUsado: modelUsed,
      modeloSolicitado: model,
      duracionMs: Date.now() - fnStart,
      _debugRuta: (Array.isArray(resultData.ruta) ? resultData.ruta : []).map(s => ({
        tipo: s.tipo, iata: s.aeropuerto_iata, pais: s.pais, code: s.pais_codigo,
        reqs: (s.requisitos || []).map(r => r.nombre)
      }))
    };
    // Cache del análisis: solo rutas con paradas VERIFICADAS (si la búsqueda
    // falló o no confirmó, la próxima consulta reintenta en vivo y puede
    // mejorar). Se escribe con el _meta completo para que el render del
    // frontend tenga fuenteRuta etc.
    if (paradasVerificadas) {
      await cacheWrite(aKey, resultData, { tipo: 'analisis', vuelo, nacionalidad: sanitize(nacionalidad), modoGDS });
    }
    await recordUsage({ agencyId: auth.agencyId, kind: 'travel', source: 'gemini' });
    return reply(200, { data: resultData });

  } catch (err) {
    const message = err?.message || err?.toString() || 'error desconocido';
    console.error('gemini-travel: error en llamada JSON final:', message);
    const friendly = /json inválido/i.test(message)
      ? 'Gemini devolvió formato inválido. Intentá de nuevo.'
      : `No se pudo conectar con Gemini: ${message}`;
    return reply(502, { error: friendly });
  }
};

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

exports.handler = require('../../_sentry.cjs').wrapHandler(exports.handler);
