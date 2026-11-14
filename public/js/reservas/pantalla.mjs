import { horarioLocal, guardarHorario } from './horarios.mjs';
import { estado } from '../compartido/estado.mjs';
import { matchItineraryPassengers, mergePendingPassengers } from '../pasajeros/pending-passengers.mjs';
import { parsePnrPassengers, isAirlineLocatorName } from './parse-pnr-passengers.mjs';
import { matchesPassenger } from '../pasajeros/passenger-search.mjs';
import { addReservation, updateReservation, deleteReservation } from '../db.js';
import { fmtDate, escStr } from '../compartido/utils.js';
import { requisitosAlertDue, diasHastaVuelo, proximaFechaVuelo, claveOrdenCheckin, colorDiasViaje } from '../alertas/alert-core.mjs';
import { reservationViewPassengers, reservationViewLayout, reservationMatchesSearch } from './reservation-view.mjs';
import { alcanzaConDni } from '../requisitos/cabotaje.mjs';
import { auth } from '../compartido/firebase.mjs';
import { esc, showToast } from '../compartido/ui.mjs';
import { _airlineBadgeHtml, _deriveCompania } from '../compartido/aerolineas-ui.mjs';
import { normDupName } from '../pasajeros/duplicados.mjs';


// ==================== RESERVAS / CHECK-IN ====================

let _resPendingPax = [];
let _resSelectedPax = new Set();      // ids de pasajeros seleccionados en el modal
let _resEditingId = null;
// Identidad de un tramo para conservar checkin/notified: fecha ART, o la
// hora local si la zona no esta confirmada.
const clavePierna = p => `${p.fecha || 'L' + (p.fechaLocal || '')}|${(p.vuelo || '').toUpperCase()}`;
let _resPiernasDraft = [];            // tramos en edicion: {fecha, vuelo, origen, destino, escalas, checkin, compania, reservaVuelo}

// ¿Las piernas del draft tienen aerolínea o ref distintos? -> modo multi-aerolínea.
function _resDraftMulti() {
  const cs = new Set();
  const rs = new Set();
  _resPiernasDraft.forEach(p => {
    if (p.compania) cs.add(p.compania);
    if (p.reservaVuelo) rs.add(p.reservaVuelo);
  });
  return cs.size > 1 || rs.size > 1;
}

// Sincroniza las celdas de arriba con el draft: en SIMPLE las carga con el valor
// compartido; en MULTI las oculta y muestra la nota.
function _syncTopFromDraft() {
  const multi = _resDraftMulti();
  const wrap = document.getElementById('res-compania-wrap');
  const note = document.getElementById('res-multi-note');
  if (wrap) wrap.style.display = multi ? 'none' : '';
  if (note) note.style.display = multi ? '' : 'none';
  if (!multi) {
    const c = _resPiernasDraft[0]?.compania || '';
    const rv = _resPiernasDraft[0]?.reservaVuelo || '';
    const cEl = document.getElementById('res-compania');
    const rvEl = document.getElementById('res-reserva-vuelo');
    if (cEl && cEl.value.toUpperCase() !== c) cEl.value = c;
    if (rvEl && rvEl.value.toUpperCase() !== rv) rvEl.value = rv;
    if (cEl) window.onCompaniaInput(cEl);
  }
}

// En modo SIMPLE, lo tipeado en las celdas de arriba se aplica a todos los tramos.
function _propagateTopToDraft() {
  if (_resDraftMulti()) return;
  const c = (document.getElementById('res-compania')?.value || '').trim().toUpperCase();
  const rv = (document.getElementById('res-reserva-vuelo')?.value || '').trim().toUpperCase();
  _resPiernasDraft.forEach(p => { p.compania = c; p.reservaVuelo = rv; });
}

// Actualiza el badge de aerolínea dentro de una fila de tramo.
function _renderPiernaCompaniaBadge(row, code) {
  const badge = row.querySelector('[data-compania-badge]');
  if (badge) badge.innerHTML = _airlineBadgeHtml(code);
}

// Piernas escribibles de una reserva (para persistir). Lee schema nuevo
// (r.piernas) o migra del viejo (fecha/fechaVuelta + checkinIda/Vuelta).
function storedPiernas(r) {
  if (Array.isArray(r.piernas) && r.piernas.length) {
    return r.piernas.map(p => ({
      fecha: p.fecha || '',
      ...(p.fechaLocal !== undefined ? { fechaLocal:p.fechaLocal, zonaHoraria:p.zonaHoraria || '' } : {}),
      vuelo: p.vuelo || '',
      origen: p.origen || '',
      destino: p.destino || '',
      escalas: Array.isArray(p.escalas) ? p.escalas : [],
      transitos: Array.isArray(p.transitos) ? p.transitos : [],
      compania: p.compania || r.compania || '',               // fallback nivel reserva (compat)
      reservaVuelo: p.reservaVuelo != null ? p.reservaVuelo : (r.reservaVuelo || ''),
      checkin: !!p.checkin,
      notified: !!p.notified
    }));
  }
  const out = [];
  if (r.fecha) out.push({ fecha: r.fecha, vuelo: '', origen: '', destino: '', escalas: [], compania: r.compania || '', reservaVuelo: r.reservaVuelo || '', checkin: !!r.checkinIda, notified: !!r.notifiedIda });
  if (r.fechaVuelta) out.push({ fecha: r.fechaVuelta, vuelo: '', origen: '', destino: '', escalas: [], compania: r.compania || '', reservaVuelo: r.reservaVuelo || '', checkin: !!r.checkinVuelta, notified: !!r.notifiedVuelta });
  return out;
}

// Vista de lectura de las piernas para renderizar (con idx y route).
function resPiernas(r) {
  return storedPiernas(r).map((p, i) => ({
    idx: i,
    fecha: p.fecha,
    fechaLocal: p.fechaLocal,
    zonaHoraria: p.zonaHoraria,
    vuelo: p.vuelo,
    origen: p.origen,
    destino: p.destino,
    escalas: p.escalas,
    compania: p.compania,
    reservaVuelo: p.reservaVuelo,
    done: p.checkin,
    notified: p.notified,
    route: (p.origen && p.destino) ? `${p.origen}→${p.destino}` : `Tramo ${i + 1}`
  }));
}

// Aerolíneas distintas de una reserva (para mostrar "AF" o "AF · IB"). Compatible con reservas viejas.
function resCompanias(r) {
  const set = new Set();
  storedPiernas(r).forEach(p => { if (p.compania) set.add(p.compania); });
  if (!set.size && r.compania) set.add(r.compania);
  return [...set];
}

// Línea resumen para tarjetas: en SIMPLE "AF · KRBJJ", en MULTI "AF · IB".
function resCompaniaLine(r) {
  const comps = resCompanias(r);
  if (comps.length > 1) return comps.join(' · ');
  const c = comps[0] || '—';
  return r.reservaVuelo ? `${c} · ${r.reservaVuelo}` : c;
}

