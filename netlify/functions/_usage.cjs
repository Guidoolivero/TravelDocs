// ============================================================
//  _usage.cjs — Medición de uso por agencia (base del cobro manual)
//
//  Cada llamada a la IA (gemini-scan / gemini-travel) incrementa un
//  contador diario en agencies/{agencyId}/usage/{YYYY-MM-DD}.
//
//  - Sin límite por agencia: la red de seguridad es el tope de USD/mes
//    de la key de Google. Acá solo se cuenta uso, no se limita.
//  - Best-effort: si la escritura falla, NO rompe la operación de IA.
//    El usuario ya tiene su resultado; perder 1 conteo es aceptable.
//  - Escritura vía Admin SDK (service account), que saltea firestore.rules
//    (el cliente no puede leer usage: ver match /usage/{dayId} en rules).
// ============================================================

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

function initAdmin() {
  if (admin.apps.length) return;
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!inline) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT no configurada en Netlify.');
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(inline)) });
}

function db() {
  initAdmin();
  return admin.firestore();
}

// Día en hora de Argentina (America/Argentina/Buenos_Aires, UTC-3) como YYYY-MM-DD.
// Usa Intl para no depender del TZ del runtime (Netlify corre en UTC): un escaneo
// a las 22:00 ARG no debe contarse en el día siguiente. Función pura (testeable).
function usageDayId(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t) => (parts.find(p => p.type === t) || {}).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const VALID_KINDS = ['scans', 'travel'];
const VALID_SOURCES = ['gemini', 'claude'];

// Construye el patch de increment para un uso. Función pura (testeable).
function buildUsagePatch({ kind, source }) {
  if (!VALID_KINDS.includes(kind)) {
    throw new Error(`_usage: kind inválido "${kind}" (esperado: ${VALID_KINDS.join('|')}).`);
  }
  const patch = {
    [kind]: FieldValue.increment(1),
    agencyId: null, // se completa abajo
    dayId: null,    // se completa abajo
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (VALID_SOURCES.includes(source)) {
    patch.bySource = { [source]: FieldValue.increment(1) };
  }
  return patch;
}

/**
 * Registra un uso en el contador diario de la agencia. Best-effort.
 *   kind   : 'scans' (gemini-scan) | 'travel' (gemini-travel)
 *   source : 'gemini' | 'claude'   (proveedor que efectivamente respondió)
 * No lanza: si falla, loguea y devuelve silenciosamente.
 */
async function recordUsage({ agencyId, kind, source }) {
  if (!agencyId) return;
  try {
    const dayId = usageDayId();
    const patch = buildUsagePatch({ kind, source });
    patch.agencyId = agencyId;
    patch.dayId = dayId;
    await db()
      .collection('agencies')
      .doc(agencyId)
      .collection('usage')
      .doc(dayId)
      .set(patch, { merge: true });
  } catch (err) {
    // Best-effort: no romper la operación principal por un conteo fallido.
    console.error(`_usage: no se pudo registrar uso (agencyId=${agencyId}, kind=${kind}, source=${source}):`, err?.message || err);
  }
}

module.exports = { recordUsage, buildUsagePatch, usageDayId, VALID_KINDS, VALID_SOURCES };
