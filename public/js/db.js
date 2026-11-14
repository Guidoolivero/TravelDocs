// ============================================================
//  db.js — CRUD con Firestore (multi-tenant)
//  Rutas: /agencies/{agencyId}/passengers|notifications
// ============================================================

import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  getDoc,
  setDoc,
  writeBatch,
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { storeAgencyId } from './tenant.js';
import { snapshotChanged } from './snapshot.mjs';
import { markNotifiedLegs } from './alertas/alert-core.mjs';

let db;
let agencyId = null;
let unsubscribe = null;

export function initDB(app) {
  db = getFirestore(app);
}

export function setTenantContext(id) {
  if (!id) throw new Error('agencyId requerido');
  agencyId = id;
  storeAgencyId(id);
}

export function getTenantContext() {
  return agencyId;
}

export function clearTenantContext() {
  agencyId = null;
}

function requireAgency() {
  if (!agencyId) {
    throw new Error('Tenant no configurado. Llamá setTenantContext() antes de operar con Firestore.');
  }
  return agencyId;
}

function passengersCollection() {
  return collection(db, 'agencies', requireAgency(), 'passengers');
}

function passengerDoc(id) {
  return doc(db, 'agencies', requireAgency(), 'passengers', id);
}

function reservationsCollection() {
  return collection(db, 'agencies', requireAgency(), 'reservations');
}

function reservationDoc(id) {
  return doc(db, 'agencies', requireAgency(), 'reservations', id);
}

function notificationDoc(key) {
  return doc(db, 'agencies', requireAgency(), 'notifications', key);
}

// Lookup usuario → agencia (usado en login.js y app.mjs)
export async function getUserAgency(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;

  const data = snap.data() || {};
  if (data.active === false) return null;
  return data.agencyId || null;
}

