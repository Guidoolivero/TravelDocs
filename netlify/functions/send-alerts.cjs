// ============================================================
//  send-alerts.cjs — Envío server-side de TODAS las alertas (scheduled)
//
//  Corre una vez por día a las 9:00 AM de Argentina (schedule "0 12 * * *"
//  en netlify.toml; 12:00 UTC = 9:00 ART, UTC-3 fijo sin DST) y envía el
//  email unificado de alertas aunque nadie tenga la app abierta. Si una
//  agencia abre la app antes, el fallback del cliente manda sus pendientes
//  en ese momento y esta corrida solo envía lo que falte (dedup por flags):
//    - Vencimientos de documentos (180 días, asistencias 30)
//    - Check-ins de vuelo (24/48/72hs de anticipación por reserva)
//    - Cumpleaños del día
//
//  UN email por destinatario con secciones Vencimientos | Check Ins |
//  Cumpleaños (asunto dinámico). Check-ins con alertEmail propio van en un
//  email individual SOLO a ese email (no aparecen en el unificado de la
//  agencia).
//
//  Dedup compartido con el fallback del cliente (el que llega primero
//  marca): agencies/{id}/notifications/{key}, passenger.birthdayNotifiedYear
//  y piernas[].notified.
//
//  Restricciones:
//    - Scheduled functions: timeout 30s -> guard RUN_DEADLINE_MS (22s);
//      lo que no entra queda para la próxima corrida (mañana 9:00 ART) o
//      antes si una agencia abre la app (fallback del cliente; la ventana
//      de check-in no cierra hasta la salida del vuelo).
//    - EmailJS: máx 1 request/segundo -> SEND_GAP_MS entre envíos.
//    - getAll / queries 'in': chunks de a 10 (límite de Firestore).
//    - Si el volumen crece y los logs muestran cortes por deadline
//      recurrentes, migrar a Background Function (15 min) manteniendo
//      esta lógica.
// ============================================================

const admin = require('firebase-admin');
const { FieldValue, FieldPath } = require('firebase-admin/firestore');
// Lógica compartida con el cliente (leaf, sin imports): esbuild resuelve
// el require de este módulo ESM al bundlear la function (mismo patrón que
// gemini-travel.cjs con conocidos.mjs).
const {
  checkinAlertDue, REQUISITOS_DIAS, isBirthdayToday, anioART, collectEmailAlertCandidates, buildAlertEmail,
} = require('../../public/js/alert-core.mjs');
const { dueFormReminders } = require('../../public/js/form-reminders.mjs');
const { debeEnviarRequisitos, emailAviso, buildRequisitosEmail } = require('../../lib/requisitos-checkin.mjs');

const EMAILJS_SEND_URL = 'https://api.emailjs.com/api/v1.0/email/send';
const RUN_DEADLINE_MS = 22000; // margen sobre los 30s de las scheduled functions
const SEND_GAP_MS = 1100;      // EmailJS: límite 1 request/segundo
const CHUNK = 10;              // límite de getAll / 'in' en Firestore
const MAX_DIAS_ANTES = 3;      // mayor ventana configurable (72hs = 3 días)

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

