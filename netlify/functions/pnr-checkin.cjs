// ============================================================
//  Netlify Function: pnr-checkin
//  Interpreta un PNR de Amadeus pegado por el agente O uno o varios e-tickets
//  en PDF adjuntados a la vez, y devuelve datos estructurados para crear un
//  check-in:
//    - pasajeros (apellido/nombre/tipo)
//    - piernas del viaje (cada una con su fecha de salida, año inferido)
//    - compania aerea (codigo IATA)
//    - reservaVuelo (codigo de reserva de la aerolinea, ej. KRBJJ
//      de "IB/KRBJJ", distinto del PNR de Amadeus)
//  La IA extrae los segmentos del PNR; el codigo los agrupa en piernas
//  (un check-in por pierna) separando cuando el gap entre la llegada de
//  un segmento y la salida del siguiente es >= 24hs (stopover).
//
//  Variables de entorno en Netlify:
//    GEMINI_API_KEY       — requerida
//    GEMINI_CHECKIN_MODEL — opcional (default gemini-3.5-flash-lite, thinking High).
//      Aislado de GEMINI_MODEL (que usa gemini-scan) para poder tunear el modelo
//      de check-in sin afectar al escaneo de documentos. Mismo patrón que
//      gemini-travel (GEMINI_TRAVEL_MODEL).
// ============================================================

const { verifyAuth } = require('./_auth.cjs');
const { recordUsage } = require('./_usage.cjs');

const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai');

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
];

const NETLIFY_DEADLINE_MS   = 28000;
const STABLE_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

const SYSTEM_PNR =
  'Sos un parser de PNR de Amadeus para una agencia de viajes argentina. ' +
  'Extraes datos de vuelo y pasajeros de texto copiado del GDS y los devolves como JSON estricto. ' +
  'No inventes datos que no esten en el texto. Si un dato no esta, usá null.';

const ESQUEMA_JSON = `Devolvé ÚNICAMENTE este JSON (sin markdown, sin texto extra):
{
  "pnrAmadeus": "ABC123 o null (record locator de 6 chars de Amadeus, si aparece en el texto)",
  "segmentos": [
    { "fecha_salida": "YYYY-MM-DDTHH:mm (hora Argentina, UTC-3)", "fecha_llegada": "YYYY-MM-DDTHH:mm (hora Argentina, UTC-3)", "vuelo": "AA908", "origen": "EZE", "destino": "MIA", "compania": "AA (codigo IATA de 2-3 letras de la aerolinea operadora de ESTE segmento, ej. AA, IB, AR, G3)", "reservaVuelo": "KRBJJ o null (codigo de reserva de la aerolinea de ESTE segmento; ver regla 4)" }
  ],
  "pasajeros": [ { "apellido": "POMBO", "nombre": "DANIEL MARIA", "tipo": "ADT|CHD|INF" } ],
  "notas": "aclaracion corta si algo del PNR no cierra"
}`;