export async function getAgency(agencyId) {
  const snap = await getDoc(doc(db, 'agencies', agencyId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

function settingsDoc(id) {
  return doc(db, 'agencies', requireAgency(), 'settings', id);
}

export async function getGdsCities() {
  const snap = await getDoc(settingsDoc('gdsCities'));
  if (!snap.exists()) return [];
  const data = snap.data() || {};
  return Array.isArray(data.items) ? data.items : [];
}

export async function saveGdsCities(items) {
  await setDoc(settingsDoc('gdsCities'), {
    items,
    updatedAt: serverTimestamp(),
  });
}

// Escucha en tiempo real. Llama a callback(passengers[]) cada vez que hay cambios.
export function listenPassengers(callback) {
  if (unsubscribe) unsubscribe();
  const q = query(passengersCollection(), orderBy('createdAt', 'desc'));
  let lastFp = null;
  unsubscribe = onSnapshot(q, snapshot => {
    const passengers = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const { fp, changed } = snapshotChanged(lastFp, passengers);
    if (!changed) return;
    lastFp = fp;
    callback(passengers);
  }, err => {
    console.error('Error escuchando pasajeros:', err);
  });
}

export function stopListening() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

export async function addPassenger(data) {
  return await addDoc(passengersCollection(), {
    ...sanitize(data),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

// Alta masiva con writeBatch (hasta 450 ops por lote, 1 round-trip por lote).
// Genera los IDs en el cliente (doc(collection)) y commitea en lotes.
export async function addPassengersBatch(items) {
  const col = passengersCollection();
  const ids = [];
  const CHUNK = 450; // por debajo del limite de 500 de Firestore
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = writeBatch(db);
    const slice = items.slice(i, i + CHUNK);
    const batchIds = [];
    for (const data of slice) {
      const ref = doc(col);
      batch.set(ref, {
        ...sanitize(data),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batchIds.push(ref.id);
    }
    try {
      await batch.commit();
    } catch (error) {
      error.savedIds = ids;
      throw error;
    }
    ids.push(...batchIds);
  }
  return ids;
}

export async function updatePassenger(id, data) {
  return await updateDoc(passengerDoc(id), {
    ...sanitize(data),
    updatedAt: serverTimestamp()
  });
}

export async function deletePassenger(id) {
  return await deleteDoc(passengerDoc(id));
}

// ── Reservas (check-in / vuelo) ─────────────────────────────
// Escucha en tiempo real. Ordena por fecha de vuelo ascendente.
let unsubReservations = null;
export function listenReservations(callback) {
  if (unsubReservations) unsubReservations();
  const q = query(reservationsCollection(), orderBy('fecha', 'asc'));
  let lastFp = null;
  unsubReservations = onSnapshot(q, snapshot => {
    const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const { fp, changed } = snapshotChanged(lastFp, list);
    if (!changed) return;
    lastFp = fp;
    callback(list);
  }, err => { console.error('Error escuchando reservas:', err); });
}

export function stopListeningReservations() {
  if (unsubReservations) { unsubReservations(); unsubReservations = null; }
}

// Canon de fecha de pierna: 'YYYY-MM-DDTHH:mm' (16 chars). El orderBy de la
// lista y la query del cron (send-alerts.cjs) comparan strings lexicográficos;
// formatos mezclados ('2026-09-10' < '2026-09-10T08:00') romperían el rango.
function canonFechaPierna(f) {
  const s = (f || '').toString().trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00';
  return s;
}

// Fecha denormalizada = MÍNIMA fecha de piernas (canónica). Con min, la query
// del cron where('fecha','<=',cutoff) nunca pierde una reserva con tramos
// desordenados: "alguna pierna dentro de la ventana" implica "fecha <= cutoff".
function minFechaPiernas(piernas) {
  const fechas = (piernas || [])
    .map(p => canonFechaPierna(p.fecha))
    .filter(f => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(f));
  return fechas.sort()[0] || '';
}

export async function addReservation(data) {
  const piernas = Array.isArray(data.piernas)
    ? data.piernas.map(p => ({
        fecha: canonFechaPierna(p.fecha),
        ...(p.fechaLocal !== undefined ? { fechaLocal: p.fechaLocal, zonaHoraria: p.zonaHoraria || '' } : {}),
        vuelo: p.vuelo || '',
        origen: p.origen || '',
        destino: p.destino || '',
        escalas: Array.isArray(p.escalas) ? p.escalas : [],
        compania: p.compania || '',          // por tramo: modo multi-aerolínea
        reservaVuelo: p.reservaVuelo != null ? p.reservaVuelo : '',
        checkin: !!p.checkin,
        notified: false
      }))
    : [];
  // Aviso de check-in: email opcional de destino + adelanto 24/48/72hs (días
  // de anticipación; default 24). Vacío = inbox de la agencia.
  const alertEmail = (data.alertEmail || '').toString().trim();
  const horas = Number(data.alertHorasAntes);
  return await addDoc(reservationsCollection(), {
    ...sanitize(data),
    piernas,
    fecha: minFechaPiernas(piernas) || canonFechaPierna(data.fecha) || '',
    alertEmail,
    alertHorasAntes: [24, 48, 72].includes(horas) ? horas : 24,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function updateReservation(id, data) {
  const patch = { ...sanitize(data) };
  // Invariante: si el update trae piernas, la fecha denormalizada se
  // recalcula como la mínima canónica. Sin piernas en el payload, no se toca.
  if (Array.isArray(patch.piernas)) {
    patch.piernas = patch.piernas.map(p => ({ ...p, fecha: canonFechaPierna(p.fecha) }));
    const min = minFechaPiernas(patch.piernas);
    if (min) patch.fecha = min;
  }
  return await updateDoc(reservationDoc(id), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export async function markReservationLegsNotified(id, sent) {
  const ref = reservationDoc(id);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const current = snap.data();
    const legs = current.piernas?.length ? current.piernas : [
      ...(current.fecha ? [{ fecha: current.fecha, checkin: !!current.checkinIda, notified: !!current.notifiedIda }] : []),
      ...(current.fechaVuelta ? [{ fecha: current.fechaVuelta, checkin: !!current.checkinVuelta, notified: !!current.notifiedVuelta }] : []),
    ].map(p => ({ ...p, compania: current.compania || '', reservaVuelo: current.reservaVuelo || '' }));
    tx.update(ref, { piernas: markNotifiedLegs(legs, sent, current), updatedAt: serverTimestamp() });
  });
}

export async function deleteReservation(id) {
  return await deleteDoc(reservationDoc(id));
}

export async function deleteReservations(ids) {
  const list = (ids || []).filter(Boolean);
  const CHUNK = 450;
  for (let i = 0; i < list.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const id of list.slice(i, i + CHUNK)) {
      batch.delete(reservationDoc(id));
    }
    await batch.commit();
  }
}

export async function isNotified(key) {
  const snap = await getDoc(notificationDoc(key));
  return snap.exists();
}

export async function markNotified(key) {
  await setDoc(notificationDoc(key), { sentAt: new Date() });
}

export async function getAllowedEmails() {
  const ref = doc(db, 'config', 'allowedEmails');
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];

  const data = snap.data() || {};
  const raw = Array.isArray(data.emails)
    ? data.emails
    : (Array.isArray(data.allowedEmails) ? data.allowedEmails : []);

  return raw
    .map(v => (v || '').toString().trim().toLowerCase())
    .filter(Boolean);
}

function sanitize(obj) {
  return JSON.parse(JSON.stringify(obj, (_, v) => v === undefined ? null : v));
}