// 'YYYY-MM-DDTHH:mm' (16 chars, hora Argentina) para el cutoff del query.
// Las comparaciones de ventana usan epoch via checkinAlertDue (parseFechaART).
function fechaArgentina(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const get = t => (parts.find(p => p.type === t) || {}).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

// Piernas escribibles de una reserva: schema nuevo (r.piernas) o fallback
// legacy (fecha/fechaVuelta + checkinIda/Vuelta). Copia fiel de
// storedPiernas() del cliente: al marcar notified se re-persisten las
// piernas completas (perder un campo acá = pérdida de datos en la reserva).
function piernasDe(r) {
  if (Array.isArray(r.piernas) && r.piernas.length) {
    return r.piernas.map(p => ({
      fecha: p.fecha || '',
      vuelo: p.vuelo || '',
      origen: p.origen || '',
      destino: p.destino || '',
      escalas: Array.isArray(p.escalas) ? p.escalas : [],
      compania: p.compania || r.compania || '',
      reservaVuelo: p.reservaVuelo != null ? p.reservaVuelo : (r.reservaVuelo || ''),
      checkin: !!p.checkin,
      notified: !!p.notified,
    }));
  }
  const out = [];
  if (r.fecha) out.push({ fecha: r.fecha, vuelo: '', origen: '', destino: '', compania: r.compania || '', reservaVuelo: r.reservaVuelo || '', checkin: !!r.checkinIda, notified: !!r.notifiedIda });
  if (r.fechaVuelta) out.push({ fecha: r.fechaVuelta, vuelo: '', origen: '', destino: '', compania: r.compania || '', reservaVuelo: r.reservaVuelo || '', checkin: !!r.checkinVuelta, notified: !!r.notifiedVuelta });
  return out;
}

const dormir = ms => new Promise(r => setTimeout(r, ms));

// Envío por el REST de EmailJS. Strict mode de la cuenta exige la Private
// Key como accessToken: viene SOLO de la env var EMAILJS_PRIVATE_KEY del site
// (nunca del doc de la agencia, que el browser de los miembros puede leer).
// Timeout propio: un fetch estancado no puede comerse el presupuesto de 30s
// de la scheduled function (el guard de deadline solo se chequea entre envíos).
async function sendEmail({ publicKey, privateKey, serviceId, templateId, to, subject, html }) {
  const res = await fetch(EMAILJS_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      ...(privateKey ? { accessToken: privateKey } : {}),
      template_params: { to_email: to, subject, message: html },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`EmailJS ${res.status}: ${body.slice(0, 200)}`);
  }
}