function buildPromptPnr(pnrText, hoy) {
  return `Texto del PNR de Amadeus (copiado del GDS):
"""
${pnrText}
"""

Fecha de hoy (referencia para inferir el año, Argentina): ${hoy}

Reglas de interpretación:
1. PASAJEROS: una linea por pasajero, formato "APELLIDO/NOMBRE [(CHD|INF)]". El primero suele no tener numero de linea. tipo = "ADT" por defecto, "CHD" si tiene (CHD), "INF" si tiene (INF). Separá apellido (antes de la barra) y nombre (después de la barra, sin el sufijo entre parentesis).
2. SEGMENTOS: cada linea de vuelo del PNR (que NO tenga status FLWN) es un segmento. Extraé para cada uno, en orden: "vuelo" (aerolinea+numero, ej. "AA908"), "origen" (IATA), "destino" (IATA), "fecha_salida" y "fecha_llegada". NO agrupes, NO decidas escalas ni ida/vuelta: devolvé un item por cada linea de vuelo, en el orden del PNR. Si una linea tiene status FLWN (ya volado), ignorala por completo.
3. FECHAS: "fecha_salida" y "fecha_llegada" en horario Argentina (America/Argentina/Buenos_Aires, UTC-3). El PNR trae la hora local del aeropuerto; vos sabes la zona horaria por el codigo IATA, asi que convertí esa hora local a hora Argentina. Formato "YYYY-MM-DDTHH:mm" (ej. 0845 local -> 08:45 Argentina, o 2020 HKG -> 09:20 Argentina). Si el PNR no trae hora de llegada, repetí la fecha_salida como fecha_llegada. Inferí el año con la fecha de hoy: usá la próxima ocurrencia de ese ddMMM hacia adelante (si ya pasó este año, usá el año que viene).
4. Por cada segmento: compania = codigo IATA de 2-3 letras de la aerolinea operadora de ese segmento (el prefijo del numero de vuelo, ej. IB, AR, AA, G3). reservaVuelo = lo que va despues de la barra en el sufijo "AEROLINEA/REF" al final de ESA linea de segmento (ej. "IB/KRBJJ" -> "KRBJJ"). Si la linea no trae sufijo /REF, va null. NO propagues el reservaVuelo entre segmentos: cada segmento tiene el suyo o null (la misma aerolinea puede tener distintos codigos de reserva en distintos grupos de vuelos). pnrAmadeus = record locator de 6 caracteres de Amadeus si aparece en el texto (suele estar en el encabezado). Si no aparece, null.

${ESQUEMA_JSON}`;
}

// Prompt agnostico para extraer datos de un e-ticket en PDF (cualquier formato:
// e-ticket HTML, itinerario Amadeus, confirmacion de aerolinea). Devuelve el
// MISMO schema que buildPromptPnr para que groupSegmentos y el frontend lo
// mapeen igual que un PNR pegado. Gemini lee el PDF nativamente (incluidos los
// content-streams comprimidos que un extractor de texto no puede decodificar).
function buildPromptEticket(hoy) {
  return `Documento: e-ticket / itinerario de vuelo en PDF (formato variable).

Fecha de hoy (referencia para inferir el año, Argentina): ${hoy}

Reglas de extracción (el PDF puede tener cualquier formato, pero los datos son siempre los mismos):
1. PASAJEROS: uno por pasajero. Separá apellido y nombre (si vienen tipo "LABAYEN/CRISTINA EDITH", apellido = antes de la barra, nombre = después). tipo "ADT" por defecto, "CHD"/"INF" si lo indica el documento.
2. SEGMENTOS: uno por cada vuelo del itinerario, en orden. Extraé "vuelo" (aerolínea + número, ej. "UX042"), "origen" y "destino" (IATA 3 letras; si solo figura la ciudad, inferí el IATA), "fecha_salida" y "fecha_llegada". NO agrupes ni decidas escalas: un item por cada vuelo, en el orden del itinerario.
3. FECHAS: en horario Argentina (America/Argentina/Buenos_Aires, UTC-3). Los PDFs suelen mostrar la hora local de cada aeropuerto; vos sabes la zona horaria por el código IATA, asi que convertí esa hora local a hora Argentina. Formato "YYYY-MM-DDTHH:mm". Si solo hay fecha sin hora, para "fecha_salida" usá 00:01 y para "fecha_llegada" usá 23:59 (evita un gap exacto de 24h entre tramos conectados que los partiría en dos check-ins). Inferí el año con la fecha de hoy.
4. Por cada segmento: compania = código IATA de 2-3 letras de la aerolínea operadora de ese segmento. reservaVuelo = el localizador / código de reserva de la aerolínea para ESE segmento. Se identifica por etiquetas como "LOCALIZADOR", "Localizador de reserva", "Booking Reference", "Record Locator", "Confirmation", "Reserva", "PNR", "Ref" o "Locator" (alfanumérico de 5-6 chars, ej. AGRZEP, A3MTSF, KRBJJ). Si el documento tiene un ÚNICO localizador compartido por todos los segmentos (lo más común), usalo como reservaVuelo en CADA segmento; si cada segmento trae el suyo, usá el de ese segmento. NUNCA devuelvas null en reservaVuelo si existe algún código de reserva en el documento: si solo hay uno global, replicalo en todos los segmentos. pnrAmadeus = el código principal de reserva / record locator del documento (6 chars si es Amadeus); null si no aparece.

${ESQUEMA_JSON}`;
}