// Un tramo está "due" si el vuelo es mañana (día anterior) o hoy antes de salir.
// Sin importar la hora: al entrar al sistema el día anterior, ya dispara.
function legIsDue(fecha) {
  const t = parseResTs(fecha);
  if (t == null) return false;
  const now = Date.now();
  if (now >= t) return false; // ya salió el vuelo
  const flightDay = new Date(t); flightDay.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((flightDay - today) / 86400000);
  return diffDays >= 0 && diffDays <= 1; // hoy o mañana
}

// Devuelve tramos "due" (día anterior o día del vuelo antes de salir) sin check-in hecho.
// Cada item: { id, r, idx, route, fecha }
function upcomingCheckins() {
  const out = [];
  for (const r of estado.reservations) {
    for (const p of resPiernas(r)) {
      if (p.done) continue;
      if (legIsDue(p.fecha)) out.push({ id: r.id, r, idx: p.idx, route: p.route, fecha: p.fecha, fechaLocal:p.fechaLocal, origen:p.origen });
    }
  }
  return out;
}

// Viajes cuyo primer tramo cae dentro de los 30 días. Sigue en pantalla
// aunque el mail y el modal ya hayan salido.
function viajesRequisitos(now = Date.now()) {
  const out = [];
  for (const r of estado.reservations) {
    const piernas = resPiernas(r);
    const primera = piernas.map(p => p.fecha).filter(Boolean).sort()[0];
    if (!requisitosAlertDue(primera, now)) continue;
    const primeraP = piernas.find(p => p.fecha === primera) || {};
    const pax = (r.pasajeros || []).map(id => estado.passengers.find(p => p.id === id)).filter(Boolean);
    if (!r.pendingPassengers?.length && alcanzaConDni(piernas, pax)) continue;
    const name = pax.map(p => `${p.lastname || ''}, ${p.firstname || ''}`.replace(/^, |, $/g, '')).filter(Boolean).join(', ');
    out.push({
      id: r.id,
      r,
      name: [name, ...(r.pendingPassengers || []).map(p => `${p.lastname}, ${p.firstname} (sin vincular)`)].filter(Boolean).join(', ') || 'Sin pasajeros',
      nationality: [...new Set(pax.map(p => p.nationality).filter(Boolean))].join(', '),
      ruta: piernas.filter(p => p.origen && p.destino).map(p => `${p.origen}-${p.destino}`).join(' · '),
      fecha: primera,
      vuelo: primeraP.vuelo || '',
      compania: resCompanias(r).join(' · '),
    });
  }
  return out;
}

// Parsea 'YYYY-MM-DDTHH:mm' (hora Argentina naive) a ms epoch.
// Forzamos UTC-3 (Argentina, sin DST desde 2009) para que el instante sea
// correcto sin depender de la zona horaria del navegador.
function parseResTs(fecha) {
  if (!fecha) return null;
  const d = fecha.length === 16 ? new Date(fecha + ':00-03:00') : new Date(fecha);
  return isNaN(d.getTime()) ? null : d.getTime();
}

// Las piernas se muestran en hora local; los strings legacy conservan ART.
function fmtResDate(fecha) {
  const pierna = typeof fecha === 'object' ? fecha : null;
  const local = pierna && horarioLocal(pierna);
  const t = parseResTs(local || (pierna ? pierna.fecha : fecha));
  if (t == null) return '—';
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date(t));
  const get = (p) => (partes.find(x => x.type === p) || {}).value || '';
  const mm = get('month').replace('.', '').toLowerCase();
  return `${get('day')} ${mm} ${get('hour')}:${get('minute')}hs${pierna ? (local ? ' (hora local)' : ' (hora argentina; local sin confirmar)') : ''}`;
}

// Apellidos de los pasajeros de una reserva (para identificar a simple vista)
function resPaxSurnames(r) {
  const apellidos = (r.pasajeros || [])
    .map(id => estado.passengers.find(p => p.id === id))
    .filter(Boolean)
    .map(p => p.lastname)
    .filter(Boolean);
  apellidos.push(...(r.pendingPassengers || []).map(p => `${p.lastname}, ${p.firstname} (sin vincular)`));
  return apellidos.length ? apellidos.join(', ') : 'Sin pasajeros';
}

// ¿Existe ya una reserva que duplica el viaje que se quiere guardar?
// Considera duplicado cuando coincide nombre + apellido, numero de vuelo y
// fecha de viaje (mismo pasajero en el mismo vuelo el mismo dia). Sirve para
// evitar alertas de check-in repetidas para un mismo viaje.
function findDuplicateReservation(newPaxIds, newPiernas, excludeId = null) {
  // Clave de pasajero: apellido + nombre COMPLETO, normalizado. Se usa el nombre
  // completo (no solo el primer nombre) para no conflatar personas distintas:
  // "MARIA JOSE" y "MARIA" con el mismo apellido son personas diferentes.
  const paxKey = p => `${normDupName(p.lastname)} ${normDupName(p.firstname || '')}`;
  // Clave de tramo: vuelo + fecha (solo el dia YYYY-MM-DD).
  const legKey = (vuelo, fecha) => `${(vuelo || '').toUpperCase().trim()}::${(fecha || '').slice(0, 10).trim()}`;
  const tupleKey = (name, vuelo, fecha) => `${name}::${legKey(vuelo, fecha)}`;

  const newNames = (newPaxIds || [])
    .map(id => estado.passengers.find(p => p.id === id)).filter(Boolean).map(paxKey);
  if (!newNames.length) return null;

  const newKeys = new Set();
  for (const name of newNames) {
    for (const p of newPiernas) {
      if (p.vuelo && p.fecha) newKeys.add(tupleKey(name, p.vuelo, p.fecha));
    }
  }
  if (!newKeys.size) return null;

  // Al editar: tolera los solapamientos que ya existian en la reserva original
  // (datos previos a la feature o importados por legacy). Solo bloquea si la
  // edicion INTRODUCE un solapamiento nuevo contra otra reserva.
  let origKeys = null;
  if (excludeId) {
    const orig = estado.reservations.find(r => r.id === excludeId);
    if (orig) {
      origKeys = new Set();
      const origNames = (orig.pasajeros || [])
        .map(id => estado.passengers.find(p => p.id === id)).filter(Boolean).map(paxKey);
      for (const name of origNames) {
        for (const p of resPiernas(orig)) {
          if (p.vuelo && p.fecha) origKeys.add(tupleKey(name, p.vuelo, p.fecha));
        }
      }
    }
  }

  for (const r of estado.reservations) {
    if (excludeId && r.id === excludeId) continue;
    const existNames = (r.pasajeros || [])
      .map(id => estado.passengers.find(p => p.id === id)).filter(Boolean).map(paxKey);
    for (const name of existNames) {
      for (const p of resPiernas(r)) {
        if (!p.vuelo || !p.fecha) continue;
        const k = tupleKey(name, p.vuelo, p.fecha);
        // bloquea solo si es un solapamiento que no estaba antes en la reserva editada
        if (newKeys.has(k) && !(origKeys && origKeys.has(k))) return r;
      }
    }
  }
  return null;
}