// Marca piernas[].notified agrupando por reserva: un solo update por doc
// (updates separados sobre el mismo doc pierden marcas).
async function marcarPiernas(db, agenciaRef, items) {
  const porReserva = new Map();
  items.forEach(x => {
    const key = x.resId;
    if (!porReserva.has(key)) porReserva.set(key, { resId: x.resId, piernas: x.piernas, idxs: [] });
    porReserva.get(key).idxs.push(x.idx);
  });
  await Promise.all([...porReserva.values()].map(({ resId, piernas, idxs }) => {
    idxs.forEach(i => { if (piernas[i]) piernas[i].notified = true; });
    return agenciaRef.collection('reservations').doc(resId).update({
      piernas,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }));
}

async function marcarReqs(agenciaRef, items) {
  const ids = [...new Set(items.map(x => x.resId).filter(Boolean))];
  await Promise.all(ids.map(resId => agenciaRef.collection('reservations').doc(resId).update({
    reqs30Notified: true,
    updatedAt: FieldValue.serverTimestamp(),
  })));
}

// Consulta qué claves del ledger notifications ya existen (chunks de 10).
async function clavesYaNotificadas(agenciaRef, keys) {
  const existentes = new Set();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const lote = keys.slice(i, i + CHUNK);
    const snap = await agenciaRef.collection('notifications')
      .where(FieldPath.documentId(), 'in', lote).get();
    snap.forEach(d => existentes.add(d.id));
  }
  return existentes;
}

// Procesa una agencia. Devuelve { emailsSent }.
async function processAgency(agencyDoc, { now, started }) {
  const agency = agencyDoc.data() || {};
  const agencyId = agencyDoc.id;
  const agenciaRef = agencyDoc.ref;

  // Sin transporte de email no hay nada que enviar (mismo criterio que el
  // cliente: si falta algo de la config, se omite silenciosamente).
  const { emailjsPublicKey, emailjsServiceId, emailjsTemplateId, email } = agency.alerts || {};
  if (!emailjsPublicKey || !emailjsServiceId || !emailjsTemplateId) return { emailsSent: 0 };
  // Private key SOLO del environment del site: el doc de la agencia lo lee el
  // browser de cualquier miembro (getAgency trae el doc completo).
  const privateKey = (process.env.EMAILJS_PRIVATE_KEY || '').trim();
  const appName = agency.name || agency.branding?.appName || 'TravelDocs';

  // ── Check-ins: cutoff día-based. Toda pierna "due" tiene su día <= hoy+3,
  // entonces su fecha < hoy+4 días (fecha denormalizada = mínima de piernas,
  // garantizado por db.js). Sin cota inferior: Firestore no permite range
  // sobre arrays de maps (piernas[].fecha), se filtra en memoria.
  // Palanca de escala cuando el volumen lo pida: indexar fechaFin = max(piernas)
  // y agregar where('fechaFin', '>=', ahora) para no leer historia vieja.
  const diasQuery = Math.max(MAX_DIAS_ANTES, REQUISITOS_DIAS);
  const cutoff = fechaArgentina(now + (diasQuery + 1) * 86400000);
  const resSnap = await agenciaRef.collection('reservations')
    .where('fecha', '<=', cutoff).get();
  console.log(`send-alerts: ${agencyId} leyó ${resSnap.size} reservations`);
  if (resSnap.size > 500) {
    console.warn(`send-alerts: ${agencyId} leyó ${resSnap.size} reservations (> 500); considerar indexar fechaFin.`);
  }

  const grupos = new Map(); // email destino -> [items check-in]
  for (const doc of resSnap.docs) {
    const r = { id: doc.id, ...doc.data() };
    const to = (r.alertEmail || '').toString().trim() || (email || '').toString().trim();
    if (!to) continue;
    const horas = [24, 48, 72].includes(Number(r.alertHorasAntes)) ? Number(r.alertHorasAntes) : 24;
    const piernas = piernasDe(r);
    piernas.forEach((p, idx) => {
      if (p.checkin || p.notified) return;
      if (!checkinAlertDue(p.fecha, horas, now)) return;
      if (!grupos.has(to)) grupos.set(to, []);
      grupos.get(to).push({ resId: r.id, piernas, idx, vuelo: p.vuelo, ruta: (p.origen && p.destino) ? `${p.origen}-${p.destino}` : '', fecha: p.fecha, ref: p.reservaVuelo, paxIds: r.pasajeros || [], pending: r.pendingPassengers || [] });
    });
  }

  // Una sola lectura de passengers: nombres del email + vencimientos + cumple + requisitos.
  const paxSnap = await agenciaRef.collection('passengers').get();
  const passengers = paxSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const paxMap = new Map(passengers.map(p => [p.id, p]));
  const apellidos = new Map(passengers.map(p => [p.id, {
    name: `${p.lastname || ''}, ${p.firstname || ''}`.replace(/^, |, $/g, '') || 'Pasajero',
    nationality: p.nationality || '',
  }]));
  const itemCheckin = x => ({
    pax: [...new Set(x.paxIds)].map(id => apellidos.get(id)?.name).filter(Boolean).concat(x.pending.map(p => `${p.lastname}, ${p.firstname} (sin vincular)`)).join(', ') || 'Pasajeros',
    paxCount: (x.paxIds || []).length + x.pending.length,
    vuelo: x.vuelo,
    ruta: x.ruta,
    fecha: x.fecha,
    ref: x.ref,
  });

  // Consulta separada: un formulario puede abrir antes de la ventana de 30 dias del viaje.
  const formSnap = email ? await agenciaRef.collection('reservations').where('hasFormReminders', '==', true).get() : { docs: [] };
  const formReservations = formSnap.docs.map(d => ({ ...d.data(), id: d.id }));
  const formsDue = dueFormReminders(formReservations, now);
  const formsSent = await clavesYaNotificadas(agenciaRef, formsDue.map(f => f.key));
  const formularios = formsDue.filter(f => !formsSent.has(f.key)).map(f => {
    const r = formReservations.find(r => r.id === f.reservationId);
    const names = (r.pasajeros || []).map(id => apellidos.get(id)?.name).filter(Boolean);
    names.push(...(r.pendingPassengers || []).map(p => `${p.lastname}, ${p.firstname} (sin vincular)`));
    return { ...f, pax: names.join(', ') || r.pnr || 'Check-in sin pasajero' };
  });

  const candidatos = collectEmailAlertCandidates(passengers, now);
  const yaNotificadas = await clavesYaNotificadas(agenciaRef, candidatos.map(c => c.key));
  const toNotify = candidatos.filter(c => !yaNotificadas.has(c.key)).sort((a, b) => a.days - b.days);

  const year = anioART(now);
  const bdCandidates = passengers
    .filter(p => isBirthdayToday(p, now) && (!p.birthdayNotifiedYear || p.birthdayNotifiedYear !== year))
    .map(p => ({ paxId: p.id, name: `${p.lastname}, ${p.firstname}`, dob: p.dob }));
  // Mismo mail que al crear el check-in. Sale al entrar en los 30 días,
  // salvo que el alta ya lo haya mandado adentro de esa ventana.
  const pendientesReq = [];
  for (const doc of resSnap.docs) {
    const r = { id: doc.id, ...doc.data() };
    const vista = { ...r, piernas: piernasDe(r) };
    const pax = (r.pasajeros || []).map(id => paxMap.get(id)).filter(Boolean);
    if (!debeEnviarRequisitos(vista, { alCrear: false, now, pasajeros: pax })) continue;
    const toReq = emailAviso(r.alertEmail, email);
    if (!toReq) continue;
    pendientesReq.push({
      resId: r.id,
      to: toReq,
      mail: buildRequisitosEmail({ appName, reserva: vista, pasajeros: pax }),
    });
  }

  const checkinsAgencia = email ? (grupos.get(email) || []) : [];
  const destinos = new Set(grupos.keys());
  const individuales = [];
  for (const to of destinos) {
    if (email && to === email) continue;
    individuales.push({ to, items: grupos.get(to) || [] });
  }

  let emailsSent = 0;
  if (!toNotify.length && !bdCandidates.length && !checkinsAgencia.length && !individuales.length && !pendientesReq.length && !formularios.length) {
    return { emailsSent };
  }

  const enviar = async (to, subject, html) => {
    if (Date.now() - started > RUN_DEADLINE_MS) throw new Error('deadline');
    await sendEmail({ publicKey: emailjsPublicKey, privateKey, serviceId: emailjsServiceId, templateId: emailjsTemplateId, to, subject, html });
    await dormir(SEND_GAP_MS); // EmailJS: máx 1 request/segundo
    emailsSent++;
  };

  // 1) Individuales PRIMERO: si uno falla, la pierna no se marca y reintenta
  //    en la próxima corrida (o antes, vía fallback del cliente).
  for (const { to, items } of individuales) {
    const { subject, html } = buildAlertEmail({
      appName,
      checkins: items.map(itemCheckin),
    });
    try {
      await enviar(to, subject, html);
      if (items.length) await marcarPiernas(db(), agenciaRef, items);
      console.log(`send-alerts: ${agencyId} email individual OK -> ${to} (${items.length} check-in/s)`);
    } catch (err) {
      if (err.message === 'deadline') throw err; // corta la corrida, reintenta la próxima hora
      console.error(`send-alerts: ${agencyId} FALLÓ el email individual a ${to}:`, err?.message || err);
    }
  }

  // 2) Unificado al inbox de la agencia.
  if (email && (toNotify.length || checkinsAgencia.length || bdCandidates.length || formularios.length)) {
    const { subject, html } = buildAlertEmail({
      appName,
      vencimientos: toNotify,
      checkins: checkinsAgencia.map(itemCheckin),
      cumpleanos: bdCandidates,
      formularios,
    });
    await enviar(email, subject, html);
    console.log(`send-alerts: ${agencyId} email unificado OK: ${subject}`);

    // Marcas solo tras envío exitoso (send-then-mark: marcar antes perdería
    // el alerta si el envío falla). Un fallo de marca post-envío es RUIDOSO
    // a propósito: el síntoma es reenvío cada hora hasta el vuelo.
    try {
      // Chunks de 450: el batch de Firestore falla determinístico arriba de
      // 500 writes (una agencia grande con muchos vencimientos pendientes).
      const ops = [];
      [...toNotify, ...formularios].forEach(c => ops.push(b => b.set(agenciaRef.collection('notifications').doc(c.key), { sentAt: FieldValue.serverTimestamp() })));
      bdCandidates.forEach(c => ops.push(b => b.update(agenciaRef.collection('passengers').doc(c.paxId), { birthdayNotifiedYear: year, updatedAt: FieldValue.serverTimestamp() })));
      for (let i = 0; i < ops.length; i += 450) {
        const batch = db().batch();
        ops.slice(i, i + 450).forEach(op => op(batch));
        await batch.commit();
      }
      if (checkinsAgencia.length) await marcarPiernas(db(), agenciaRef, checkinsAgencia);
    } catch (err) {
      console.error(`send-alerts: ${agencyId} ENVIADO PERO FALLO LA MARCA (reenviará la próxima hora):`, err?.message || err);
    }
  }

  for (const item of pendientesReq) {
    try {
      await enviar(item.to, item.mail.subject, item.mail.html);
      await marcarReqs(agenciaRef, [item]);
      console.log(`send-alerts: ${agencyId} requisitos OK -> ${item.to}`);
    } catch (err) {
      if (err.message === 'deadline') throw err;
      console.error(`send-alerts: ${agencyId} FALLÓ requisitos a ${item.to}:`, err?.message || err);
    }
  }

  return { emailsSent };
}

exports.handler = async event => {
  const started = Date.now();

  // Kill-switch multi-site: PRIMERA línea, cubre el cron y el "Run now"
  // manual del UI de Netlify. Si hay dos sites publicados contra el mismo
  // Firestore (ej. prod + staging), setear ALERTS_CRON_OFF=1 en el otro.
  if (process.env.ALERTS_CRON_OFF === '1') {
    console.log('send-alerts: ALERTS_CRON_OFF=1, no-op.');
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'ALERTS_CRON_OFF' }) };
  }

  // El scheduler invoca con body {"next_run": "..."}; puede venir como string.
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
    if (body?.next_run) console.log('send-alerts: corrida programada, next_run =', body.next_run);
  } catch { /* body no-JSON (ej. invocación manual): se ignora */ }

  const now = started;
  const errors = [];
  let emailsSent = 0;
  let agenciasProcesadas = 0;

  try {
    const agenciesSnap = await db().collection('agencies').get();
    for (const agencyDoc of agenciesSnap.docs) {
      if (Date.now() - started > RUN_DEADLINE_MS) {
        console.warn('send-alerts: deadline alcanzado, quedan agencias para la próxima corrida.');
        break;
      }
      const agency = agencyDoc.data() || {};
      // Docs sin campo status cuentan como activos (mismo criterio que _auth.cjs).
      if (agency.status && agency.status !== 'active') continue;
      agenciasProcesadas++;
      try {
        const res = await processAgency(agencyDoc, { now, started });
        emailsSent += res.emailsSent;
      } catch (err) {
        // Un fallo por agencia no aborta el resto.
        console.error(`send-alerts: agencia ${agencyDoc.id} falló:`, err?.message || err);
        errors.push({ agencyId: agencyDoc.id, error: String(err?.message || err).slice(0, 200) });
      }
    }
  } catch (err) {
    console.error('send-alerts: error general:', err?.message || err);
    errors.push({ error: String(err?.message || err).slice(0, 200) });
  }

  // Solo conteos, sin PII (útil para el botón "Run now" del UI de Netlify).
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: errors.length === 0,
      durationMs: Date.now() - started,
      agencies: agenciasProcesadas,
      emailsSent,
      errors,
    }),
  };
};

exports.handler = require('./_sentry.cjs').wrapHandler(exports.handler);