// ── Helpers de Gemini (copiados de gemini-travel.cjs) ─────────

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

function makeJsonRequest(promptText) {
  return (_attempt, budgetMs) => {
    const request = {
      contents: [{ text: promptText }],
      config: {
        systemInstruction: SYSTEM_PNR,
        responseMimeType: 'application/json',
        temperature: 0.1,
        // Thinking High: gran delta en 3.5-flash-lite para razonar las reglas de
        // extraccion (PNR pegado y e-ticket PDF). Mismo patron que gemini-travel;
        // el combo con el fallback gemini-3.1-flash-lite ya esta probado ahi.
        thinkingConfig: { thinkingLevel: 'HIGH' },
        safetySettings: SAFETY_SETTINGS
      }
    };
    if (budgetMs && budgetMs > 0 && typeof AbortSignal.timeout === 'function') {
      request.config.abortSignal = AbortSignal.timeout(budgetMs);
    }
    return request;
  };
}

// Request factory para e-ticket en PDF: el documento va como inlineData
// (Gemini lo lee nativamente) y el prompt como parte de texto.
function makePdfRequest(base64, promptText) {
  return (_attempt, budgetMs) => {
    const request = {
      contents: [{ parts: [
        { inlineData: { mimeType: 'application/pdf', data: base64 } },
        { text: promptText }
      ] }],
      config: {
        systemInstruction: SYSTEM_PNR,
        responseMimeType: 'application/json',
        temperature: 0.1,
        // Thinking High: gran delta en 3.5-flash-lite para razonar las reglas de
        // extraccion (PNR pegado y e-ticket PDF). Mismo patron que gemini-travel;
        // el combo con el fallback gemini-3.1-flash-lite ya esta probado ahi.
        thinkingConfig: { thinkingLevel: 'HIGH' },
        safetySettings: SAFETY_SETTINGS
      }
    };
    if (budgetMs && budgetMs > 0 && typeof AbortSignal.timeout === 'function') {
      request.config.abortSignal = AbortSignal.timeout(budgetMs);
    }
    return request;
  };
}

async function generateContentWithRetries(ai, primaryModel, requestFactory, logLabel = 'pnr-checkin', options = {}) {
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

      try {
        const response = await ai.models.generateContent({
          model: currentModel,
          ...request
        });

        if (modelIndex > 0) {
          console.log(`${logLabel}: fallback exitoso con ${currentModel} (primary era ${primaryModel})`);
        }
        return { response, modelUsed: currentModel };
      } catch (err) {
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

// ── Parseo del JSON devuelto por Gemini ───────────────────────

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
  t = t.replace(/,\s*$/, '');
  const openBraces = (t.match(/\{/g) || []).length;
  const closeBraces = (t.match(/\}/g) || []).length;
  const openBrackets = (t.match(/\[/g) || []).length;
  const closeBrackets = (t.match(/\]/g) || []).length;
  for (let i = 0; i < openBrackets - closeBrackets; i++) t += ']';
  for (let i = 0; i < openBraces - closeBraces; i++) t += '}';
  return t;
}

function parsePnrJson(raw) {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) return null;
  for (const text of [candidate, repairJsonText(candidate)]) {
    try {
      const data = JSON.parse(text);
      if (data && typeof data === 'object') return data;
    } catch (_) { /* siguiente intento */ }
  }
  return null;
}

// ── Agrupacion deterministica de segmentos en piernas ──────────
// Una pierna = un check-in. Dos segmentos consecutivos son la misma
// pierna (escala) si entre la LLEGADA de uno y la SALIDA del siguiente
// hay menos de 24hs. Si hay 24hs o mas, son piernas separadas (cada
// vuelo necesita su propio check-in). Los gaps son invariantes en la
// zona horaria porque ambas fechas estan en hora Argentina naive.
// Excepcion: un segmento de OTRA aerolinea (o con otro codigo de
// reserva de aerolinea) nunca se funde como escala, aunque conecte en
// menos de 24hs: es otro check-in (ej. MAD-LIM en IB/PHTQD + LIM-EZE
// en LA/CHMJSC => 2 piernas, una por aerolinea).
const DIA_MS = 24 * 60 * 60 * 1000;