function updateReservationsBadge() {
  const badge = document.getElementById('reservations-badge');
  if (!badge) return;
  const n = upcomingCheckins().length;
  badge.style.display = n ? '' : 'none';
  badge.textContent = n;
}

function hintPendingSearch() {
  const last = _resPendingPax[0]?.lastname || '';
  return last.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]+/g, ' ').trim();
}

function consumePendingForPassenger(p) {
  if (!p) return;
  _resPendingPax = _resPendingPax.filter(pending =>
    matchItineraryPassengers([{ apellido: pending.lastname, nombre: pending.firstname }], [p]).ids.length === 0
  );
}
let _resPiernasWrap;

// Mail de requisitos al crear el check-in. Si falla, el check-in queda
// guardado y el cron de la mañana lo reintenta cuando el viaje entra en
// los 30 días. No se llama al editar.
function transitosDeEscala(p) {
  const escalas = new Set((p.escalas || []).map(s => String(s).toUpperCase()));
  return (Array.isArray(p.transitos) ? p.transitos : [])
    .filter(t => escalas.has(String(t?.iata || '').toUpperCase()))
    .map(t => ({
      iata: String(t.iata || '').toUpperCase(),
      minutos: Number.isFinite(t.minutos) ? t.minutos : null,
      sinHora: !!t.sinHora || !Number.isFinite(t.minutos),
    }));
}

async function avisarRequisitosCheckin(reservationId) {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser || !reservationId) return;
    const idToken = await currentUser.getIdToken();
    const fnUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:8888/.netlify/functions/checkin-reqs'
      : '/.netlify/functions/checkin-reqs';
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({ reservationId }),
    });
    if (!res.ok) showToast('Check-in guardado. No salió el mail de requisitos.', true);
  } catch (err) {
    console.error('Mail de requisitos:', err);
    showToast('Check-in guardado. No salió el mail de requisitos.', true);
  }
}

// ── Interpretar PNR de Amadeus pegado (IA) ──────────────────
// Busca cada pasajero del PNR en la base (passengers en memoria) por
// apellido + primer nombre. Devuelve { encontrados: [ids], noEncontrados: [nombre] }.
function matchPnrPasajeros(pasajeros) {
  const previous = _resPendingPax
    .map(p => ({ apellido: p.lastname, nombre: p.firstname }))
    .filter(p => !isAirlineLocatorName(p.apellido, p.nombre));
  const result = matchItineraryPassengers([...previous, ...(pasajeros || [])], estado.passengers);
  _resPendingPax = mergePendingPassengers([], result.pending);
  return { encontrados: result.ids, noEncontrados: result.pending.map(p => `${p.lastname}, ${p.firstname}`) };
}

