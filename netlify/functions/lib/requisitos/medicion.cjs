const admin = require('firebase-admin');
const { createHash } = require('node:crypto');

const VENTANA_MS = 30 * 86400000;
const GRACIA_VERIFICACION_MS = 120000;
const PENDIENTE = Symbol('escritura pendiente');
let finVentana;

// Un problema de telemetría no debe consumir el presupuesto de Gemini.
async function mejorEsfuerzo(tarea) {
  let timer;
  try {
    return await Promise.race([tarea, new Promise(resolve => {
      timer = setTimeout(() => resolve(PENDIENTE), 1000);
    })]);
  } catch {
    console.warn('gemini-travel: no se pudo registrar la medición');
  } finally {
    clearTimeout(timer);
  }
}

async function abrir(fase, id, auth, inicio) {
  const contexto = typeof TRAVEL_BUILD_CONTEXT === 'string' ? TRAVEL_BUILD_CONTEXT : process.env.CONTEXT;
  if (contexto !== 'production' || !['analisis', 'verificacion'].includes(fase) ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return;
  const gracia = fase === 'verificacion' ? GRACIA_VERIFICACION_MS : 0;
  if (finVentana && inicio >= finVentana + gracia) return;

  const db = admin.firestore();
  const campana = db.collection('travelMonitoring').doc('requisitos-30d');
  const clave = createHash('sha256').update(JSON.stringify([auth.agencyId, auth.uid, id])).digest('hex');
  const ref = campana.collection('consultas').doc(clave);
  return db.runTransaction(async tx => {
    let fin = finVentana;
    if (!fin) {
      const config = await tx.get(campana);
      fin = config.data()?.fin;
      if (fin) finVentana = fin;
      else if (fase === 'verificacion') return;
    }
    if (fin && inicio >= fin + gracia) return;
    const actual = (await tx.get(ref)).data();
    if (actual?.[fase]) return;
    if (fase === 'verificacion' && (actual?.analisis?.estado !== 'ok' || inicio - actual.analisis.inicio > GRACIA_VERIFICACION_MS)) return;
    if (!fin) tx.set(campana, { inicio, fin: inicio + VENTANA_MS });
    tx.set(ref, { [fase]: { inicio, estado: 'sin_cierre' } }, { merge: true });
    return ref;
  });
}

function estadoError(err) {
  return err?.name === 'AbortError' || err?.name === 'TimeoutError' || err?.status === 504 ||
    /deadline|timed? ?out|timeout|aborted/i.test(err?.message || '') ? 'timeout' : 'error';
}

async function medir({ fase, id, auth, inicio }, ejecutar) {
  const apertura = abrir(fase, id, auth, inicio);
  const ref = await mejorEsfuerzo(apertura);
  const diagnostico = {};
  if (!ref) return ejecutar(diagnostico);
  let estado = 'error';
  let cache = false;
  try {
    const respuesta = await ejecutar(diagnostico);
    if (respuesta.statusCode === 200) {
      const meta = JSON.parse(respuesta.body).data._meta;
      cache = !!meta.deCache;
      estado = fase === 'analisis' || meta.verificoWeb ? 'ok' : diagnostico.fallo || 'sin_verificar';
    } else {
      estado = diagnostico.fallo || 'error';
    }
    return respuesta;
  } catch (err) {
    estado = estadoError(err);
    throw err;
  } finally {
    const fin = Date.now();
    // Si la apertura tardó, su escritura de cierre debe esperar al mismo documento.
    await mejorEsfuerzo(apertura.then(doc => doc?.update({
      [fase]: { inicio, fin, duracionMs: fin - inicio, estado, cache },
    })));
  }
}

module.exports = { medir, estadoError };