function ts(fecha) {
  const t = new Date(fecha).getTime();
  return isNaN(t) ? null : t;
}

function groupSegmentos(segmentos) {
  const segs = (Array.isArray(segmentos) ? segmentos : [])
    .filter(s => s && s.fecha_salida)
    .map(s => ({
      salida: s.fecha_salida,
      llegada: s.fecha_llegada || s.fecha_salida,
      vuelo: s.vuelo || '',
      origen: s.origen || '',
      destino: s.destino || '',
      compania: s.compania || '',
      reservaVuelo: s.reservaVuelo || null
    }));
  if (!segs.length) return [];

  const piernas = [];
  for (const s of segs) {
    const prev = piernas[piernas.length - 1];
    const tSalida = ts(s.salida);
    const tLlegadaPrev = prev ? ts(prev._tLlegada) : null;
    // Otro check-in si cambia la aerolinea o el codigo de reserva (se compara
    // solo cuando AMBOS lados tienen el dato; vacio/null = desconocido, no corta).
    const distintaCompania = prev && s.compania && prev.compania && s.compania !== prev.compania;
    const distintaReserva = prev && s.reservaVuelo && prev.reservaVuelo && s.reservaVuelo !== prev.reservaVuelo;
    if (prev && !distintaCompania && !distintaReserva && tSalida !== null && tLlegadaPrev !== null && (tSalida - tLlegadaPrev) < DIA_MS) {
      // escala: misma pierna (< 24h en tierra, misma aerolinea y reserva)
      if (s.origen) prev.escalas.push(s.origen);
      prev.destino = s.destino || prev.destino;
      prev._tLlegada = s.llegada;
      // completa datos de aerolinea que falten en la pierna
      if (!prev.compania && s.compania) prev.compania = s.compania;
      if (!prev.reservaVuelo && s.reservaVuelo) prev.reservaVuelo = s.reservaVuelo;
    } else {
      // nueva pierna (gap >= 24h o primera)
      piernas.push({ fecha: s.salida, vuelo: s.vuelo, origen: s.origen, destino: s.destino, escalas: [], compania: s.compania, reservaVuelo: s.reservaVuelo, _tLlegada: s.llegada });
    }
  }
  return piernas.map(({ _tLlegada, ...p }) => p);
}

function tipoDePiernas(piernas) {
  if (piernas.length <= 1) return 'one-way';
  if (piernas.length === 2 && piernas[0].origen && piernas[1].destino === piernas[0].origen) return 'round-trip';
  return 'multi-city';
}

// Merge de N resultados crudos de Gemini (uno por e-ticket PDF) en uno solo a
// nivel de segmentos. Deduplica segmentos repetidos (mismo vuelo+salida+origen+
// destino, como pasa cuando dos pasajeros del mismo PNR traen el mismo itine-
// rario) y pasajeros repetidos. Conserva el reservaVuelo no-null si hay duplica-
// dos con valores distintos. pnrAmadeus = primero no-null; notas = concatenadas.
// Sobre los segmentos mergeados se corre groupSegmentos UNA vez despues (correcto
// agrupado de escalas entre PDFs, ej. piernas que conectan entre dos e-tickets).
function mergePdfResults(resultados) {
  const segs = [];
  const segIndex = {};                 // clave -> posicion en segs
  const pasajeros = [];
  const paxClaves = new Set();
  const notas = [];
  let pnrAmadeus = null;
  for (const r of resultados) {
    const d = r.data || {};
    if (!pnrAmadeus && d.pnrAmadeus) pnrAmadeus = d.pnrAmadeus;
    if (Array.isArray(d.segmentos)) {
      for (const s of d.segmentos) {
        if (!s || !s.fecha_salida) continue;
        const clave = `${s.vuelo || ''}|${s.fecha_salida || ''}|${s.origen || ''}|${s.destino || ''}`;
        if (clave in segIndex) {
          const ex = segs[segIndex[clave]];
          if (!ex.reservaVuelo && s.reservaVuelo) ex.reservaVuelo = s.reservaVuelo;
        } else {
          segIndex[clave] = segs.length;
          segs.push({ ...s });
        }
      }
    }
    if (Array.isArray(d.pasajeros)) {
      for (const p of d.pasajeros) {
        const clave = `${(p.apellido || '').toUpperCase()}|${(p.nombre || '').toUpperCase()}`;
        if (paxClaves.has(clave)) continue;
        paxClaves.add(clave);
        pasajeros.push({ ...p });
      }
    }
    if (d.notas) notas.push(String(d.notas));
  }
  return {
    pnrAmadeus,
    segmentos: segs,
    pasajeros,
    notas: notas.length ? notas.join(' | ') : null
  };
}