// Lee un File como base64 (sin el prefijo data:...;base64,). Espeja el patrón
// de scanner.js pero local, para no depender de que scanner.js esté cargado.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Menos de 24 h en tierra = escala (no destino). 24 h o mas = multi destino.
function etiquetaTipoViaje(tipo, piernas) {
  const escIata = [...new Set((piernas || []).flatMap(p => p.escalas || []).filter(Boolean))];
  if (tipo === 'round-trip') {
    return escIata.length
      ? `Ida y vuelta. Escala en ${escIata.join(', ')} (menos de 24 h).`
      : 'Ida y vuelta.';
  }
  if (tipo === 'multi-city') return 'Multi destino. 24 h o más en un punto cuenta como destino.';
  if (tipo === 'one-way') return 'Solo ida.';
  return '';
}
export function initReservas() {
  document.getElementById('btn-interpret-pnr')?.addEventListener('click', () => window.interpretarPNR());

  document.getElementById('modal-reservation-close-btn')?.addEventListener('click', () => window.closeModal('modal-reservation'));

  document.getElementById('modal-reservation-cancel-btn')?.addEventListener('click', () => window.closeModal('modal-reservation'));

  document.getElementById('btn-save-reservation')?.addEventListener('click', () => window.saveReservation());

  document.getElementById('btn-attach-pdf')?.addEventListener('click', () => document.getElementById('res-pdf-input')?.click());

  document.getElementById('res-pdf-input')?.addEventListener('change', e => {
    const files = Array.from(e.target.files || []);   // capturar antes de resetear
    e.target.value = '';   // permite re-elegir los mismos archivos
    window.interpretarPDFs(files);
  });

  document.getElementById('res-pdf-dropzone')?.addEventListener('dragover', e => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    if (document.getElementById('btn-attach-pdf').disabled) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.dataTransfer.dropEffect = 'copy';
    e.currentTarget.classList.add('drag-over');
  });

  document.getElementById('res-pdf-dropzone')?.addEventListener('dragleave', e => {
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    e.currentTarget.classList.remove('drag-over');
  });

  document.getElementById('res-pdf-dropzone')?.addEventListener('drop', e => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (!document.getElementById('btn-attach-pdf').disabled) window.interpretarPDFs(e.dataTransfer.files);
  });

  document.getElementById('res-compania')?.addEventListener('input', e => {
    window.onCompaniaInput(e.target);
    _propagateTopToDraft();
  });

  document.getElementById('res-reserva-vuelo')?.addEventListener('input', _propagateTopToDraft);

  document.getElementById('reservations-new-btn')?.addEventListener('click', () => window.openNewReservation());

  document.getElementById('res-view-close-btn')?.addEventListener('click', () => window.closeModal('modal-reservation-view'));

  document.getElementById('res-view-edit-btn')?.addEventListener('click', () => {
    const id = window._viewReservationId;
    window.closeModal('modal-reservation-view');
    if (id) window.openEditReservation(id);
  });

  document.getElementById('res-pax-search')?.addEventListener('input', e => window.renderResPaxList(e.target.value));

  document.getElementById('reservations-search')?.addEventListener('input', () => window.renderReservations());

  document.getElementById('res-add-pierna')?.addEventListener('click', () => {
    const c = (document.getElementById('res-compania')?.value || '').trim().toUpperCase();
    const rv = (document.getElementById('res-reserva-vuelo')?.value || '').trim().toUpperCase();
    _resPiernasDraft.push({ fecha: '', fechaLocal: '', vuelo: '', origen: '', destino: '', escalas: [], compania: c, reservaVuelo: rv, checkin: false });
    window.renderResPiernasDraft();
  });

  window.renderReservations = function() {
    const list = document.getElementById('reservations-list');
    const count = document.getElementById('reservations-count');
    if (!list) return;

    // Buscador del sector Check ins: pasajeros vinculados y sin vincular
    const q = document.getElementById('reservations-search')?.value || '';
    const filtered = estado.reservations.filter(r => reservationMatchesSearch(r, estado.passengers, q));

    if (count) count.textContent = q
      ? `${filtered.length} de ${estado.reservations.length} check-in(s)`
      : `${estado.reservations.length} check-in(s)`;

    if (!estado.reservations.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px;">Sin check-ins cargados. Creá uno con "+ Nuevo check-in".</div>';
      return;
    }
    if (!filtered.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px;">No hay check-ins que coincidan con la búsqueda.</div>';
      return;
    }

    const now = Date.now();
    const due = upcomingCheckins();
    const dueIds = new Set(due.map(x => x.id));
    const ordenados = filtered.slice().sort((a, b) =>
      claveOrdenCheckin(resPiernas(a).map(p => p.fecha), now)
      - claveOrdenCheckin(resPiernas(b).map(p => p.fecha), now)
    );
    list.innerHTML = ordenados.map(r => {
      const paxCount = (r.pasajeros || []).length;
      const piernas = resPiernas(r);
      const legBadges = piernas.map(p => {
        const t = parseResTs(p.fecha);
        const past = t != null && t < now;
        const soon = due.some(x => x.id === r.id && x.idx === p.idx);
        const cls = p.done ? 'green' : soon ? 'red' : past ? 'blue' : 'amber';
        const txt = p.done ? `${p.route} ✓` : soon ? `${p.route} pronto` : past ? `${p.route} pasado` : p.route;
        return `<span class="badge badge-${cls}">${esc(txt)}</span>`;
      }).join(' ');
      const tramosLine = piernas.map(p => `${esc(p.route)} ${fmtResDate(p)}`).join(' · ') || 'Sin tramos';
      const proxima = proximaFechaVuelo(piernas.map(p => p.fecha), now);
      const dias = diasHastaVuelo(proxima, now);
      const colorDias = colorDiasViaje(dias);
      const diasTxt = dias == null ? '' : dias < 0 ? 'ya salió' : dias === 0 ? 'hoy' : dias === 1 ? 'falta 1 día' : `faltan ${dias} días`;
      const pulso = colorDias === 'red' ? ' pulse' : '';
      const diasBadge = colorDias ? `<span class="badge badge-${colorDias}${pulso}" style="margin-left:8px;">${diasTxt}</span>` : '';
      const avisoHs = [24, 48, 72].includes(Number(r.alertHorasAntes)) ? Number(r.alertHorasAntes) : 24;
      return `
      <div class="card" style="padding:14px 18px;margin-bottom:8px;cursor:pointer;" role="button" tabindex="0" data-open-reservation="${escStr(r.id)}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="font-weight:600;font-size:14px;">${esc(resPaxSurnames(r))} <span style="color:var(--text3);font-weight:400;font-family:var(--mono);font-size:12px;">· ${esc(resCompaniaLine(r))}</span></div>
            <div style="font-size:12px;color:var(--text3);margin-top:3px;">${tramosLine} · ${paxCount} pasajero(s) · aviso: ${avisoHs}hs${diasBadge}${r.alertEmail ? ` → ${esc(r.alertEmail)}` : ''}</div>
            <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">${legBadges}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${piernas.map(p => `<button class="btn btn-ghost btn-sm" data-toggle-checkin="${escStr(r.id)}" data-idx="${p.idx}" data-no-row-action="true">${esc(p.route)}: ${p.done ? 'Desmarcar' : 'Check-in'}</button>`).join('')}
            <button class="btn btn-ghost btn-sm" data-edit-reservation="${escStr(r.id)}" data-no-row-action="true">Editar</button>
            <button class="btn btn-ghost btn-sm" data-delete-reservation="${escStr(r.id)}" data-no-row-action="true" style="color:var(--red);">Eliminar</button>
          </div>
        </div>
      </div>`;
    }).join('');
  };

  // Clicks delegados en la lista de reservas y tarjeta dashboard
  document.addEventListener('click', e => {
    const toggleBtn = e.target.closest('[data-toggle-checkin]');
    if (toggleBtn) { window.toggleCheckin(toggleBtn.dataset.toggleCheckin, parseInt(toggleBtn.dataset.idx, 10)); return; }
    const editId = e.target.closest('[data-edit-reservation]')?.dataset.editReservation;
    if (editId) { window.openEditReservation(editId); return; }
    const delId = e.target.closest('[data-delete-reservation]')?.dataset.deleteReservation;
    if (delId) { window.deleteReservation(delId); return; }
    const openId = e.target.closest('[data-open-reservation]')?.dataset.openReservation;
    if (openId) { window.openViewReservation(openId); return; }
  });

  window.openNewReservation = function() {
    _resEditingId = null;
    _resSelectedPax = new Set();
    _resPendingPax = [];
    document.getElementById('modal-reservation-title').textContent = 'Nuevo check-in';
    document.getElementById('res-id').value = '';
    document.getElementById('res-pnr').value = '';
    document.getElementById('res-reserva-vuelo').value = '';
    document.getElementById('res-pnr-raw').value = '';
    document.getElementById('res-compania').value = '';
    document.getElementById('res-alert-email').value = '';
    document.getElementById('res-alert-horas').value = '24';
    window.onCompaniaInput(document.getElementById('res-compania'));
    _resPiernasDraft = [];
    window.renderResPiernasDraft();
    document.getElementById('res-pax-search').value = '';
    const rawPreview = document.getElementById('res-pnr-preview');
    if (rawPreview) rawPreview.style.display = 'none';
    const rawStatus = document.getElementById('res-pnr-status');
    if (rawStatus) rawStatus.textContent = '';
    window.renderResPaxList('');
    window.renderResSelectedPax();
    openModal('modal-reservation');
  };

  window.openViewReservation = function(id) {
    const r = estado.reservations.find(x => x.id === id);
    if (!r) return;
    window._viewReservationId = id;
    const pax = reservationViewPassengers(r, estado.passengers);
    const piernas = resPiernas(r);
    document.getElementById('res-view-title').textContent = resPaxSurnames(r) || 'Check-in';
    const layout = reservationViewLayout(piernas.length ? piernas : [{ compania: r.compania, reservaVuelo: r.reservaVuelo }]);
    const copyBtn = (val) => val
      ? `<button type="button" class="copy-btn" data-copy-ssr="${escStr(val)}" data-no-row-action="true">copiar</button>`
      : '';
    const locatorsHtml = layout.locators.length
      ? layout.locators.map(l => `
          <div class="info-row">
            <span class="info-label">${esc(l.compania || '—')}</span>
            <span class="info-value" style="display:flex;align-items:center;gap:8px;font-family:var(--mono);">${esc(l.reservaVuelo || '—')}${copyBtn(l.reservaVuelo)}</span>
          </div>`).join('')
      : '<div class="info-row"><span class="info-label">Reserva aerolínea</span><span class="info-value">—</span></div>';
    const legsHtml = piernas.length
      ? piernas.map(p => `
          <div class="info-row">
            <span class="info-label">${layout.showAirlineOnLegs && p.compania ? `${esc(p.compania)} · ` : ''}${esc(p.route)}${p.vuelo ? ` · ${esc(p.vuelo)}` : ''}</span>
            <span class="info-value">${layout.showLocatorOnLegs && p.reservaVuelo ? `${esc(p.reservaVuelo)} · ` : ''}${fmtResDate(p)}${p.done ? ' · check-in hecho' : ''}</span>
          </div>`).join('')
      : '<div class="info-row"><span class="info-label">Tramos</span><span class="info-value">Sin tramos</span></div>';
    const paxHtml = pax.length
      ? pax.map(p => `
          <div class="info-row res-view-pax" role="button" tabindex="0" data-open-detail="${escStr(p.id)}" data-from="checkin">
            <span class="info-label">${esc(p.lastname)}, ${esc(p.firstname)}</span>
            <span class="info-value">${p.dob ? fmtDate(p.dob) : 'Sin fecha de nacimiento'}</span>
          </div>`).join('')
      : (r.pendingPassengers?.length ? '' : '<div style="font-size:13px;color:var(--text3);">Sin pasajeros asociados.</div>');
    document.getElementById('res-view-body').innerHTML = `
      <div class="form-section">
        <div class="form-section-title">Datos del vuelo</div>
        ${locatorsHtml}
        ${legsHtml}
      </div>
      <div class="form-section">
        <div class="form-section-title">Pasajeros</div>
        <p class="res-view-pax-hint">Tocá un nombre para abrir la ficha</p>
        ${paxHtml}
        ${(r.pendingPassengers || []).map(p => `<div class="info-row"><span>${esc(p.lastname)}, ${esc(p.firstname)}</span><span>Sin ficha</span></div>`).join('')}
      </div>
      <div class="form-section" style="margin-bottom:0;">
        <div class="form-section-title">Aviso</div>
        <div class="info-row"><span class="info-label">Email</span><span class="info-value">${esc(r.alertEmail || 'Agencia')}</span></div>
        <div class="info-row"><span class="info-label">Anticipación</span><span class="info-value">${esc(String([24, 48, 72].includes(Number(r.alertHorasAntes)) ? Number(r.alertHorasAntes) : 24))} hs</span></div>
      </div>`;
    openModal('modal-reservation-view');
  };

  window.openEditReservation = function(id) {
    const r = estado.reservations.find(x => x.id === id);
    if (!r) return;
    _resEditingId = id;
    _resSelectedPax = new Set(r.pasajeros || []);
    const rematch = matchItineraryPassengers((r.pendingPassengers || []).map(p => ({ apellido: p.lastname, nombre: p.firstname })), estado.passengers);
    rematch.ids.forEach(pid => _resSelectedPax.add(pid));
    _resPendingPax = rematch.pending;
    document.getElementById('modal-reservation-title').textContent = 'Editar check-in';
    document.getElementById('res-id').value = id;
    document.getElementById('res-pnr').value = r.pnr || '';
    document.getElementById('res-pnr-raw').value = '';
    document.getElementById('res-alert-email').value = r.alertEmail || '';
    document.getElementById('res-alert-horas').value = String([24, 48, 72].includes(Number(r.alertHorasAntes)) ? Number(r.alertHorasAntes) : 24);
    _resPiernasDraft = storedPiernas(r).map(p => { const local = horarioLocal(p); return local ? {...p, fechaLocal:local} : p; });
    window.renderResPiernasDraft();
    document.getElementById('res-pax-search').value = hintPendingSearch();
    const rawPreview = document.getElementById('res-pnr-preview');
    if (rawPreview) rawPreview.style.display = 'none';
    const rawStatus = document.getElementById('res-pnr-status');
    if (rawStatus) rawStatus.textContent = '';
    window.renderResPaxList(document.getElementById('res-pax-search').value);
    window.renderResSelectedPax();
    openModal('modal-reservation');
  };

  // Lista de pasajeros para agregar (filtrable), excluyendo los ya seleccionados
  window.renderResPaxList = function(search) {
    const wrap = document.getElementById('res-pax-list');
    if (!wrap) return;
    const s = (search || '').toLowerCase();
    const list = estado.passengers
      .filter(p => !_resSelectedPax.has(p.id))
      .filter(p => matchesPassenger(p, s))
      .slice(0, 50);
    if (!list.length) {
      wrap.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:12px;">Sin pasajeros para agregar.</div>';
      return;
    }
    wrap.innerHTML = list.map(p => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:8px;cursor:pointer;" data-add-pax="${escStr(p.id)}" data-no-row-action="true">
        <div style="font-size:13px;">${esc(p.lastname)}, ${esc(p.firstname)} <span style="color:var(--text3);font-size:11px;">${fmtDate(p.dob)}</span></div>
        <span style="font-size:18px;color:var(--accent);">+</span>
      </div>`).join('');
  };

  // Click para agregar un pasajero de la lista
  document.addEventListener('click', e => {
    const addId = e.target.closest('[data-add-pax]')?.dataset.addPax;
    if (!addId) return;
    _resSelectedPax.add(addId);
    consumePendingForPassenger(estado.passengers.find(p => p.id === addId));
    const search = document.getElementById('res-pax-search')?.value || '';
    window.renderResPaxList(search);
    window.renderResSelectedPax();
  });

  document.addEventListener('click', e => {
    const button = e.target.closest('[data-remove-pending]');
    if (!button) return;
    _resPendingPax.splice(Number(button.dataset.removePending), 1);
    window.renderResSelectedPax();
  });

  window.renderResSelectedPax = function() {
    const wrap = document.getElementById('res-pax-selected');
    if (!wrap) return;
    document.getElementById('res-pax-pending').innerHTML = _resPendingPax.map((p, i) => `
      <div style="padding:8px 10px;background:var(--surface2);border-radius:8px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:13px;">${esc(p.lastname)}, ${esc(p.firstname)}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-remove-pending="${i}" data-no-row-action="true" style="color:var(--red);">Quitar</button>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;">Del PNR · sin ficha. Buscala abajo para asociarla.</div>
      </div>`).join('');
    const selected = estado.passengers.filter(p => _resSelectedPax.has(p.id));
    if (!selected.length) {
      wrap.innerHTML = '';
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    wrap.innerHTML = selected.map(p => `
      <div style="padding:8px 10px;background:var(--surface2);border-radius:8px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:13px;">${esc(p.lastname)}, ${esc(p.firstname)}</span>
          <button class="btn btn-ghost btn-sm" data-remove-pax="${escStr(p.id)}" data-no-row-action="true" style="color:var(--red);">Quitar</button>
        </div>
      </div>`).join('');
  };

  document.addEventListener('click', e => {
    const rmId = e.target.closest('[data-remove-pax]')?.dataset.removePax;
    if (!rmId) return;
    _resSelectedPax.delete(rmId);
    const search = document.getElementById('res-pax-search')?.value || '';
    window.renderResPaxList(search);
    window.renderResSelectedPax();
  });

  // Render de los tramos (piernas) en edicion dentro del modal.
  window.renderResPiernasDraft = function() {
    const wrap = document.getElementById('res-piernas');
    if (!wrap) return;
    const multi = _resDraftMulti();
    if (!_resPiernasDraft.length) {
      wrap.innerHTML = '<div style="font-size:12px;color:var(--text3);">Sin tramos. Pegá un PNR o agregá uno manual.</div>';
      _syncTopFromDraft();
      return;
    }
    wrap.innerHTML = _resPiernasDraft.map((p, i) => {
      const route = `${p.origen || '?'}→${p.destino || '?'}${(p.escalas || []).length ? ` (esc. ${p.escalas.join(',')})` : ''}`;
      const aerolineaRow = multi ? `
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start;margin-top:6px;">
          <div class="form-group" style="margin:0;width:90px;">
            <label style="font-size:10px;">Aerolínea</label>
            <input type="text" data-field="compania" value="${escStr(p.compania || '')}" maxlength="3" style="font-family:var(--mono);text-transform:uppercase;">
            <span data-compania-badge style="margin-top:3px;display:block;">${_airlineBadgeHtml(p.compania || '')}</span>
          </div>
          <div class="form-group" style="margin:0;flex:1;min-width:120px;">
            <label style="font-size:10px;">Reserva aerolínea</label>
            <input type="text" data-field="reservaVuelo" value="${escStr(p.reservaVuelo || '')}" style="font-family:var(--mono);text-transform:uppercase;">
          </div>
        </div>` : '';
      return `
      <div class="res-pierna-row" data-idx="${i}" style="padding:8px 10px;background:var(--surface2);border-radius:8px;">
        <div style="font-size:11px;color:var(--text3);margin-bottom:6px;">Tramo ${i + 1}${p.vuelo ? ` · ${escStr(p.vuelo)}` : ''} · ${escStr(route)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end;">
          <div class="form-group" style="margin:0;flex:1;min-width:80px;">
            <label style="font-size:10px;">Vuelo</label>
            <input type="text" data-field="vuelo" value="${escStr(p.vuelo)}" style="font-family:var(--mono);">
          </div>
          <div class="form-group" style="margin:0;width:70px;">
            <label style="font-size:10px;">Origen</label>
            <input type="text" data-field="origen" value="${escStr(p.origen)}" maxlength="3" style="font-family:var(--mono);">
          </div>
          <div class="form-group" style="margin:0;width:70px;">
            <label style="font-size:10px;">Destino</label>
            <input type="text" data-field="destino" value="${escStr(p.destino)}" maxlength="3" style="font-family:var(--mono);">
          </div>
          <div class="form-group" style="margin:0;flex:1;min-width:90px;">
            <label style="font-size:10px;">Escalas (IATA, coma)</label>
            <input type="text" data-field="escalas" value="${escStr((p.escalas || []).join(','))}" style="font-family:var(--mono);">
          </div>
          <div class="form-group" style="margin:0;flex:1.4;min-width:150px;">
            <label style="font-size:10px;">Salida (${p.fechaLocal !== undefined ? 'hora local' : 'hora argentina'}) *</label>
            <input type="datetime-local" data-field="${p.fechaLocal !== undefined ? 'fechaLocal' : 'fecha'}" value="${escStr(p.fechaLocal ?? p.fecha)}">
            ${p.fechaLocal && !guardarHorario(p, p.fechaLocal).fecha ? '<span style="color:var(--red);font-size:12px;">Confirmar zona u horario: no se puede calcular el aviso en Argentina.</span>' : ''}
          </div>
          <div class="form-group" style="margin:0;width:70px;">
            <label style="font-size:10px;">Check-in</label>
            <select data-field="checkin">
              <option value="false"${!p.checkin ? ' selected' : ''}>No</option>
              <option value="true"${p.checkin ? ' selected' : ''}>Sí</option>
            </select>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-remove-pierna="${i}" data-no-row-action="true" style="color:var(--red);">✕</button>
        </div>
        ${aerolineaRow}
      </div>`;
    }).join('');
    _syncTopFromDraft();
  };

  // Lee los inputs del DOM y los vuelca al draft (antes de guardar).
  window.syncResPiernasDraft = function() {
    const wrap = document.getElementById('res-piernas');
    if (!wrap) return;
    wrap.querySelectorAll('.res-pierna-row').forEach(row => {
      const idx = parseInt(row.dataset.idx, 10);
      if (!_resPiernasDraft[idx]) return;
      row.querySelectorAll('[data-field]').forEach(el => {
        const f = el.dataset.field;
        if (f === 'checkin') _resPiernasDraft[idx].checkin = el.value === 'true';
        else if (f === 'escalas') _resPiernasDraft[idx].escalas = el.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        else if (f === 'compania') _resPiernasDraft[idx].compania = el.value.trim().toUpperCase();
        else if (f === 'reservaVuelo') _resPiernasDraft[idx].reservaVuelo = el.value.trim().toUpperCase();
        else _resPiernasDraft[idx][f] = el.value.trim();
      });
    });
  };

  _resPiernasWrap = document.getElementById('res-piernas');

  if (_resPiernasWrap) {
    const onChange = e => {
      const row = e.target.closest('.res-pierna-row');
      if (!row) return;
      const idx = parseInt(row.dataset.idx, 10);
      const f = e.target.dataset.field;
      if (!_resPiernasDraft[idx] || !f) return;
      if (f === 'checkin') {
        _resPiernasDraft[idx].checkin = e.target.value === 'true';
      } else if (f === 'escalas') {
        _resPiernasDraft[idx].escalas = e.target.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      } else if (f === 'compania') {
        const code = e.target.value.trim().toUpperCase();
        e.target.value = code;
        _resPiernasDraft[idx].compania = code;
        _renderPiernaCompaniaBadge(row, code);
      } else if (f === 'reservaVuelo') {
        const rv = e.target.value.trim().toUpperCase();
        e.target.value = rv;
        _resPiernasDraft[idx].reservaVuelo = rv;
      } else {
        _resPiernasDraft[idx][f] = e.target.value.trim();
      }
    };
    _resPiernasWrap.addEventListener('input', onChange);
    _resPiernasWrap.addEventListener('change', onChange);
  }

  // Quitar un tramo del draft.
  document.addEventListener('click', e => {
    const rmIdx = e.target.closest('[data-remove-pierna]')?.dataset.removePierna;
    if (rmIdx === undefined || rmIdx === null) return;
    _resPiernasDraft.splice(parseInt(rmIdx, 10), 1);
    window.renderResPiernasDraft();
  });

  window.toggleCheckin = async function(id, idx) {
    const r = estado.reservations.find(x => x.id === id);
    if (!r) return;
    const piernas = storedPiernas(r);
    if (!piernas[idx]) return;
    piernas[idx].checkin = !piernas[idx].checkin;
    piernas[idx].notified = false;
    try {
      await updateReservation(id, { piernas });
    } catch (err) { console.error('Error toggling check-in:', err); showToast('No se pudo actualizar.', true); }
  };

  window.deleteReservation = async function(id) {
    if (!confirm('¿Eliminar este check-in?')) return;
    try {
      await deleteReservation(id);
      showToast('Check-in eliminado.');
    } catch (err) { console.error('Error eliminando reserva:', err); showToast('No se pudo eliminar.', true); }
  };

  window.saveReservation = async function() {
    const pnr = document.getElementById('res-pnr').value.trim();

    // Sincroniza los inputs del draft (fechas, checkin, aerolínea, ref) antes de guardar.
    window.syncResPiernasDraft();
    // Al editar: si un tramo cambió de fecha o es nuevo, su alerta tiene que
    // poder salir para la fecha nueva -> se resetea notified. Los tramos que
    // conservan vuelo+fecha mantienen su marca (no se reenvía).
    const original = _resEditingId ? estado.reservations.find(x => x.id === _resEditingId) : null;
    const clavesOriginales = new Set((original ? storedPiernas(original) : []).map(clavePierna));
    const piernas = _resPiernasDraft
      .map(p => p.fechaLocal !== undefined ? guardarHorario(p,p.fechaLocal) : p)
      .filter(p => p.fecha || p.fechaLocal) // descarta tramos sin fecha
      .map(p => ({
        fecha: p.fecha,
        ...(p.fechaLocal !== undefined ? {fechaLocal:p.fechaLocal,zonaHoraria:p.zonaHoraria} : {}),
        vuelo: (p.vuelo || '').toUpperCase(),
        origen: (p.origen || '').toUpperCase(),
        destino: (p.destino || '').toUpperCase(),
        escalas: Array.isArray(p.escalas) ? p.escalas.map(s => String(s).toUpperCase()) : [],
        transitos: transitosDeEscala(p),
        compania: (p.compania || '').toUpperCase(),
        reservaVuelo: (p.reservaVuelo || '').toUpperCase(),
        checkin: !!p.checkin,
        notified: !!p.notified && clavesOriginales.has(clavePierna(p))
      }));

    if (!piernas.length) {
      showToast('Agregá al menos un tramo con fecha.', true);
      return;
    }
    if (piernas.some(p => !p.compania)) {
      showToast('Completá la compañía aérea de todos los tramos.', true);
      return;
    }

    // Evita reservas duplicadas: mismo pasajero + mismo vuelo + misma fecha de viaje.
    // Compara nombre, apellido, numero de vuelo y fecha para que no se dupliquen alertas.
    const dup = findDuplicateReservation(Array.from(_resSelectedPax), piernas, _resEditingId);
    if (dup) {
      showToast(`Ese viaje ya está cargado para ${resPaxSurnames(dup)} (mismo pasajero, vuelo y fecha). No se guardó para evitar alertas duplicadas.`, true);
      return;
    }

    // Aviso de check-in: email opcional (si está, el aviso va SOLO ahí) y
    // adelanto 24/48/72hs (días de anticipación, default 24).
    const alertEmail = (document.getElementById('res-alert-email')?.value || '').trim();
    if (alertEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertEmail)) {
      showToast('El email para el aviso no es válido.', true);
      return;
    }
    const alertHorasAntes = parseInt(document.getElementById('res-alert-horas')?.value, 10) || 24;

    // Resumen denormalizado (db.js recalcula la fecha como mínima de piernas).
    const compania = piernas[0].compania;
    const reservaVuelo = piernas[0].reservaVuelo;
    const data = {
      pnr: pnr || '', reservaVuelo, compania,
      fecha: piernas[0].fecha,
      pasajeros: Array.from(_resSelectedPax),
      pendingPassengers: _resPendingPax,
      piernas,
      alertEmail,
      alertHorasAntes
    };

    try {
      if (_resEditingId) {
        await updateReservation(_resEditingId, data);
        showToast('Check-in actualizado.');
      } else {
        const ref = await addReservation(data);
        showToast('Check-in creado.');
        avisarRequisitosCheckin(ref.id);
      }
      if (piernas.some(p => !p.fecha)) showToast('Guardado. Hay horarios sin confirmar: esos tramos no tendran aviso automatico de check-in.', true);
      closeModal('modal-reservation');
    } catch (err) {
      console.error('Error guardando check-in:', err);
      showToast('No se pudo guardar el check-in.', true);
    }
  };

  // Aplica al formulario del check-in los datos extraídos (de un PNR pegado o de
  // un e-ticket en PDF): setea el PNR, arma los tramos, matchea pasajeros contra
  // la base y arma el HTML de resumen. Devuelve { html } para que el llamador lo
  // muestre en #res-pnr-preview. Compartido por interpretarPNR e interpretarPDFs.
  window.applyInterpretedReservation = function(d) {
    d = d || {};
    if (d.pnrAmadeus) document.getElementById('res-pnr').value = d.pnrAmadeus;
    // Piernas del viaje (N tramos, cada uno con su check-in, aerolínea y ref).
    // Al re-decodificar sobre una reserva en edición, los tramos que conservan
    // vuelo+fecha mantienen su check-in hecho y su marca de alerta enviada
    // (sino, re-decodificar provocaría reenvío del email de check-in).
    if (Array.isArray(d.piernas) && d.piernas.length) {
      const previas = new Map(_resPiernasDraft.map(p => [clavePierna(p), p]));
      _resPiernasDraft = d.piernas.map(p => {
        const fecha = (p.fecha || '').slice(0, 16);
        const previa = previas.get(clavePierna({ ...p, fecha }));
        return {
          fecha,
          ...(p.fechaLocal !== undefined ? {fechaLocal:p.fechaLocal,zonaHoraria:p.zonaHoraria} : {}),
          vuelo: p.vuelo || '',
          origen: p.origen || '',
          destino: p.destino || '',
          escalas: Array.isArray(p.escalas) ? p.escalas : [],
          transitos: Array.isArray(p.transitos) ? p.transitos : [],
          compania: (p.compania || _deriveCompania(p.vuelo)).toUpperCase(),
          reservaVuelo: (p.reservaVuelo || '').toUpperCase(),
          checkin: previa ? !!previa.checkin : false,
          notified: previa ? !!previa.notified : false
        };
      });
    }
    window.renderResPiernasDraft();

    // Matching de pasajeros contra la base
    const { encontrados, noEncontrados } = matchPnrPasajeros(d.pasajeros);
    encontrados.forEach(id => _resSelectedPax.add(id));
    const searchEl = document.getElementById('res-pax-search');
    if (searchEl) searchEl.value = hintPendingSearch();
    window.renderResPaxList(searchEl?.value || '');
    window.renderResSelectedPax();

    // Preview con resumen + no encontrados
    const totalPax = (d.pasajeros || []).length;
    let html = `<div style="background:var(--surface2);border-radius:8px;padding:10px;font-size:12px;">`;
    html += `<div style="margin-bottom:4px;"><strong>${totalPax}</strong> pasajero(s) · <strong>${encontrados.length}</strong> asociado(s) a la base</div>`;
    const tipoLinea = etiquetaTipoViaje(d.tipo, d.piernas);
    if (tipoLinea) html += `<div style="color:var(--text3);margin-bottom:4px;">${esc(tipoLinea)}</div>`;
    if (d.notas) html += `<div style="color:var(--text3);margin-bottom:6px;">${esc(d.notas)}</div>`;
    if (noEncontrados.length) {
      html += `<div style="color:var(--text3);margin-top:4px;">Sin ficha para ${esc(noEncontrados.join(', '))}. Buscalas abajo o guardá el check-in con el nombre del PNR.</div>`;
    }
    html += `</div>`;
    return { html };
  };

  window.interpretarPNR = async function() {
    const rawEl = document.getElementById('res-pnr-raw');
    const statusEl = document.getElementById('res-pnr-status');
    const previewEl = document.getElementById('res-pnr-preview');
    if (!rawEl) return;

    const pnrText = (rawEl.value || '').trim();
    if (!pnrText) { showToast('Pegá primero el PNR de Amadeus.', true); rawEl.focus(); return; }

    const currentUser = auth.currentUser;
    if (!currentUser) { showToast('Sesión expirada. Volvé a ingresar.'); return; }

    if (statusEl) { statusEl.textContent = ''; }
    if (previewEl) previewEl.style.display = 'none';

    const fnUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:8888/.netlify/functions/pnr-checkin'
      : '/.netlify/functions/pnr-checkin';

    // Feedback durante el fetch (hasta 55s): spinner en el botón + texto de
    // estado, ambos botones deshabilitados para evitar un doble disparo.
    const btnPnr = document.getElementById('btn-interpret-pnr');
    const btnAttach = document.getElementById('btn-attach-pdf');
    const btnPnrHtml = btnPnr ? btnPnr.innerHTML : '';
    if (btnPnr) { btnPnr.disabled = true; btnPnr.innerHTML = '<span class="btn-spinner"></span>Decodificando...'; }
    if (btnAttach) btnAttach.disabled = true;
    if (statusEl) { statusEl.textContent = 'Interpretando PNR...'; statusEl.style.color = 'var(--text3)'; }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000);

    try {
      const idToken = await currentUser.getIdToken();
      const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ pnr: pnrText, hoy }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const json = await res.json();

      if (!res.ok || json.error) {
        if (statusEl) { statusEl.textContent = ''; }
        showToast(json.error || 'No se pudo interpretar el PNR.', true);
        return;
      }

      const data = json.data || {};
      const names = parsePnrPassengers(pnrText);
      if (names.length) data.pasajeros = names;
      const { html } = window.applyInterpretedReservation(data);
      if (previewEl) { previewEl.innerHTML = html; previewEl.style.display = 'block'; }
      if (statusEl) { statusEl.textContent = 'PNR interpretado. Revisá los datos antes de guardar.'; statusEl.style.color = 'var(--green)'; }
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Error interpretando PNR:', err);
      if (statusEl) statusEl.textContent = '';
      showToast('No se pudo interpretar el PNR. Verificá tu conexión.', true);
    } finally {
      // Restaurar botones pase lo que pase (éxito, error o timeout).
      if (btnPnr) { btnPnr.disabled = false; btnPnr.innerHTML = btnPnrHtml; }
      if (btnAttach) btnAttach.disabled = false;
    }
  };

  // Lee uno o varios e-tickets en PDF, los manda a pnr-checkin (modo PDF) y
  // autocompleta el formulario con los datos extraídos y mergeados. Los PDFs se
  // leen una sola vez para extraer los datos; no se guardan ni se adjuntan al
  // check-in. Reutiliza applyInterpretedReservation (mismo mapeo que el PNR
  // pegado). Con 1 PDF manda { pdf }; con varios manda { pdfs: [...] } para que
  // el backend los procese en paralelo y mergee a nivel de segmentos.
  window.interpretarPDFs = async function(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const statusEl = document.getElementById('res-pnr-status');
    const previewEl = document.getElementById('res-pnr-preview');
    const validos = files.filter(f => f.type === 'application/pdf' && f.size <= 2_000_000);
    const rechazados = files.length - validos.length;
    if (!validos.length) { showToast('Los archivos deben ser PDF de hasta 2MB.', true); return; }
    if (validos.length > 8) { showToast('Máximo 8 PDFs por vez.', true); return; }
    const totalBytes = validos.reduce((s, f) => s + f.size, 0);
    if (totalBytes > 4_000_000) { showToast('El total de los PDFs supera ~4MB. Adjuntá menos o más chicos.', true); return; }

    const currentUser = auth.currentUser;
    if (!currentUser) { showToast('Sesión expirada. Volvé a ingresar.'); return; }

    const txt = validos.length === 1 ? 'Interpretando e-ticket...' : `Interpretando ${validos.length} e-tickets...`;
    if (statusEl) { statusEl.textContent = txt; statusEl.style.color = 'var(--text3)'; }
    if (previewEl) previewEl.style.display = 'none';

    const fnUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:8888/.netlify/functions/pnr-checkin'
      : '/.netlify/functions/pnr-checkin';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
      const b64s = await Promise.all(validos.map(fileToBase64));
      const idToken = await currentUser.getIdToken();
      const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
      const body = validos.length === 1 ? { pdf: b64s[0], hoy } : { pdfs: b64s, hoy };
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const json = await res.json();

      if (!res.ok || json.error) {
        if (statusEl) { statusEl.textContent = ''; }
        showToast(json.error || 'No se pudo interpretar el e-ticket.', true);
        return;
      }

      const { html } = window.applyInterpretedReservation(json.data || {});
      if (previewEl) { previewEl.innerHTML = html; previewEl.style.display = 'block'; }
      const meta = (json.data || {})._meta || {};
      const okCount = validos.length - (meta.fallados || 0);
      let msg = okCount <= 1
        ? 'E-ticket interpretado. Revisá los datos antes de guardar.'
        : `${okCount} e-tickets interpretados. Revisá los datos antes de guardar.`;
      if (rechazados) msg = `${rechazados} archivo(s) ignorado(s) (no eran PDF o superaban 2MB). ` + msg;
      if (meta.fallados) showToast(`${meta.fallados} PDF no se pudo leer; se procesaron los demás.`, true);
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = 'var(--green)'; }
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Error interpretando e-ticket PDF:', err);
      if (statusEl) statusEl.textContent = '';
      showToast('No se pudo interpretar el e-ticket. Verificá tu conexión.', true);
    }
  };
}

export { storedPiernas, resPiernas, resCompanias, upcomingCheckins, viajesRequisitos, fmtResDate, resPaxSurnames, updateReservationsBadge };