async function interpretarPNR(ai, primaryModel, requestFactory, fnStart, label = 'pnr-checkin: interpretar') {
  const deadlineMs = fnStart + NETLIFY_DEADLINE_MS;
  try {
    const result = await generateContentWithRetries(
      ai,
      primaryModel,
      requestFactory,
      label,
      {
        maxAttemptsPrimary: 2,
        maxAttemptsFallback: 1,
        skipBackoffOnAbort: true,
        deadlineMs,
        minMsBeforeAttempt: 3500
      }
    );
    const text = result.response.text || '';
    if (!text) throw new Error('Respuesta vacía de Gemini.');
    const parsed = parsePnrJson(text);
    if (!parsed) {
      console.error(`${label}: parse falló. Inicio: ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
      throw new Error('JSON inválido');
    }
    return { data: parsed, modelUsed: result.modelUsed };
  } catch (err) {
    throw err;
  }
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

// Día en hora de Argentina como YYYY-MM-DD (fallback si el cliente no manda "hoy").
function hoyArgentina() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

// ============================================================
//  Handler
// ============================================================

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method Not Allowed' });
  }
  if ((event.body || '').length > 6_000_000) {
    return reply(413, { error: 'Payload demasiado grande.' });
  }

  const auth = await verifyAuth(event);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  console.log(`pnr-checkin: agencyId=${auth.agencyId} uid=${auth.uid}`);

  const apiKey = process.env.GEMINI_API_KEY;
  // Modelo aislado de gemini-scan: pnr-checkin usa GEMINI_CHECKIN_MODEL (default
  // gemini-3.5-flash-lite con thinking High, mismo patrón que gemini-travel para
  // razonar las reglas de extracción). No lee GEMINI_MODEL para no acoplarse al
  // modelo de escaneo de documentos.
  const model  = process.env.GEMINI_CHECKIN_MODEL || 'gemini-3.5-flash-lite';
  if (!apiKey) {
    return reply(500, { error: 'GEMINI_API_KEY no está configurada en Netlify.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return reply(400, { error: 'Body inválido (JSON requerido).' });
  }

  // Tres modos de entrada: uno o varios e-tickets en PDF (base64) o texto PNR.
  // pdfs[] (array) tiene prioridad sobre pdf (string, compat con un solo PDF).
  const pdfsInput = Array.isArray(payload.pdfs) ? payload.pdfs.filter(p => p && p.toString().trim()) : [];
  const pdfBase64 = (payload.pdf || '').toString().trim();
  const pnrText = (payload.pnr || '').toString().trim();

  if (!pdfsInput.length && !pdfBase64 && !pnrText) {
    return reply(400, { error: 'Adjuntá un e-ticket en PDF o pegá el PNR de Amadeus.' });
  }
  if (pnrText && pnrText.length > 6000) {
    return reply(413, { error: 'El PNR es demasiado largo.' });
  }
  if (pdfsInput.length > 8) {
    return reply(413, { error: 'Máximo 8 PDFs por vez.' });
  }
  for (const b64 of pdfsInput) {
    if (b64.length > 2_700_000) return reply(413, { error: 'Un PDF supera ~2MB.' });
  }
  if (pdfBase64 && pdfBase64.length > 2_700_000) {
    return reply(413, { error: 'El PDF es demasiado grande (máx ~2MB).' });
  }

  const hoy = (payload.hoy || '').toString().trim() || hoyArgentina();

  const fnStart = Date.now();

  try {
    const ai = new GoogleGenAI({ apiKey });
    let data, modelUsed, extra = {};
    // El fallback de reservaVuelo (mas abajo) solo aplica a e-tickets: ahi el
    // localizador unico compartido hace pnrAmadeus == reservaVuelo. En el path
    // PNR pegado son conceptos distintos y null es intencional (ver comentario).
    const isEticket = pdfsInput.length > 0 || !!pdfBase64;

    if (pdfsInput.length) {
      // Multi-PDF: N e-tickets leidos en paralelo y mergeados a nivel de
      // segmentos. Si alguno falla, se mergean los exitosos y se informa el
      // conteo en _meta (tolerancia a fallo parcial).
      const resultados = await Promise.allSettled(pdfsInput.map((b64, i) =>
        interpretarPNR(ai, model, makePdfRequest(b64, buildPromptEticket(hoy)), fnStart, `pnr-checkin: eticket ${i + 1}/${pdfsInput.length}`)
      ));
      const ok = resultados.filter(r => r.status === 'fulfilled').map(r => r.value);
      const fallados = resultados.length - ok.length;
      if (!ok.length) throw (resultados[0]?.reason || new Error('Todos los PDFs fallaron.'));
      if (fallados) console.warn(`pnr-checkin: ${fallados} PDF(s) fallaron, se mergean ${ok.length} exitoso(s)`);
      data = mergePdfResults(ok);
      modelUsed = ok[0]?.modelUsed;
      extra = { pdfs: ok.length, fallados };
    } else if (pdfBase64) {
      const result = await interpretarPNR(ai, model, makePdfRequest(pdfBase64, buildPromptEticket(hoy)), fnStart, 'pnr-checkin: eticket');
      data = result.data;
      modelUsed = result.modelUsed;
    } else {
      const result = await interpretarPNR(ai, model, makeJsonRequest(buildPromptPnr(pnrText, hoy)), fnStart, 'pnr-checkin: pnr');
      data = result.data;
      modelUsed = result.modelUsed;
    }

    // Agrupacion deterministica de segmentos en piernas (un check-in por pierna).
    // Umbral: gap >= 24h entre llegada y la siguiente salida => pierna separada.
    // Tambien separa cuando cambia la aerolinea o el codigo de reserva.
    const piernas = groupSegmentos(data.segmentos);
    // Fallback de reservaVuelo SOLO para e-tickets: en muchos el localizador es
    // unico y compartido (= pnrAmadeus), asi que si NINGUNA pierna tiene codigo
    // la lleno con pnrAmadeus. En el path PNR pegado NO se aplica: ahi
    // reservaVuelo=null es intencional cuando el segmento no trae sufijo /REF
    // (pnrAmadeus es el record locator de Amadeus, distinto del codigo de la cia).
    // Si solo ALGUNAS piernas tienen codigo, las demas no se rellenan: con el
    // split por aerolinea, cruzar el codigo de una cia con el check-in de otra
    // es peor que dejarlo vacio y completarlo a mano.
    if (isEticket && data.pnrAmadeus && !piernas.some(p => p.reservaVuelo)) {
      for (const p of piernas) p.reservaVuelo = data.pnrAmadeus;
    }
    data.piernas = piernas;
    data.tipo = tipoDePiernas(piernas);
    delete data.segmentos;

    data._meta = {
      modeloUsado: modelUsed,
      modeloSolicitado: model,
      duracionMs: Date.now() - fnStart,
      ...extra
    };

    await recordUsage({ agencyId: auth.agencyId, kind: 'travel', source: 'gemini' });
    return reply(200, { data, source: 'gemini' });
  } catch (err) {
    const message = err?.message || err?.toString() || 'error desconocido';
    console.error('pnr-checkin: error:', message);
    const friendly = /json inválido/i.test(message)
      ? 'Gemini devolvió formato inválido. Intentá de nuevo.'
      : `No se pudo interpretar el documento: ${message}`;
    return reply(502, { error: friendly });
  }
};

exports.handler = require('./_sentry.cjs').wrapHandler(exports.handler);
