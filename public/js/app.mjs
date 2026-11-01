import { parsePrice } from './billing-form.mjs';
import { matchItineraryPassengers, mergePendingPassengers } from './pending-passengers.mjs';
import { parsePnrPassengers, isAirlineLocatorName } from './parse-pnr-passengers.mjs';
import { csvField, excelRowToPassenger } from './csv-import.mjs';
import { matchesPassenger } from './passenger-search.mjs';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut, multiFactor } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG, REQUIRE_2FA } from './config.js';
import {
  initDB, setTenantContext, getUserAgency, getAgency, listenPassengers,
  addPassenger, addPassengersBatch, updatePassenger, deletePassenger, isNotified, markNotified,
  listenReservations, addReservation, updateReservation, deleteReservation, deleteReservations,
  getGdsCities, saveGdsCities, markReservationLegsNotified
} from './db.js';
import {
  storeAgencyId, clearStoredAgencyId, applyBranding, parseAgencyAlerts, emailjsParaAlta
} from './tenant.js';
import {
  docStatus, statusBadge, passengerOverallStatus, fmtDate, daysUntil, initials, escStr,
  getPassengerVisas, visaAlertLabel, collectDocumentAlertItems, collectEmailAlertCandidates,
  asistenciaBadge
} from './utils.js';
import { checkinAlertDue, requisitosAlertDue, diasHastaVuelo, proximaFechaVuelo, claveOrdenCheckin, colorDiasViaje, reservationStale, isBirthdayToday, anioART, buildAlertEmail as buildAlertEmailHtml } from './alert-core.mjs';
import { buildSSRStrings, generateNM } from './ssr.js';
import { programaFfn } from './ffn-programs.mjs';
import { nombreAerolinea } from './airlines.mjs';
import { fromStorage, addCity, updateCity, saveCity, editCity, removeCity, persistable, copyValue } from './gds-cities.mjs';
import { reservationViewPassengers, passengerDetailFlags, reservationViewLayout } from './reservation-view.mjs';
import { DIRECT_MESSAGES, findDirectMessage } from './direct-messages.mjs';
import { opcionesPais } from './paises.mjs';
import { alcanzaConDni } from './cabotaje.mjs';
import { generarContrasena } from './contrasena.mjs';
import { venceSesion } from './sesion.mjs';

let _scannerP, _itinerarioP, _travelReqsP;
function loadScanner() { return _scannerP || (_scannerP = import('./scanner.js')); }
function loadItinerario() { return _itinerarioP || (_itinerarioP = import('./itinerario-pdf.mjs')); }
function loadTravelReqs() { return _travelReqsP || (_travelReqsP = import('./travel-reqs.mjs')); }

function llenarSelectPais(id, extra) {
  const el = document.getElementById(id);
  if (!el) return;
  const actual = el.value;
  el.replaceChildren();
  for (const o of opcionesPais(extra)) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    el.appendChild(opt);
  }
  if ([...el.options].some(o => o.value === actual)) el.value = actual;
}
llenarSelectPais('form-nationality');
llenarSelectPais('form-dni-country');
llenarSelectPais('form-pext-country', { vacio: '— No tiene —' });

// ==================== FIREBASE INIT ====================
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
initDB(app);

// Sesion de 3h desde el ultimo login (regla en sesion.mjs). Vence aunque la
// pestana quede abierta: se chequea cada minuto y al volver a la pestana (con
// la Mac dormida los timers se frenan). Despues hay que entrar con 2FA de nuevo.
let _venceSesion = Infinity;
let _cerrandoSesion = false;

async function cerrarSiVencio() {
  if (_cerrandoSesion || Date.now() < _venceSesion) return false;
  _cerrandoSesion = true;
  clearStoredAgencyId();
  await signOut(auth);
  window.location.href = './login.html?reason=expired';
  return true;
}

setInterval(cerrarSiVencio, 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) cerrarSiVencio();
});

window.addEventListener('unhandledrejection', event => {
  console.error('Promesa rechazada sin catch:', event.reason);
});
window.addEventListener('error', event => {
  console.error('Error no capturado:', event.error || event.message);
});

let passengers = [];
let reservations = [];
let currentEditId = null;
let currentDocFilter = 'all';

// ==================== CONFIG POR AGENCIA (Firestore) ====================
let alertConfig = {
  email: '',
  emailjsPublicKey: '',
  emailjsServiceId: '',
  emailjsTemplateId: '',
};
let appName = 'TravelDocs';
let agencyName = '';
let currentUserRole = null;   // claim 'role' del JWT (owner|admin|agent)
let isPlatformAdmin = false;  // claim platformAdmin del JWT

let _alertsCheckedThisSession = false;
let _paxLoaded = false;
let _resLoaded = false;

// ── Alerta por email unificado (fallback cliente) ────────────
// El envío principal es la scheduled function send-alerts.cjs (Netlify,
// 9:00 AM ART, independiente de sesión). Acá cubrimos "la app se abre antes
// de la corrida o el server falló": al llegar los dos snapshots (pasajeros
// y reservas) se chequea si falta enviar algo y sale en el momento.
//
// UN solo email por destinatario con secciones Vencimientos | Check Ins |
// Cumpleaños (asunto dinámico). Los check-ins con alertEmail propio van en
// un email individual SOLO a ese email (no aparecen en el unificado de la
// agencia).
//
// Dedup compartido con el server (el que llega primero marca): colección
// notifications/{key} para vencimientos, birthdayNotifiedYear para
// cumpleaños, piernas[].notified para check-ins.
async function checkAndSendUnifiedAlerts() {
  if (!_paxLoaded || !_resLoaded) return;
  const { emailjsPublicKey, emailjsServiceId, emailjsTemplateId, email } = alertConfig;
  if (!emailjsPublicKey || !emailjsServiceId || !emailjsTemplateId) {
    console.warn('[Alertas] Config EmailJS incompleta en agencies/{id}.alerts, se omite el chequeo.');
    return;
  }
  if (_alertsCheckedThisSession) return;
  _alertsCheckedThisSession = true;

  const now = Date.now();

  // Vencimientos: dentro de la ventana (180 días, asistencias 30) y sin
  // marca en notifications. Clave passengerId+docType+expDate: cada
  // vencimiento se notifica UNA sola vez; si renuevan, la clave cambia.
  let toNotify = [];
  try {
    const candidates = collectEmailAlertCandidates(passengers, now);
    const already = await Promise.all(candidates.map(e => isNotified(e.key)));
    toNotify = candidates.filter((_, i) => !already[i]).sort((a, b) => a.days - b.days);
  } catch (err) {
    console.warn('[Alertas] No se pudo leer notifications:', err?.message || err);
  }

  // Cumpleaños de hoy sin marcar el año (año calendario argentino).
  const year = anioART(now);
  const bdCandidates = passengers
    .filter(p => isBirthdayToday(p, now) && (!p.birthdayNotifiedYear || p.birthdayNotifiedYear !== year))
    .map(p => ({ p, name: `${p.lastname}, ${p.firstname}`, dob: p.dob }));

  // Check-ins due según el adelanto de cada reserva (24/48/72hs = días de
  // anticipación), sin check-in hecho y sin notificar. Agrupados por
  // destinatario: alertEmail de la reserva o inbox de la agencia.
  const grupos = new Map(); // email destino -> [{ r, idx, vuelo, route, fecha, reservaVuelo }]
  for (const r of reservations) {
    const to = (r.alertEmail || '').trim() || email;
    if (!to) continue;
    const horas = [24, 48, 72].includes(Number(r.alertHorasAntes)) ? Number(r.alertHorasAntes) : 24;
    for (const p of resPiernas(r)) {
      if (p.done || p.notified) continue;
      if (!checkinAlertDue(p.fecha, horas, now)) continue;
      if (!grupos.has(to)) grupos.set(to, []);
      grupos.get(to).push({ r, idx: p.idx, vuelo: p.vuelo, route: p.route, fecha: p.fecha, reservaVuelo: p.reservaVuelo });
    }
  }

  const checkinsAgencia = email ? (grupos.get(email) || []) : [];
  const destinos = new Set(grupos.keys());
  const individuales = [];
  for (const to of destinos) {
    if (email && to === email) continue; // ya van en el unificado
    individuales.push({ to, items: grupos.get(to) || [] });
  }

  if (!toNotify.length && !bdCandidates.length && !checkinsAgencia.length && !individuales.length) {
    console.log('[Alertas] Nada pendiente de enviar (vencimientos: 0, cumpleaños: 0, check-ins: 0).');
    return;
  }


  // Marca piernas[].notified agrupando por reserva (un solo update por doc:
  // marcar tramos del mismo doc en updates separados pierde marcas).
  const marcarPiernas = async items => {
    const porReserva = new Map();
    items.forEach(x => {
      if (!porReserva.has(x.r.id)) porReserva.set(x.r.id, { r: x.r, idxs: [] });
      porReserva.get(x.r.id).idxs.push(x.idx);
    });
    await Promise.all([...porReserva.values()].map(({ r, idxs }) => {
      const piernas = storedPiernas(r);
      return markReservationLegsNotified(r.id, idxs.map(i => piernas[i]).filter(Boolean));
    }));
  };

  const itemCheckin = x => ({ pax: resPaxSurnames(x.r), paxCount: (x.r.pasajeros || []).length, vuelo: x.vuelo, ruta: x.route, fecha: x.fecha, ref: x.reservaVuelo });

  try {
    const ejs = await import('https://cdn.jsdelivr.net/npm/@emailjs/browser@4/+esm');
    const ejsLib = ejs.default || ejs;
    ejsLib.init({ publicKey: emailjsPublicKey });
    const enviar = (to, subject, html) => ejsLib.send(emailjsServiceId, emailjsTemplateId, { to_email: to, subject, message: html });

    // 1) Individuales PRIMERO: si uno falla, esa pierna no se marca y
    //    reintenta (próxima corrida del server / próximo snapshot). Gap entre
    //    envíos: EmailJS limita a 1 request/segundo.
    for (const { to, items } of individuales) {
      const { subject, html } = buildAlertEmailHtml({
        appName: agencyName || appName,
        checkins: items.map(itemCheckin),
      });
      try {
        await enviar(to, subject, html);
        await new Promise(r => setTimeout(r, 1100));
        if (items.length) await marcarPiernas(items);
        console.log(`[Alertas] Email individual enviado OK a ${to} (${items.length} check-in).`);
      } catch (err) {
        console.warn(`[Alertas] Falló el email individual a ${to}:`, err?.message || err);
      }
    }

    // 2) Unificado al inbox de la agencia (si hay algo para ella).
    if (email && (toNotify.length || checkinsAgencia.length || bdCandidates.length)) {
      const { subject, html } = buildAlertEmailHtml({
        appName: agencyName || appName,
        vencimientos: toNotify,
        checkins: checkinsAgencia.map(itemCheckin),
        cumpleanos: bdCandidates,
      });
      await enviar(email, subject, html);
      console.log('[Alertas] Email unificado enviado OK:', subject);

      // Marcas solo tras envío exitoso.
      await Promise.all([
        ...toNotify.map(e => markNotified(e.key)),
        ...bdCandidates.map(e => updatePassenger(e.p.id, { birthdayNotifiedYear: year })),
      ]);
      if (checkinsAgencia.length) await marcarPiernas(checkinsAgencia);
    }
  } catch (err) {
    _alertsCheckedThisSession = false; // reintenta en el próximo snapshot
    console.warn('[Alertas] No se pudo enviar el email unificado:', err?.message || err);
  }
}

// Escapa HTML para prevenir XSS al renderizar datos de pasajeros
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Mensaje directo: modal unico para el usuario cuyo email coincide, una sola
// vez por navegador (flag en localStorage). Lista en js/direct-messages.mjs.
function maybeShowDirectMessage(email) {
  const msg = findDirectMessage(DIRECT_MESSAGES, email);
  if (!msg) return;
  const seenKey = `dm_seen_${msg.id}`;
  if (localStorage.getItem(seenKey)) return;
  localStorage.setItem(seenKey, '1');
  document.getElementById('direct-message-title').textContent = msg.title || '';
  document.getElementById('direct-message-body').innerHTML = `
    ${msg.paragraphs.map(p => `<p style="font-size:14px;color:var(--text2);line-height:1.6;margin:0 0 10px;">${p}</p>`).join('')}
    <p style="font-size:14px;margin:16px 0 0;">${esc(msg.signature[0])}</p>
    <p style="font-size:12px;color:var(--text3);">${esc(msg.signature[1])}</p>`;
  openModal('modal-direct-message');
}

// Autorización multi-tenant: users/{uid} + validación en netlify/functions/_auth.cjs
onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = './login.html';
    return;
  }

  // 2FA: si está habilitado y no tiene factor enrolado, no entra a la app.
  if (REQUIRE_2FA && multiFactor(user).enrolledFactors.length === 0) {
    await signOut(auth);
    window.location.href = './login.html?reason=need2fa';
    return;
  }

  // Sesion de 3h: el token forzado trae iat del server (ver sesion.mjs).
  const freshToken = await user.getIdTokenResult(true);
  if (REQUIRE_2FA && freshToken.claims.firebase?.sign_in_second_factor !== 'totp') {
    clearStoredAgencyId();
    await signOut(auth);
    window.location.href = './login.html?reason=verify2fa';
    return;
  }
  _venceSesion = venceSesion(freshToken.claims, Date.now());
  if (await cerrarSiVencio()) return;

  const tenantId = await getUserAgency(user.uid);
  if (!tenantId) {
    clearStoredAgencyId();
    await signOut(auth);
    window.location.href = './login.html?error=unauthorized';
    return;
  }

  const agency = await getAgency(tenantId);
  if (!agency || (agency.status && agency.status !== 'active')) {
    clearStoredAgencyId();
    await signOut(auth);
    window.location.href = './login.html?error=unauthorized';
    return;
  }

  storeAgencyId(tenantId);
  setTenantContext(tenantId);
  // Tráfico interno en GA4 (parámetro oficial traffic_type): el uso diario de
  // la agencia dueña no contamina métricas. sessionStorage cubre las próximas
  // cargas (analytics.js lo lee antes del config); el gtag('set') cubre los
  // eventos de esta sesión que ya arrancó.
  if (tenantId === 'trading-travel') {
    try { sessionStorage.setItem('td_internal', '1'); } catch { /* storage no disponible */ }
    if (window.gtag) window.gtag('set', 'traffic_type', 'internal');
  }
  alertConfig = parseAgencyAlerts(agency);
  appName = agency.branding?.appName || 'TravelDocs';
  agencyName = (agency.name || '').trim();
  applyBranding(agency.branding);

  // Visibilidad de Administración según claim platformAdmin del JWT.
  try {
    const tokenResult = await user.getIdTokenResult();
    currentUserRole = tokenResult.claims?.role || null;
    isPlatformAdmin = tokenResult.claims?.platformAdmin === true;
    if (isPlatformAdmin) {
      document.getElementById('nav-admin').style.display = '';
    }
  } catch (err) {
    console.warn('[admin] No se pudo leer claim platformAdmin:', err?.message || err);
  }

  // Mostrar datos de usuario en sidebar
  const emailEl = document.getElementById('user-email');
  const avatarEl = document.getElementById('user-avatar');
  if (emailEl) emailEl.textContent = user.email;
  if (avatarEl) avatarEl.textContent = (user.email || 'U')[0].toUpperCase();

  // Arrancar listener de Firestore (scoped por agencyId)
  listenPassengers(data => {
    passengers = data;
    refreshCurrentView();
    updateAlertBadge();
    // Ocultar loading (fade-out + scale)
    const loader = document.getElementById('app-loading');
    if (loader) {
      loader.classList.add('is-hidden');
      setTimeout(() => { loader.style.display = 'none'; }, 450);
    }
    document.getElementById('app-root').style.display = 'flex';
    // Mensaje directo (una sola vez) para el usuario que entra
    maybeShowDirectMessage(user.email);
    // Chequeo de alertas cuando llegaron AMBOS snapshots (pasajeros y reservas)
    _paxLoaded = true;
    checkAndSendUnifiedAlerts();
  });
  listenReservations(data => {
    reservations = data;
    // Limpieza automática: los check-ins cuyo último tramo voló ayer o antes
    // se borran solos (regla en reservationStale, testeada en alerts.test.mjs).
    const stale = data.filter(r => reservationStale(resPiernas(r))).map(r => r.id);
    if (stale.length) {
      deleteReservations(stale).catch(err => console.warn('[Check-ins] Limpieza automática falló:', err?.message || err));
    }
    refreshCurrentView();
    updateReservationsBadge();
    updateAlertBadge();
    _resLoaded = true;
    checkAndSendUnifiedAlerts();
  });
});

window.handleLogout = async function() {
  clearStoredAgencyId();
  await signOut(auth);
  window.location.href = './login.html';
};

// ==================== VISTAS ====================
const viewTitles = {
  dashboard: 'Dashboard',
  passengers: 'Pasajeros',
  reservations: 'Check ins',
  documents: 'Documentos',
  alerts: 'Alertas de vencimiento',
  import: 'Importación masiva',
  travel: 'Requisitos de Vuelo',
  security: 'Seguridad',
  cities: 'Ciudades',
  admin: 'Administración'
};

window.showView = function(v) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.remove('active');
    el.removeAttribute('aria-current');
  });
  document.getElementById('view-' + v)?.classList.add('active');
  const navBtn = document.querySelector(`.nav-item[data-view="${v}"]`);
  if (navBtn) { navBtn.classList.add('active'); navBtn.setAttribute('aria-current', 'page'); }
  document.getElementById('topbar-title').textContent = viewTitles[v] || v;
  // En Administración ocultamos el buscador y el botón "Nuevo pasajero" del topbar
  const topbarActions = document.querySelector('.topbar-actions');
  if (topbarActions) topbarActions.style.visibility = (v === 'admin' || v === 'cities') ? 'hidden' : '';
  if (window.innerWidth <= 900) toggleSidebar(false);
  // Al irse de Pasajeros, borramos el texto del buscador para que no persista en el topbar.
  if (v !== 'passengers') {
    const searchInput = document.getElementById('global-search');
    if (searchInput && searchInput.value) searchInput.value = '';
  }
  if (v !== 'alerts') {
    _alertsCritOpen = false;
    _alertsWarnOpen = false;
    _alertsReqOpen = false;
    _alertsSixOpen = false;
    _alertsBdOpen = false;
  }
  if (v === 'dashboard') renderDashboard();
  if (v === 'passengers') renderPassengers();
  if (v === 'reservations') renderReservations();
  if (v === 'documents') renderDocuments();
  if (v === 'alerts') renderAlerts();
  if (v === 'import') { loadXlsx(); loadScanner(); }
  if (v === 'travel') loadTravelReqs();
  if (v === 'security') renderSecurity();
  if (v === 'cities') loadGdsCities();
  if (v === 'admin') renderAdmin();
};

// Drawer móvil
window.toggleSidebar = function(force) {
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('sidebar-backdrop');
  const btn = document.getElementById('btn-hamburger');
  const open = force === undefined ? !sb.classList.contains('open') : force;
  sb.classList.toggle('open', open);
  bd.classList.toggle('open', open);
  btn?.setAttribute('aria-expanded', String(open));
  btn?.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
};
document.getElementById('sidebar-backdrop')?.addEventListener('click', () => window.toggleSidebar(false));
document.getElementById('btn-hamburger')?.addEventListener('click', () => window.toggleSidebar());
document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => window.showView(btn.dataset.view));
});
document.querySelector('.btn-logout')?.addEventListener('click', () => window.handleLogout());
document.querySelector('.topbar .btn.btn-primary[aria-label="Nuevo pasajero"]')?.addEventListener('click', () => window.openNewPassenger());
document.getElementById('global-search')?.addEventListener('input', e => window.globalSearch(e.target.value));
document.querySelectorAll('#view-dashboard [data-view]').forEach(btn => {
  btn.addEventListener('click', () => window.showView(btn.dataset.view));
});
document.getElementById('import-dropzone')?.addEventListener('click', () => document.getElementById('import-file-input')?.click());
document.getElementById('import-dropzone')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    document.getElementById('import-file-input')?.click();
  }
});
document.getElementById('import-dropzone')?.addEventListener('dragover', e => {
  e.preventDefault();
  e.currentTarget.style.background = 'var(--accent-light)';
});
document.getElementById('import-dropzone')?.addEventListener('dragleave', e => {
  e.currentTarget.style.background = '';
});
document.getElementById('import-dropzone')?.addEventListener('drop', e => {
  e.preventDefault();
  e.currentTarget.style.background = '';
  handleImportDrop(e);
});
document.getElementById('import-file-input')?.addEventListener('change', e => window.handleImportFiles(e));
document.getElementById('import-excel-btn')?.addEventListener('click', () => document.getElementById('import-excel-input')?.click());
document.getElementById('import-excel-input')?.addEventListener('change', e => window.handleExcelImport(e));
document.getElementById('passengers-new-btn')?.addEventListener('click', () => window.openNewPassenger());
document.getElementById('filter-status')?.addEventListener('change', () => window.renderPassengers());
document.querySelectorAll('#doc-tabs .tab').forEach(btn => {
  btn.addEventListener('click', () => window.setDocFilter(btn.dataset.docFilter, btn));
});
document.getElementById('btn-mode-single')?.addEventListener('click', () => window.setTravelMode('single'));
document.getElementById('btn-mode-gds')?.addEventListener('click', () => window.setTravelMode('gds'));
document.getElementById('btn-mode-pdf')?.addEventListener('click', () => window.setTravelMode('pdf'));
document.getElementById('btn-pdf-itinerario')?.addEventListener('click', () => document.getElementById('tv-pdf-file')?.click());
document.getElementById('tv-pdf-file')?.addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  window.leerItinerarioPdf(file);
});
document.getElementById('pdf-dropzone')?.addEventListener('dragover', e => {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
});
document.getElementById('pdf-dropzone')?.addEventListener('dragleave', e => {
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
  e.currentTarget.classList.remove('drag-over');
});
document.getElementById('pdf-dropzone')?.addEventListener('drop', e => {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer?.files || []);
  const file = files.find(f => /\.pdf$/i.test(f.name)) || files[0];
  window.leerItinerarioPdf(file);
});
document.getElementById('btn-interpret-pnr')?.addEventListener('click', () => window.interpretarPNR());
document.getElementById('btn-attach-pdf')?.addEventListener('click', () => document.getElementById('res-pdf-input')?.click());
document.getElementById('res-pdf-input')?.addEventListener('change', e => {
  const files = Array.from(e.target.files || []);   // capturar antes de resetear
  e.target.value = '';   // permite re-elegir los mismos archivos
  window.interpretarPDFs(files);
});
document.getElementById('res-compania')?.addEventListener('input', e => {
  window.onCompaniaInput(e.target);
  _propagateTopToDraft();
});
document.getElementById('res-reserva-vuelo')?.addEventListener('input', _propagateTopToDraft);
document.getElementById('tv-origen')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
document.getElementById('tv-destino')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
document.getElementById('tv-gds-text')?.addEventListener('input', () => window.parsearGDS());
document.getElementById('tv-vuelo')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
document.getElementById('tv-btn-consultar')?.addEventListener('click', () => window.consultarVuelo());
document.getElementById('tv-btn-reset')?.addEventListener('click', () => window.resetTravelView());
document.getElementById('btn-import-cancel')?.addEventListener('click', () => window.resetImport());
document.getElementById('btn-import-save')?.addEventListener('click', () => window.saveImportedPassengers());
document.getElementById('modal-passenger-close-btn')?.addEventListener('click', () => window.closeModal('modal-passenger'));
document.getElementById('modal-passenger-cancel-btn')?.addEventListener('click', () => window.closeModal('modal-passenger'));
document.getElementById('btn-save-passenger')?.addEventListener('click', () => window.savePassenger());
document.getElementById('reservations-new-btn')?.addEventListener('click', () => window.openNewReservation());
document.getElementById('modal-reservation-close-btn')?.addEventListener('click', () => window.closeModal('modal-reservation'));
document.getElementById('modal-reservation-cancel-btn')?.addEventListener('click', () => window.closeModal('modal-reservation'));
document.getElementById('res-view-close-btn')?.addEventListener('click', () => window.closeModal('modal-reservation-view'));
document.getElementById('res-view-edit-btn')?.addEventListener('click', () => {
  const id = window._viewReservationId;
  window.closeModal('modal-reservation-view');
  if (id) window.openEditReservation(id);
});
document.getElementById('btn-save-reservation')?.addEventListener('click', () => window.saveReservation());
document.getElementById('res-pax-search')?.addEventListener('input', e => window.renderResPaxList(e.target.value));
document.getElementById('reservations-search')?.addEventListener('input', () => window.renderReservations());
document.getElementById('res-add-pierna')?.addEventListener('click', () => {
  const c = (document.getElementById('res-compania')?.value || '').trim().toUpperCase();
  const rv = (document.getElementById('res-reserva-vuelo')?.value || '').trim().toUpperCase();
  _resPiernasDraft.push({ fecha: '', vuelo: '', origen: '', destino: '', escalas: [], compania: c, reservaVuelo: rv, checkin: false });
  window.renderResPiernasDraft();
});
document.getElementById('scan-other-passengers-btn')?.addEventListener('click', () => window.addDetectedOtherPassengers());
document.getElementById('scan-dropzone')?.addEventListener('click', () => document.getElementById('scan-file')?.click());
document.getElementById('scan-dropzone')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    document.getElementById('scan-file')?.click();
  }
});
document.getElementById('scan-dropzone')?.addEventListener('dragover', e => window.onDragOver(e));
document.getElementById('scan-dropzone')?.addEventListener('dragleave', e => window.onDragLeave(e));
document.getElementById('scan-dropzone')?.addEventListener('drop', e => window.onDrop(e));
document.getElementById('scan-file')?.addEventListener('change', e => window.onFileSelected(e));
document.getElementById('form-lastname')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); });
document.getElementById('form-firstname')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); });
document.getElementById('visa-add-btn')?.addEventListener('click', () => window.addVisaEntry());
document.getElementById('asistencia-add-btn')?.addEventListener('click', () => window.addAsistenciaEntry());
document.getElementById('emergency-add-btn')?.addEventListener('click', () => window.addEmergencyEntry());
document.getElementById('ffn-add-btn')?.addEventListener('click', () => window.addFFNEntry());

document.getElementById('detail-delete-btn')?.addEventListener('click', () => {
  if (window._detailPassengerId) window.confirmDelete(window._detailPassengerId);
});
document.getElementById('modal-detail-close-btn')?.addEventListener('click', () => window.closeModal('modal-detail'));
document.getElementById('modal-search-close-btn')?.addEventListener('click', () => window.closeModal('modal-search'));
document.getElementById('modal-confirm-close-btn')?.addEventListener('click', () => window.closeModal('modal-confirm'));
document.getElementById('modal-confirm-cancel-btn')?.addEventListener('click', () => window.closeModal('modal-confirm'));
document.getElementById('direct-message-close-btn')?.addEventListener('click', () => window.closeModal('modal-direct-message'));
document.getElementById('direct-message-ok-btn')?.addEventListener('click', () => window.closeModal('modal-direct-message'));
document.addEventListener('click', e => {
  const more = e.target.closest('[data-alerts-more]');
  if (!more) return;
  if (more.dataset.alertsMore === 'crit') _alertsCritOpen = !_alertsCritOpen;
  if (more.dataset.alertsMore === 'warn') _alertsWarnOpen = !_alertsWarnOpen;
  if (more.dataset.alertsMore === 'req') _alertsReqOpen = !_alertsReqOpen;
  if (more.dataset.alertsMore === 'six') _alertsSixOpen = !_alertsSixOpen;
  if (more.dataset.alertsMore === 'bd') _alertsBdOpen = !_alertsBdOpen;
  renderAlerts();
});
document.addEventListener('click', e => {
const dismissBtn = e.target.closest('[data-dismiss-alert]');
if (dismissBtn) {
e.stopPropagation();
window.confirmDismissAlert(dismissBtn.dataset.dismissAlert);
return;
}

const editBtn = e.target.closest('[data-open-edit]');
if (editBtn) {
e.stopPropagation();
window.openEdit(editBtn.dataset.openEdit);
return;
}

const deleteBtn = e.target.closest('[data-confirm-delete]');
if (deleteBtn) {
e.stopPropagation();
window.confirmDelete(deleteBtn.dataset.confirmDelete);
return;
}

const copySSR = e.target.closest('[data-copy-ssr]');
if (copySSR) {
e.stopPropagation();
window.copyText(copySSR, copySSR.dataset.copySsr);
return;
}

const removeImport = e.target.closest('[data-remove-import]');
if (removeImport) {
e.stopPropagation();
window.removeImportGroup(Number(removeImport.dataset.removeImport));
return;
}

const selectStop = e.target.closest('[data-select-stop]');
if (selectStop) {
e.stopPropagation();
window.selectTravelStop(Number(selectStop.dataset.selectStop));
return;
}

const stopAction = e.target.closest('[data-no-row-action]');
if (stopAction) return;

const detailRow = e.target.closest('[data-open-detail]');
if (detailRow) {
e.stopPropagation();
const id = detailRow.dataset.openDetail;
window.openDetail(id, { from: detailRow.dataset.from || 'passengers' });
if (detailRow.dataset.closeModal) window.closeModal(detailRow.dataset.closeModal);
}
});
document.addEventListener('keydown', e => {
  const interactive = e.target.closest('[data-open-detail], [data-select-stop], [data-open-reservation]');
  if (!interactive || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  interactive.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('sidebar')?.classList.contains('open')) {
    window.toggleSidebar(false);
  }
});

function refreshCurrentView() {
  const active = document.querySelector('.view.active');
  if (!active) return;
  const v = active.id.replace('view-', '');
  if (v === 'dashboard') renderDashboard();
  if (v === 'passengers') renderPassengers();
  if (v === 'reservations') renderReservations();
  if (v === 'documents') renderDocuments();
  if (v === 'alerts') renderAlerts();
  if (v === 'admin') renderAdmin();
}

// ==================== DASHBOARD ====================
function renderDashboard() {
  const statusCache = new Map(passengers.map(p => [p.id, passengerOverallStatus(p)]));
  const expired = passengers.filter(p => ['expired','critical'].includes(statusCache.get(p.id)));
  const warning = passengers.filter(p => statusCache.get(p.id) === 'warning');
  const ok = passengers.filter(p => statusCache.get(p.id) === 'ok');

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card info"><div class="stat-label">Total pasajeros</div><div class="stat-value">${passengers.length}</div><div class="stat-sub">en base de datos</div></div>
    <div class="stat-card ok"><div class="stat-label">Documentación OK</div><div class="stat-value">${ok.length}</div><div class="stat-sub">todos los docs vigentes</div></div>
    <div class="stat-card warning"><div class="stat-label">Por vencer (90d)</div><div class="stat-value">${warning.length}</div><div class="stat-sub">requieren atención</div></div>
    <div class="stat-card danger"><div class="stat-label">Vencidos / Críticos</div><div class="stat-value">${expired.length}</div><div class="stat-sub">acción urgente</div></div>
  `;

  const reqs = viajesRequisitos().slice(0, 6);
  const urgentItems = getAlertItems().filter(a => a.urgency <= 2).slice(0, Math.max(0, 6 - reqs.length));
  let urgentHTML = '';
  reqs.forEach(v => {
    urgentHTML += `<div class="alert-row" style="cursor:pointer;" role="button" tabindex="0" data-open-reservation="${escStr(v.id)}">
      <div class="alert-dot blue"></div>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:500;">${esc(v.name)}</div>
        <div style="font-size:11px;color:var(--text3);">${esc(v.ruta || 'Sin ruta')} · ${fmtResDate(v.fecha)}</div>
      </div>
      <span class="badge badge-blue">Verifique los requisitos</span>
    </div>`;
  });
  if (!reqs.length && !urgentItems.length) {
    urgentHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">✓ Sin alertas urgentes</div>';
  } else {
    urgentItems.forEach(a => {
      urgentHTML += `<div class="alert-row" style="cursor:pointer;" role="button" tabindex="0" data-open-detail="${escStr(a.pid)}">
        <div class="alert-dot ${a.isBirthday ? 'purple' : 'red'}"></div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:500;">${esc(a.name)}</div>
          <div style="font-size:11px;color:var(--text3);">${a.isBirthday ? `Cumpleaños · ${fmtDate(a.expDate)}` : `${esc(a.docType)} · <span style="font-family:var(--mono);">${esc(a.docNum)}</span>`}</div>
        </div>
        ${a.isBirthday ? birthdayBadge(a.days) : statusBadge(a.expDate)}
        <button class="btn btn-ghost btn-sm" data-dismiss-alert="${escStr(a.dismissKey)}" data-no-row-action="true" title="Eliminar alerta" aria-label="Eliminar alerta">
          Eliminar
        </button>
      </div>`;
    });
  }
  document.getElementById('dash-urgent').innerHTML = urgentHTML;

  const recent = passengers.slice(0, 5);
  let recentHTML = '';
  if (!recent.length) {
    recentHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">Sin pasajeros cargados</div>';
  } else {
    recent.forEach(p => {
      const s = passengerOverallStatus(p);
      const cls = ['expired','critical'].includes(s) ? 'red' : s === 'warning' ? 'amber' : 'green';
      const label = cls === 'red' ? 'Urgente' : cls === 'amber' ? 'Atención' : 'OK';
      recentHTML += `<div class="alert-row" style="cursor:pointer;" role="button" tabindex="0" data-open-detail="${escStr(p.id)}">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--accent-light);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:var(--accent);flex-shrink:0;">${esc(initials(p))}</div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:500;">${esc(p.lastname)}, ${esc(p.firstname)}</div>
          <div style="font-size:11px;color:var(--text3);">${fmtDate(p.dob)} · ${esc(p.nationality)}</div>
        </div>
        <span class="badge badge-${cls}">${label}</span>
      </div>`;
    });
  }
  document.getElementById('dash-recent').innerHTML = recentHTML;

  // Check-ins próximos (24hs)
  const proximos = upcomingCheckins();
  let checkinHTML = '';
  if (!proximos.length) {
    checkinHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">✓ Sin check-ins para hoy o mañana</div>';
  } else {
    checkinHTML = proximos.map(x => `
      <div class="alert-row" style="cursor:pointer;" role="button" tabindex="0" data-open-reservation="${escStr(x.id)}">
        <div class="alert-dot red"></div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:500;">${esc(resPaxSurnames(x.r))} <span style="color:var(--text3);font-weight:400;font-size:12px;">· ${esc(resCompanias(x.r).join(' · ') || '—')}</span></div>
          <div style="font-size:11px;color:var(--text3);">${esc(x.route)} ${fmtResDate(x.fecha)} · ${(x.r.pasajeros||[]).length} pasajero(s)</div>
        </div>
        <span class="badge badge-red">Check-in</span>
      </div>`).join('');
  }
  const dashCheckins = document.getElementById('dash-checkins');
  if (dashCheckins) dashCheckins.innerHTML = checkinHTML;
}

// ==================== LISTA PASAJEROS ====================
window.renderPassengers = function() {
  const filter = document.getElementById('filter-status')?.value || '';
  const search = document.getElementById('global-search')?.value?.toLowerCase() || '';

  let list = passengers.filter(p => {
    const matchSearch = matchesPassenger(p, search);
    const s = passengerOverallStatus(p);
    const matchFilter = !filter ||
      (filter === 'ok' && s === 'ok') ||
      (filter === 'warning' && s === 'warning') ||
      (filter === 'expired' && ['expired','critical'].includes(s));
    return matchSearch && matchFilter;
  });

  document.getElementById('passengers-count').textContent =
    `${list.length} pasajero${list.length !== 1 ? 's' : ''} encontrado${list.length !== 1 ? 's' : ''}`;

  if (!list.length) {
    document.getElementById('passengers-tbody').innerHTML =
      `<tr><td colspan="8"><div class="empty-state"><div class="empty-title">No hay pasajeros</div><div style="font-size:12px;">Creá uno con el botón "Nuevo pasajero"</div></div></td></tr>`;
    return;
  }

  const statusMap = { expired:'badge-red', critical:'badge-red', warning:'badge-amber', ok:'badge-green', nodata:'badge-gray' };
  const statusLabel = { expired:'Vencido', critical:'Crítico', warning:'Por vencer', ok:'OK', nodata:'Sin datos' };

  let html = '';
  list.forEach(p => {
    const s = passengerOverallStatus(p);
    const visasHtml = [p.visa1, p.visa2].filter(v => v?.country).map(v =>
      `<span class="chip">${esc(v.country)}</span>`
    ).join(' ') || '<span style="color:var(--text3)">—</span>';

    html += `<tr style="cursor:pointer;" tabindex="0" role="button" data-open-detail="${escStr(p.id)}">
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:34px;height:34px;border-radius:9px;background:var(--accent-light);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:var(--accent);flex-shrink:0;">${esc(initials(p))}</div>
          <div>
            <div class="name-cell">${esc(p.lastname)}, ${esc(p.firstname)}</div>
            <div style="font-size:11px;color:var(--text3);">${esc(p.nationality)} · ${p.gender === 'M' ? 'Masc.' : 'Fem.'}</div>
          </div>
        </div>
      </td>
      <td style="font-size:12px;color:var(--text2);">${fmtDate(p.dob)}</td>
      <td>${p.dni?.num ? `<span class="doc-num">${esc(p.dni.num)}</span><br>${statusBadge(p.dni.exp)}` : '<span style="color:var(--text3)">—</span>'}</td>
      <td>${p.parg?.num ? `<span class="doc-num">${esc(p.parg.num)}</span><br>${statusBadge(p.parg.exp)}` : '<span style="color:var(--text3)">—</span>'}</td>
      <td>${p.pext?.country && p.pext?.num ? `<span class="chip">${esc(p.pext.country)}</span> <span class="doc-num">${esc(p.pext.num)}</span>` : '<span style="color:var(--text3)">—</span>'}</td>
      <td>${visasHtml}</td>
      <td><span class="badge ${statusMap[s]}">${statusLabel[s]}</span></td>
      <td data-no-row-action="true">
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm btn-icon" data-open-edit="${escStr(p.id)}" aria-label="Editar pasajero" title="Editar">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/></svg>
          </button>
          <button class="btn btn-danger btn-sm" data-confirm-delete="${escStr(p.id)}" aria-label="Eliminar pasajero" title="Eliminar pasajero">
            Eliminar
          </button>
        </div>
      </td>
    </tr>`;
  });
  document.getElementById('passengers-tbody').innerHTML = html;
};

// ==================== DOCUMENTOS ====================
window.setDocFilter = function(f, btn) {
  currentDocFilter = f;
  document.querySelectorAll('#doc-tabs .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderDocuments();
};

function renderDocuments() {
  let rows = [];
  passengers.forEach(p => {
    const name = `${p.lastname}, ${p.firstname}`;
    if (p.dni?.num) rows.push({ pid:p.id, name, type:'dni', country:p.dni.country || 'ARG', num:p.dni.num, issue:p.dni.issue, exp:p.dni.exp });
    if (p.parg?.num) rows.push({ pid:p.id, name, type:'passport_arg', country:'ARG', num:p.parg.num, issue:p.parg.issue, exp:p.parg.exp });
    if (p.pext?.country && p.pext?.num) rows.push({ pid:p.id, name, type:'passport_ext', country:p.pext.country, num:p.pext.num, issue:p.pext.issue, exp:p.pext.exp });
    getPassengerVisas(p).forEach(v => {
      rows.push({
        pid: p.id, name,
        type: 'visa',
        displayType: visaAlertLabel(v),
        country: v.country,
        num: v.num,
        issue: v.issue,
        exp: v.exp
      });
    });
    if (Array.isArray(p.asistencias)) {
      p.asistencias.forEach(a => {
        if (a.num || a.fin) rows.push({ 
          pid:p.id, name, 
          type:'asistencia', 
          country: a.compania || '—', 
          num:a.num, 
          issue:a.inicio, 
          exp:a.fin,
          producto: a.producto || '',
          cobertura: a.cobertura || ''
        });
      });
    }
  });

  if (currentDocFilter !== 'all') rows = rows.filter(r => r.type === currentDocFilter);
  rows.sort((a,b) => { const da = daysUntil(a.exp) ?? 9999, db = daysUntil(b.exp) ?? 9999; return da - db; });

  const typeLabels = { dni:'DNI', passport_arg:'Pasaporte ARG', passport_ext:'Pas. Extranjero', visa:'Visa', asistencia:'Asistencia Médica' };

  if (!rows.length) {
    document.getElementById('documents-tbody').innerHTML =
      `<tr><td colspan="7"><div class="empty-state"><div class="empty-title">Sin documentos</div></div></td></tr>`;
    return;
  }

  let html = '';
  rows.forEach(r => {
    if (r.type === 'asistencia') {
      html += `<tr style="cursor:pointer;" tabindex="0" role="button" data-open-detail="${escStr(r.pid)}">
        <td><span style="font-weight:500;">${esc(r.name)}</span></td>
        <td><span class="badge badge-gray">${typeLabels[r.type]}</span></td>
        <td><span class="chip">${esc(r.country)}</span></td>
        <td><span class="doc-num">${esc(r.num || '—')}</span>${r.producto ? `<br><small>${esc(r.producto)}</small>` : ''}${r.cobertura ? `<br><small>${esc(r.cobertura)}</small>` : ''}</td>
        <td style="font-size:12px;color:var(--text2);">${fmtDate(r.issue)}</td>
        <td style="font-size:12px;">${fmtDate(r.exp)}</td>
        <td>${asistenciaBadge(r.exp)}</td>
      </tr>`;
    } else {
      html += `<tr style="cursor:pointer;" tabindex="0" role="button" data-open-detail="${escStr(r.pid)}">
        <td><span style="font-weight:500;">${esc(r.name)}</span></td>
        <td><span class="badge badge-gray">${esc(r.displayType || typeLabels[r.type])}</span></td>
        <td><span class="chip">${esc(r.country)}</span></td>
        <td><span class="doc-num">${esc(r.num || '—')}</span></td>
        <td style="font-size:12px;color:var(--text2);">${fmtDate(r.issue)}</td>
        <td style="font-size:12px;">${fmtDate(r.exp)}</td>
        <td>${statusBadge(r.exp)}</td>
      </tr>`;
    }
  });
  document.getElementById('documents-tbody').innerHTML = html;
}

// ==================== ALERTAS ====================

// Días hasta el próximo cumpleaños (ignora el año de nacimiento)
function daysUntilBirthday(dob) {
  if (!dob) return null;
  const d = new Date(dob + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (next < todayStart) next.setFullYear(now.getFullYear() + 1);
  return Math.floor((next - todayStart) / 86400000);
}

// Dismiss de alertas: per-usuario via localStorage (cada agente maneja su propio estado)
function isDismissed(key) { return !!localStorage.getItem(key); }
function setDismissed(key) { localStorage.setItem(key, '1'); }

// Badge visual para cumpleaños
function birthdayBadge(days) {
  const label = days === 0 ? '¡Hoy!' : days === 1 ? 'Mañana' : `En ${days}d`;
  return `<span class="badge badge-purple">${label}</span>`;
}

function dismissAlert(key) {
  setDismissed(key);
  renderAlerts();
  updateAlertBadge();
  renderDashboard();
}

window.confirmDismissAlert = function(key) {
  const item = getAlertItems().find(a => a.dismissKey === key);
  const label = item
    ? `${item.name} (${item.isBirthday ? 'cumpleaños' : item.docType})`
    : 'esta alerta';

  showConfirmDialog({
    title: '¡Guardá!',
    message: `Estás por eliminar la alerta de ${label}. ¿Estás seguro?`,
    subtext: 'La alerta dejará de mostrarse. El pasajero no se borra de la base de datos.',
    confirmLabel: 'Sí, eliminar alerta',
    onConfirm: () => dismissAlert(key)
  });
};

function getAlertItems() {
  const items = collectDocumentAlertItems(passengers, isDismissed);
  passengers.forEach(p => {
    const name = `${p.lastname}, ${p.firstname}`;
    const email = p.email || '';
    // Cumpleaños próximos (30 días)
    if (p.dob) {
      const days = daysUntilBirthday(p.dob);
      if (days !== null && days >= 0 && days <= 30) {
        const dismissKey = `dismissed_${p.id}_birthday_${new Date().getFullYear()}`;
        if (!isDismissed(dismissKey)) {
          items.push({ pid: p.id, name, email, docType: 'Cumpleaños', docNum: '—', expDate: p.dob, days, urgency: days <= 7 ? 2 : 3, isBirthday: true, dismissKey });
        }
      }
    }
  });
  return items.sort((a,b) => a.days - b.days);
}

let _alertsCritOpen = false;
let _alertsWarnOpen = false;
let _alertsReqOpen = false;
let _alertsSixOpen = false;
let _alertsBdOpen = false;

function renderAlerts() {
  const items = getAlertItems();
  const critical = items.filter(a => a.urgency <= 2 && !a.isBirthday);
  const warning  = items.filter(a => a.urgency === 3 && !a.isBirthday);
  const sixMonth = items.filter(a => a.urgency === 4 && !a.isBirthday);

  const dismissBtn = a => `<button class="btn btn-ghost btn-sm" title="Eliminar alerta" aria-label="Eliminar alerta"
      data-dismiss-alert="${escStr(a.dismissKey)}" data-no-row-action="true">Eliminar</button>`;

  const renderItem = a => `
    <div class="alert-row" style="cursor:pointer;" role="button" tabindex="0" data-open-detail="${escStr(a.pid)}">
      <div class="alert-dot ${a.isBirthday ? 'purple' : a.urgency <= 2 ? 'red' : a.urgency === 3 ? 'amber' : 'blue'}"></div>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:500;">${esc(a.name)}</div>
        <div style="font-size:11px;color:var(--text3);">${a.isBirthday ? `Cumpleaños · ${fmtDate(a.expDate)}` : `${esc(a.docType)} · <span style="font-family:var(--mono);">${esc(a.docNum)}</span>`}</div>
      </div>
      ${a.isBirthday ? birthdayBadge(a.days) : statusBadge(a.expDate)}
${a.email ? `<a href="mailto:${escStr(a.email)}?subject=${encodeURIComponent(a.isBirthday ? '¡Feliz Cumpleaños!' : 'Renovación de ' + a.docType)}&body=${encodeURIComponent(a.isBirthday ? 'Estimado/a ' + a.name + ',\n\n¡Desde ' + appName + ' le deseamos un muy feliz cumpleaños!\n\nSaludos,\n' + appName : 'Estimado/a ' + a.name + ',\n\nSu ' + a.docType + ' (N° ' + a.docNum + ') vence el ' + fmtDate(a.expDate) + '. Le pedimos que coordine la renovación con anticipación.\n\nSaludos,\n' + appName)}" data-no-row-action="true" title="${a.isBirthday ? 'Enviar saludo de cumpleaños' : 'Enviar mail al pasajero'}" style="color:var(--accent);display:flex;align-items:center;padding:4px;border-radius:6px;flex-shrink:0;">
<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 5.5l6 4 6-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
</a>` : ''}
      ${dismissBtn(a)}
    </div>`;

  const emptyMsg = (msg) => `<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">${msg}</div>`;

  const verMas = (id, open) => `<div style="text-align:right;margin-top:4px;"><button type="button" class="btn btn-ghost btn-sm" data-alerts-more="${id}">${open ? 'Ver menos' : 'Ver todos'}</button></div>`;
  const listaCorta = (items, open, id, fila) => {
    if (items.length <= 5) return items.map(fila).join('');
    const visibles = open ? items : items.slice(0, 5);
    return visibles.map(fila).join('') + verMas(id, open);
  };

  document.getElementById('alerts-critical').innerHTML = critical.length
    ? listaCorta(critical, _alertsCritOpen, 'crit', renderItem) : emptyMsg('✓ Sin alertas críticas');
  document.getElementById('alerts-warning').innerHTML = warning.length
    ? listaCorta(warning, _alertsWarnOpen, 'warn', renderItem) : emptyMsg('✓ Sin documentos por vencer');

  // Sección 6 meses (DNI y Pasaporte): primeras 5, el resto detrás de Ver todos.
  const wrap6 = document.getElementById('alerts-6months');
  if (wrap6) {
    wrap6.innerHTML = sixMonth.length
      ? listaCorta(sixMonth, _alertsSixOpen, 'six', renderItem)
      : emptyMsg('✓ Ningún DNI o Pasaporte vence en los próximos 6 meses');
  }

  const wrapReq = document.getElementById('alerts-requisitos');
  if (wrapReq) {
    const reqs = viajesRequisitos();
    const filaReq = v => `
      <div class="alert-row" style="cursor:pointer;" role="button" tabindex="0" data-open-reservation="${escStr(v.id)}">
        <div class="alert-dot blue"></div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:500;">${esc(v.name)}</div>
          <div style="font-size:11px;color:var(--text3);">${esc(v.ruta || 'Sin ruta')} · ${fmtResDate(v.fecha)}</div>
        </div>
      </div>`;
    wrapReq.innerHTML = reqs.length
      ? listaCorta(reqs, _alertsReqOpen, 'req', filaReq)
      : emptyMsg('✓ Sin viajes para verificar');
  }

  // Sección cumpleaños: primeras 5, el resto detrás de Ver todos.
  const wrapBd = document.getElementById('alerts-birthdays');
  if (wrapBd) {
    const birthdays = items.filter(a => a.isBirthday);
    wrapBd.innerHTML = birthdays.length
      ? listaCorta(birthdays, _alertsBdOpen, 'bd', renderItem)
      : emptyMsg('✓ Sin cumpleaños en los próximos 30 días');
  }
}

function updateAlertBadge() {
  const count = getAlertItems().filter(a => a.urgency <= 2).length;
  const badge = document.getElementById('alert-badge');
  if (count > 0) { badge.textContent = count; badge.style.display = 'inline-flex'; }
  else { badge.style.display = 'none'; }
}

// ==================== DETALLE PASAJERO ====================
// GDS elegido para generar strings SSR en el perfil del pasajero (persiste la última elección)
function currentSSRGds() { return localStorage.getItem('td_ssr_gds') || 'amadeus'; }

// Render de la lista de strings SSR para un GDS dado (usado en openDetail y al cambiar el select)
function renderSSRItems(p, gds) {
  const items = buildSSRStrings(p, '1', '1', null, { gds }).filter(s => s.value);
  if (!items.length) return '<div style="font-size:13px;color:var(--text3);">Sin documentos cargados.</div>';
  return items.map(s => `<div style="background:var(--surface2);border-radius:8px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">${esc(s.label)}</div>
        <code style="font-size:11.5px;font-family:var(--mono);color:var(--text);word-break:break-all;">${esc(s.value)}</code>
        ${s.label.includes('Email') && p.email && /[_-]/.test(p.email) ? '<div style="font-size:10px;color:var(--text3);margin-top:3px;">Email codificado para GDS (_ → .. y - → ./, estándar IATA).</div>' : ''}
      </div>
      <button class="copy-btn" style="flex-shrink:0;" data-copy-ssr="${escStr(s.value)}" data-no-row-action="true">copiar</button>
    </div>`).join('');
}

// Cambiar el GDS del selector: persiste y re-renderiza solo la lista SSR del modal abierto
window.changeSSRGds = function(value) {
  localStorage.setItem('td_ssr_gds', value);
  const p = passengers.find(x => x.id === window._detailPassengerId);
  if (!p) return;
  const list = document.getElementById('ssr-items-list');
  if (list) list.innerHTML = renderSSRItems(p, value);
};

window.openDetail = function(id, opts = {}) {
  const p = passengers.find(x => x.id === id);
  if (!p) return;
  const flags = passengerDetailFlags(opts.from);
  const gds = currentSSRGds();

  window._detailPassengerId = p.id;
  document.getElementById('detail-title').textContent = `${p.lastname}, ${p.firstname}`;
  const editBtn = document.getElementById('detail-edit-btn');
  const delBtn = document.getElementById('detail-delete-btn');
  if (editBtn) {
    editBtn.style.display = flags.includeActions ? '' : 'none';
    editBtn.onclick = flags.includeActions
      ? () => { openEdit(p.id); closeModal('modal-detail'); }
      : null;
  }
  if (delBtn) delBtn.style.display = flags.includeActions ? '' : 'none';

  const age = Math.floor((new Date() - new Date(p.dob + 'T00:00:00')) / (365.25 * 86400000));

  const docCard = (title, num, issue, exp, country) => {
    if (!num) return '';
    const days = daysUntil(exp);
    return `<div class="doc-card">
      <div class="doc-card-header">
        <span class="doc-type-label">${esc(title)}${country ? ' · ' + esc(country) : ''}</span>
        ${statusBadge(exp)}
      </div>
      <div class="doc-number">${esc(num)}</div>
      <div class="doc-dates">
        <span>Emisión: ${fmtDate(issue)}</span>
        <span>Vence: ${fmtDate(exp)}</span>
        ${exp && days !== null ? `<span style="color:${days < 90 ? 'var(--red)' : 'var(--text3)'};">${days < 0 ? 'Vencido hace ' + Math.abs(days) + 'd' : days + ' días restantes'}</span>` : ''}
      </div>
    </div>`;
  };

  let html = `<div class="detail-grid">
    <div class="detail-sidebar">
      <div class="card" style="padding:20px;">
        <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:16px;">
          <div class="avatar-large">${esc(initials(p))}</div>
          <div>
            <div style="font-size:17px;font-weight:600;">${esc(p.lastname)}</div>
            <div style="font-size:14px;color:var(--text2);">${esc(p.firstname)}</div>
            <div style="margin-top:8px;">${getOverallBadge(p)}</div>
          </div>
        </div>
        <div>
          <div class="info-row"><span class="info-label">Nacimiento</span><span class="info-value">${fmtDate(p.dob)}</span></div>
          <div class="info-row"><span class="info-label">Edad</span><span class="info-value">${age} años</span></div>
          <div class="info-row"><span class="info-label">Sexo</span><span class="info-value">${p.gender === 'M' ? 'Masculino' : 'Femenino'}</span></div>
          <div class="info-row"><span class="info-label">Nacionalidad</span><span class="info-value">${esc(p.nationality)}</span></div>
          ${p.email ? `<div class="info-row"><span class="info-label">Email</span><span class="info-value" style="font-size:12px;">${esc(p.email)}</span></div>` : ''}
          ${p.whatsapp ? `<div class="info-row"><span class="info-label">WhatsApp</span><span class="info-value" style="font-size:12px;">${esc(p.whatsapp)}</span></div>` : ''}
          ${emergencyContactsOf(p).map(c => `<div class="info-row"><span class="info-label">Emergencia</span><span class="info-value">${esc([c.name, c.relationship, c.phone].filter(Boolean).join(' · '))}</span></div>`).join('')}
          ${p.notes ? `<div class="info-row"><span class="info-label">Notas</span><span class="info-value" style="font-size:12px;color:var(--text2);">${esc(p.notes)}</span></div>` : ''}
        </div>
      </div>
    </div>
    <div class="detail-main">
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${docCard('DNI', p.dni?.num, p.dni?.issue, p.dni?.exp, p.dni?.country || 'ARG')}
        ${docCard('Pasaporte', p.parg?.num, p.parg?.issue, p.parg?.exp, 'ARG')}
        ${p.pext?.country ? docCard('Pasaporte', p.pext?.num, p.pext?.issue, p.pext?.exp, p.pext.country) : ''}
        ${(p.visas && p.visas.length ? p.visas : [p.visa1, p.visa2]).filter(v => v?.country || v?.num).map(v => `
          <div class="doc-card">
            <div class="doc-card-header"><span class="doc-type-label">${v.type === 'E' ? 'ESTA' : 'Visa'} · ${esc(v.country || '')}</span>${statusBadge(v.exp)}</div>
            <div class="doc-number">${esc(v.num || '—')}</div>
            <div class="doc-dates"><span>Emitida en: ${esc(v.issued_at || '—')}</span><span>Emisión: ${fmtDate(v.issue)}</span><span>Vence: ${fmtDate(v.exp)}</span></div>
          </div>
        `).join('')}
        ${(p.asistencias || []).map(a => `
          <div class="doc-card">
            <div class="doc-card-header"><span class="doc-type-label">Asistencia Médica</span>${asistenciaBadge(a.fin)}</div>
            <div class="doc-number">${esc(a.num || '—')}</div>
            ${a.compania ? `<div style="font-size:11px;color:var(--text2);margin:2px 0;">${esc(a.compania)}</div>` : ''}
            ${a.producto ? `<div style="font-size:11px;color:var(--text2);margin:2px 0;">Producto: ${esc(a.producto)}</div>` : ''}
            ${a.cobertura ? `<div style="font-size:11px;color:var(--text2);margin:2px 0;">Cobertura: ${esc(a.cobertura)}</div>` : ''}
            <div class="doc-dates"><span>Inicio: ${fmtDate(a.inicio)}</span><span>Fin: ${fmtDate(a.fin)}</span><span>Duración: ${esc(a.duracion)} días</span></div>
          </div>
        `).join('')}
      </div>
      ${flags.includeSSR ? `<div class="card">
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <span class="card-title">Strings SSR</span>
          <label style="font-size:11px;color:var(--text3);display:flex;align-items:center;gap:6px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;">GDS
            <select id="ssr-gds-select" class="ssr-gds-select">
              <option value="amadeus"${gds === 'amadeus' ? ' selected' : ''}>Amadeus</option>
              <option value="sabre"${gds === 'sabre' ? ' selected' : ''}>Sabre</option>
              <option value="galileo"${gds === 'galileo' ? ' selected' : ''}>Galileo</option>
            </select>
          </label>
        </div>
        <div class="card-body" style="padding:14px 16px;">
          <div id="ssr-items-list" style="display:flex;flex-direction:column;gap:8px;">${renderSSRItems(p, gds)}</div>
        </div>
      </div>` : ''}
      </div></div>`;
  document.getElementById('detail-body').innerHTML = html;
  // Listener por JS (no inline) — el CSP bloquea onchange="..." en el HTML
  const gdsSelect = document.getElementById('ssr-gds-select');
  if (gdsSelect) gdsSelect.addEventListener('change', () => window.changeSSRGds(gdsSelect.value));
  openModal('modal-detail');
};

function getOverallBadge(p) {
  const s = passengerOverallStatus(p);
  if (['expired','critical'].includes(s)) return `<span class="badge badge-red">Docs vencidos</span>`;
  if (s === 'warning') return `<span class="badge badge-amber">Por vencer</span>`;
  if (s === 'ok') return `<span class="badge badge-green">Todo vigente</span>`;
  return `<span class="badge badge-gray">Sin datos</span>`;
}

// ==================== FORMULARIO PASAJERO ====================
window.openNewPassenger = function() {
  currentEditId = null;
  document.getElementById('modal-passenger-title').textContent = 'Nuevo pasajero';
  clearForm();
  clearScanUI();
  openModal('modal-passenger');
};

window.openEdit = function(id) {
  const p = passengers.find(x => x.id === id);
  if (!p) return;
  currentEditId = id;
  document.getElementById('modal-passenger-title').textContent = 'Editar pasajero';
  fillForm(p);
  clearScanUI();
  openModal('modal-passenger');
};

// ── Visas (grupo dinámico) ─────────────────────────────────

// Agrega una fila de visa al formulario
let _visaIdx = 0;
window.addVisaEntry = function(v) {
  const vid   = ++_visaIdx;
  const list  = document.getElementById('visa-list');
  const empty = document.getElementById('visa-empty');
  if (empty) empty.style.display = 'none';
  const row   = document.createElement('div');
  row.className = 'visa-row';
  row.style.cssText = 'padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;';
  row.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <span style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">Visa</span>
      <button type="button"
        style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:none;border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text3);font-size:14px;transition:all .15s;"
        title="Eliminar visa">×</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
      <div class="form-group">
        <label for="visa-country-${vid}">País destino</label>
        <input type="text" id="visa-country-${vid}" class="visa-country" placeholder="USA" maxlength="3"
          style="font-family:var(--mono);"
          value="${escStr(v?.country)}">
      </div>
      <div class="form-group">
        <label for="visa-num-${vid}">Número</label>
        <input type="text" id="visa-num-${vid}" class="visa-num" placeholder="17317323"
          style="font-family:var(--mono);" value="${escStr(v?.num)}">
      </div>
      <div class="form-group">
        <label for="visa-issued-at-${vid}">Lugar de emisión</label>
        <input type="text" id="visa-issued-at-${vid}" class="visa-issued-at" placeholder="BUENOS AIRES ARG"
          value="${escStr(v?.issued_at)}">
      </div>
      <div class="form-group">
        <label for="visa-type-${vid}">Tipo</label>
        <select id="visa-type-${vid}" class="visa-type">
          <option value="T" ${(v?.type||'T')==='T'?'selected':''}>T — Turista</option>
          <option value="B" ${v?.type==='B'?'selected':''}>B — Business</option>
          <option value="S" ${v?.type==='S'?'selected':''}>S — Student</option>
          <option value="I" ${v?.type==='I'?'selected':''}>I — Inmigrante</option>
          <option value="E" ${v?.type==='E'?'selected':''}>E — ESTA</option>
        </select>
      </div>
      <div class="form-group">
        <label for="visa-passport-${vid}">Pasaporte asociado</label>
        <input type="text" id="visa-passport-${vid}" class="visa-passport" placeholder="AAH161257"
          style="font-family:var(--mono);" value="${escStr(v?.passport)}">
      </div>
      <div class="form-group">
        <label for="visa-issue-${vid}">Fecha emisión</label>
        <input type="date" id="visa-issue-${vid}" class="visa-issue" value="${escStr(v?.issue)}">
      </div>
      <div class="form-group">
        <label for="visa-exp-${vid}">Fecha vencimiento</label>
        <input type="date" id="visa-exp-${vid}" class="visa-exp" value="${escStr(v?.exp)}">
      </div>
    </div>`;
  list.appendChild(row);
  const removeBtn = row.querySelector('button[title="Eliminar visa"]');
  removeBtn?.addEventListener('click', () => window.removeVisaEntry(removeBtn));
  row.querySelector('.visa-country')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
  row.querySelector('.visa-issued-at')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
  renumberVisas();
};

// Elimina una fila de visa y renumera
window.removeVisaEntry = function(btn) {
  btn.closest('.visa-row').remove();
  const list  = document.getElementById('visa-list');
  const empty = document.getElementById('visa-empty');
  if (empty) empty.style.display = list.children.length === 0 ? '' : 'none';
  renumberVisas();
};

// Actualiza el título "Visa 1", "Visa 2", etc.
function renumberVisas() {
  document.querySelectorAll('#visa-list .visa-row').forEach((row, i) => {
    const label = row.querySelector('span');
    if (label) label.textContent = `Visa ${i + 1}`;
  });
}

// Devuelve array [{country,num,...}] con los datos cargados
function getVisaEntries() {
  return Array.from(document.querySelectorAll('#visa-list .visa-row')).map(row => ({
    country:   row.querySelector('.visa-country')?.value?.trim().toUpperCase() || '',
    num:       row.querySelector('.visa-num')?.value?.trim()       || '',
    issued_at: row.querySelector('.visa-issued-at')?.value?.trim().toUpperCase() || '',
    type:      row.querySelector('.visa-type')?.value              || 'T',
    passport:  row.querySelector('.visa-passport')?.value?.trim()  || '',
    issue:     row.querySelector('.visa-issue')?.value             || '',
    exp:       row.querySelector('.visa-exp')?.value               || '',
  })).filter(v => v.country || v.num);
}

// Limpia la lista de visas
function clearVisaList() {
  const list  = document.getElementById('visa-list');
  if (list)  list.innerHTML = '';
  const empty = document.getElementById('visa-empty');
  if (empty) empty.style.display = '';
}

// ── Asistencias Médicas (reutiliza patrón de visas) ────────
let _asistenciaIdx = 0;

window.addAsistenciaEntry = function(a) {
  const aid   = ++_asistenciaIdx;
  const list  = document.getElementById('asistencia-list');
  const empty = document.getElementById('asistencia-empty');
  if (empty) empty.style.display = 'none';
  const row   = document.createElement('div');
  row.className = 'asistencia-row';
  row.style.cssText = 'padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;';
  row.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <span style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">Asistencia Médica</span>
      <button type="button"
        style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:none;border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text3);font-size:14px;transition:all .15s;"
        title="Eliminar asistencia">×</button>
    </div>
    <div class="form-group" style="margin-bottom:8px;">
      <label for="asistencia-compania-${aid}">Compañía Aseguradora</label>
      <input type="text" id="asistencia-compania-${aid}" class="asistencia-compania" placeholder="ASSIST CARD / ALLIANZ / etc."
        style="font-family:var(--mono);" value="${escStr(a?.compania)}">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;">
      <div class="form-group">
        <label for="asistencia-num-${aid}">Nº Voucher</label>
        <input type="text" id="asistencia-num-${aid}" class="asistencia-num" placeholder="VCH-1234567"
          style="font-family:var(--mono);" value="${escStr(a?.num)}">
      </div>
      <div class="form-group">
        <label for="asistencia-inicio-${aid}">Fecha inicio</label>
        <input type="date" id="asistencia-inicio-${aid}" class="asistencia-inicio" value="${escStr(a?.inicio)}">
      </div>
      <div class="form-group">
        <label for="asistencia-fin-${aid}">Fecha fin</label>
        <input type="date" id="asistencia-fin-${aid}" class="asistencia-fin" value="${escStr(a?.fin)}">
      </div>
      <div class="form-group">
        <label for="asistencia-duracion-${aid}">Duración (días)</label>
        <input type="text" id="asistencia-duracion-${aid}" class="asistencia-duracion" placeholder="11 (calculado automáticamente desde fechas de Vigencia)"
          value="${escStr(a?.duracion)}">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px; margin-top:8px;">
      <div class="form-group">
        <label for="asistencia-producto-${aid}">Producto</label>
        <input type="text" id="asistencia-producto-${aid}" class="asistencia-producto" placeholder="AC300 o Excellence Anual..."
          value="${escStr(a?.producto)}">
      </div>
      <div class="form-group">
        <label for="asistencia-cobertura-${aid}">Cobertura hasta</label>
        <input type="text" id="asistencia-cobertura-${aid}" class="asistencia-cobertura" placeholder="USD 300.000"
          value="${escStr(a?.cobertura)}">
      </div>
    </div>`;
  list.appendChild(row);
  const removeBtn = row.querySelector('button[title="Eliminar asistencia"]');
  removeBtn?.addEventListener('click', () => window.removeAsistenciaEntry(removeBtn));
  row.querySelector('.asistencia-compania')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
  renumberAsistencias();
};

window.removeAsistenciaEntry = function(btn) {
  btn.closest('.asistencia-row').remove();
  const list  = document.getElementById('asistencia-list');
  const empty = document.getElementById('asistencia-empty');
  if (empty) empty.style.display = list.children.length === 0 ? '' : 'none';
  renumberAsistencias();
};

function renumberAsistencias() {
  document.querySelectorAll('#asistencia-list .asistencia-row').forEach((row, i) => {
    const label = row.querySelector('span');
    if (label) label.textContent = `Asistencia Médica ${i + 1}`;
  });
}

function getAsistenciaEntries() {
  return Array.from(document.querySelectorAll('#asistencia-list .asistencia-row')).map(row => ({
    num:      row.querySelector('.asistencia-num')?.value?.trim() || '',
    compania: row.querySelector('.asistencia-compania')?.value?.trim().toUpperCase() || '',
    producto: row.querySelector('.asistencia-producto')?.value?.trim() || '',
    cobertura: row.querySelector('.asistencia-cobertura')?.value?.trim() || '',
    inicio:   row.querySelector('.asistencia-inicio')?.value || '',
    fin:      row.querySelector('.asistencia-fin')?.value || '',
    duracion: row.querySelector('.asistencia-duracion')?.value || '',
  })).filter(a => a.num || a.inicio || a.fin);
}

function clearAsistenciaList() {
  const list  = document.getElementById('asistencia-list');
  if (list)  list.innerHTML = '';
  const empty = document.getElementById('asistencia-empty');
  if (empty) empty.style.display = '';
  _asistenciaIdx = 0;
}

// ── Viajero Frecuente ──────────────────────────────────────
// Muestra el nombre del programa cuando se escribe el código de aerolínea
window.onFFNAirlineInput = function(input) {
  const row = input.closest('.ffn-row');
  const badge = row.querySelector('.ffn-program-badge');
  const code = input.value.trim().toUpperCase();
  input.value = code;
  if (!code || code.length < 2) { badge.innerHTML = ''; return; }
  const prog = programaFfn(code) || nombreAerolinea(code);
  if (prog) {
    badge.innerHTML = `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--green-bg);color:var(--green);border-radius:4px;padding:1px 7px;font-size:10px;font-weight:600;">${prog}</span>`;
  } else {
    badge.innerHTML = `<span style="color:var(--text3);font-size:11px;">Código no reconocido</span>`;
  }
};

// HTML del badge "AA - American Airlines" para un código IATA (vacío si no aplica).
function _airlineBadgeHtml(code) {
  if (!code || code.length < 2) return '';
  const nombre = nombreAerolinea(code);
  return nombre
    ? `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--green-bg);color:var(--green);border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600;white-space:nowrap;">${esc(code)} - ${esc(nombre)}</span>`
    : `<span style="color:var(--text3);font-size:11px;">Código no reconocido</span>`;
}

// Deriva el código IATA del prefijo del número de vuelo (ej. "AF557" -> "AF", "G31234" -> "G3").
function _deriveCompania(vuelo) {
  const m = (vuelo || '').match(/^([A-Z0-9]{2})\d/);
  return m ? m[1] : '';
}

// Muestra "AA - American Airlines" junto al campo compañía cuando hay match
window.onCompaniaInput = function(input) {
  const badge = document.getElementById('res-compania-badge');
  if (!badge) return;
  const code = (input.value || '').trim().toUpperCase();
  input.value = code;
  badge.innerHTML = _airlineBadgeHtml(code);
};

// Agrega una fila de Viajero Frecuente al formulario
let _ffnIdx = 0;
window.addFFNEntry = function(airline, number) {
  const fid  = ++_ffnIdx;
  const list = document.getElementById('ffn-list');
  const empty = document.getElementById('ffn-empty');
  if (empty) empty.style.display = 'none';
  const row = document.createElement('div');
  row.className = 'ffn-row';
  row.style.cssText = 'padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;';
  row.innerHTML = `
    <div style="display:flex;align-items:flex-end;gap:10px;">
      <div class="form-group" style="width:72px;flex-shrink:0;margin:0;">
        <label for="ffn-airline-${fid}">Aerolínea</label>
        <input type="text" id="ffn-airline-${fid}" class="ffn-airline" placeholder="AA" maxlength="3"
          style="font-family:var(--mono);text-align:center;font-weight:600;letter-spacing:.05em;"
          value="${escStr(airline)}">
      </div>
      <div class="form-group" style="flex:1;margin:0;">
        <label for="ffn-number-${fid}">Número de programa</label>
        <input type="text" id="ffn-number-${fid}" class="ffn-number" placeholder="3E431X2"
          style="font-family:var(--mono);" value="${escStr(number)}">
      </div>
      <button type="button"
        style="flex-shrink:0;width:33px;height:33px;display:flex;align-items:center;justify-content:center;background:none;border:1px solid var(--border);border-radius:7px;cursor:pointer;color:var(--text3);font-size:15px;transition:all .15s;"
        title="Eliminar">×</button>
    </div>
    <div class="ffn-program-badge" style="margin-top:6px;min-height:16px;"></div>`;
  list.appendChild(row);
  const airlineInput = row.querySelector('.ffn-airline');
  airlineInput?.addEventListener('input', () => window.onFFNAirlineInput(airlineInput));
  const removeBtn = row.querySelector('button[title="Eliminar"]');
  removeBtn?.addEventListener('click', () => window.removeFFNEntry(removeBtn));
  if (airlineInput?.value) window.onFFNAirlineInput(airlineInput);
};

// Elimina una fila
window.removeFFNEntry = function(btn) {
  const row = btn.closest('.ffn-row');
  row.remove();
  const list = document.getElementById('ffn-list');
  const empty = document.getElementById('ffn-empty');
  if (empty) empty.style.display = list.children.length === 0 ? '' : 'none';
};

// Devuelve array [{airline, number}] con los datos cargados
function getFFNEntries() {
  return Array.from(document.querySelectorAll('#ffn-list .ffn-row')).map(row => ({
    airline: row.querySelector('.ffn-airline')?.value?.trim().toUpperCase() || '',
    number:  row.querySelector('.ffn-number')?.value?.trim() || '',
  })).filter(e => e.airline && e.number);
}

// Limpia todas las filas FFN
function clearFFNList() {
  const list = document.getElementById('ffn-list');
  if (list) list.innerHTML = '';
  const empty = document.getElementById('ffn-empty');
  if (empty) empty.style.display = '';
}

let _emergencyIdx = 0;
window.addEmergencyEntry = function(c) {
  const eid = ++_emergencyIdx;
  const list = document.getElementById('emergency-list');
  const empty = document.getElementById('emergency-empty');
  if (empty) empty.style.display = 'none';
  const row = document.createElement('div');
  row.className = 'emergency-row';
  row.style.cssText = 'padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;';
  row.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <span style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">Contacto de emergencia</span>
      <button type="button"
        style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:none;border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text3);font-size:14px;transition:all .15s;"
        title="Eliminar contacto">×</button>
    </div>
    <div class="form-grid">
      <div class="form-group"><label for="emergency-name-${eid}">Nombre</label><input id="emergency-name-${eid}" class="emergency-name" type="text" value="${escStr(c?.name)}"></div>
      <div class="form-group"><label for="emergency-relationship-${eid}">Parentesco o relacion</label><input id="emergency-relationship-${eid}" class="emergency-relationship" type="text" value="${escStr(c?.relationship)}"></div>
      <div class="form-group"><label for="emergency-phone-${eid}">Telefono con prefijo internacional</label><input id="emergency-phone-${eid}" class="emergency-phone" type="tel" placeholder="+54 9 11 1234-5678" value="${escStr(c?.phone)}"></div>
    </div>`;
  list.appendChild(row);
  const removeBtn = row.querySelector('button[title="Eliminar contacto"]');
  removeBtn?.addEventListener('click', () => window.removeEmergencyEntry(removeBtn));
  renumberEmergencies();
};

window.removeEmergencyEntry = function(btn) {
  btn.closest('.emergency-row').remove();
  const list = document.getElementById('emergency-list');
  const empty = document.getElementById('emergency-empty');
  if (empty) empty.style.display = list.children.length === 0 ? '' : 'none';
  renumberEmergencies();
};

function renumberEmergencies() {
  document.querySelectorAll('#emergency-list .emergency-row').forEach((row, i) => {
    const label = row.querySelector('span');
    if (label) label.textContent = `Contacto de emergencia ${i + 1}`;
  });
}

function getEmergencyEntries() {
  return Array.from(document.querySelectorAll('#emergency-list .emergency-row')).map(row => ({
    name: row.querySelector('.emergency-name')?.value?.trim() || '',
    relationship: row.querySelector('.emergency-relationship')?.value?.trim() || '',
    phone: row.querySelector('.emergency-phone')?.value?.trim() || ''
  })).filter(c => c.name || c.relationship || c.phone);
}

function emergencyContactsOf(p) {
  const list = Array.isArray(p?.emergencyContacts) ? p.emergencyContacts : [];
  const filled = list.filter(c => c && Object.values(c).some(Boolean));
  if (filled.length) return filled;
  const one = p?.emergencyContact;
  return one && Object.values(one).some(Boolean) ? [one] : [];
}

function clearEmergencyList() {
  const list = document.getElementById('emergency-list');
  if (list) list.innerHTML = '';
  const empty = document.getElementById('emergency-empty');
  if (empty) empty.style.display = '';
  _emergencyIdx = 0;
}

function clearForm() {
  const ids = ['form-id','form-lastname','form-firstname','form-dob','form-cuil','form-email','form-whatsapp','form-notes',
    'form-dni-num','form-dni-issue','form-dni-exp',
    'form-parg-num','form-parg-issue','form-parg-exp',
    'form-pext-num','form-pext-issue','form-pext-exp',
    'form-pext-lastname','form-pext-firstname'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['form-gender','form-nationality','form-pext-country','form-dni-country']
    .forEach(id => { const el = document.getElementById(id); if (el) el.selectedIndex = 0; });
  clearVisaList();
  clearEmergencyList();
  clearFFNList();
  clearAsistenciaList();
}

function fillForm(p) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('form-id', p.id);
  set('form-lastname', p.lastname);
  set('form-firstname', p.firstname);
  set('form-dob', p.dob);
  set('form-cuil', p.cuil);
  set('form-email', p.email);
  set('form-whatsapp', p.whatsapp);
  set('form-notes', p.notes);
  set('form-gender', p.gender);
  set('form-nationality', p.nationality);
  set('form-dni-country', p.dni?.country || 'ARG');
  set('form-dni-num', p.dni?.num); set('form-dni-issue', p.dni?.issue); set('form-dni-exp', p.dni?.exp);
  set('form-parg-num', p.parg?.num); set('form-parg-issue', p.parg?.issue); set('form-parg-exp', p.parg?.exp);
  set('form-pext-country', p.pext?.country); set('form-pext-num', p.pext?.num); set('form-pext-issue', p.pext?.issue); set('form-pext-exp', p.pext?.exp);
  set('form-pext-lastname', p.pext?.lastname); set('form-pext-firstname', p.pext?.firstname);
  // Cargar visas: usar array p.visas si existe, sino migrar de visa1/visa2 legacy
  clearVisaList();
  const visasToLoad = Array.isArray(p.visas) && p.visas.length > 0
    ? p.visas
    : [p.visa1, p.visa2].filter(v => v?.country || v?.num).map(v => {
        // Migración: passport era "ARG"/"EXT" en versión anterior
        const passport = (v.passport === 'ARG' || v.passport === 'EXT')
          ? (p.parg?.num || p.pext?.num || '') : (v.passport || '');
        return { ...v, passport };
      });
  visasToLoad.forEach(v => addVisaEntry(v));
  clearEmergencyList();
  emergencyContactsOf(p).forEach(c => addEmergencyEntry(c));
  // Cargar asistencias médicas (reutiliza patrón de visas)
  clearAsistenciaList();
  if (Array.isArray(p.asistencias) && p.asistencias.length > 0) {
    p.asistencias.forEach(a => addAsistenciaEntry(a));
  }
  // Cargar programas de viajero frecuente
  clearFFNList();
  if (Array.isArray(p.ffn) && p.ffn.length > 0) {
    p.ffn.forEach(entry => addFFNEntry(entry.airline, entry.number));
  }
}

window.savePassenger = async function() {
  const g = id => document.getElementById(id)?.value?.trim() || '';
  const stripDiacritics = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const lastname = stripDiacritics(g('form-lastname').toUpperCase());
  const firstname = stripDiacritics(g('form-firstname').toUpperCase());
  const dob = g('form-dob');
  if (!lastname || !firstname || !dob) {
    showToast('⚠ Completá apellido, nombre y fecha de nacimiento', true);
    return;
  }

  const btn = document.getElementById('btn-save-passenger');

  // Verificar duplicados (excluir el propio pasajero si estamos editando)
  const dupCheck = {
    lastname, firstname, dob,
    parg: { num: document.getElementById('form-parg-num')?.value?.trim() || '' },
    pext: { num: document.getElementById('form-pext-num')?.value?.trim() || '' },
    dni:  { num: document.getElementById('form-dni-num')?.value?.trim() || '', country: document.getElementById('form-dni-country')?.value || 'ARG' }
  };
  const dupMatch = findDuplicateMatch(dupCheck, currentEditId);
  if (dupMatch) {
    const fieldLabels = {
      parg: 'pasaporte argentino',
      pext: 'pasaporte extranjero',
      dni: 'DNI',
      identity: 'nombre y fecha de nacimiento'
    };
    const fieldLabel = fieldLabels[dupMatch.reason] || 'esos datos';
    showToast(`⚠ Ya existe un pasajero con ese ${fieldLabel}: ${dupMatch.passenger.lastname}, ${dupMatch.passenger.firstname}`, true);
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;width:13px;height:13px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px;"></span>Guardando...';

  const emergencyContacts = getEmergencyEntries();
  const data = {
    lastname, firstname, dob,
    gender: g('form-gender') || 'M',
    nationality: g('form-nationality') || 'ARG',
    cuil: g('form-cuil'),
    email: g('form-email'),
    whatsapp: g('form-whatsapp'),
    notes: g('form-notes'),
    emergencyContacts,
    emergencyContact: emergencyContacts[0] || { name: '', relationship: '', phone: '' },
    dni: { country: g('form-dni-country') || 'ARG', num: g('form-dni-num'), issue: g('form-dni-issue'), exp: g('form-dni-exp') },
    parg: { num: g('form-parg-num'), issue: g('form-parg-issue'), exp: g('form-parg-exp') },
    pext: { country: g('form-pext-country'), num: g('form-pext-num'), issue: g('form-pext-issue'), exp: g('form-pext-exp'), lastname: g('form-pext-lastname'), firstname: g('form-pext-firstname') },
    visas: getVisaEntries(),
    // Mantener visa1/visa2 para compatibilidad con SSR y vistas legacy
    visa1: getVisaEntries()[0] || {},
    visa2: getVisaEntries()[1] || {},
    asistencias: getAsistenciaEntries(),
    ffn: getFFNEntries()
  };

  try {
    if (currentEditId) {
      await updatePassenger(currentEditId, data);
      showToast('✓ Pasajero actualizado');
    } else {
      await addPassenger(data);
      showToast('✓ Pasajero creado');
    }
    closeModal('modal-passenger');
  } catch(err) {
    console.error(err);
    showToast('✗ Error al guardar: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 4L6 11l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Guardar pasajero';
  }
};

// ==================== CONFIRM / DELETE ====================
function showConfirmDialog({ title, message, subtext = '', confirmLabel = 'Confirmar', onConfirm }) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-text').textContent = message;
  document.getElementById('confirm-subtext').textContent = subtext;
  document.getElementById('confirm-ok-btn').textContent = confirmLabel;
  document.getElementById('confirm-ok-btn').onclick = async () => {
    closeModal('modal-confirm');
    await onConfirm();
  };
  openModal('modal-confirm');
}

window.confirmDelete = function(id) {
  const p = passengers.find(x => x.id === id);
  if (!p) return;

  showConfirmDialog({
    title: '¡Guardá!',
    message: `Estás por eliminar a ${p.lastname}, ${p.firstname} de la base de datos. ¿Estás seguro?`,
    subtext: 'Esta acción no se puede deshacer. Se borrarán todos los datos del pasajero.',
    confirmLabel: 'Sí, eliminar pasajero',
    onConfirm: async () => {
      try {
        await deletePassenger(id);
        if (window._detailPassengerId === id) {
          window._detailPassengerId = null;
          closeModal('modal-detail');
        }
        showToast('✓ Pasajero eliminado');
      } catch (err) {
        showToast('✗ Error al eliminar', true);
      }
    }
  });
};

// ==================== BÚSQUEDA GLOBAL ====================
window.globalSearch = function(q) {
  showView('passengers');
};

window._globalSearch_UNUSED = function(q) {
  if (!q || q.length < 2) { closeModal('modal-search'); return; }
  const results = passengers.filter(p =>
    `${p.lastname} ${p.firstname} ${p.dni?.num||''} ${p.parg?.num||''} ${p.pext?.num||''} ${p.visa1?.num||''} ${p.visa2?.num||''}`.toLowerCase().includes(q.toLowerCase())
  );
  if (!results.length) { closeModal('modal-search'); return; }

  let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
  results.forEach(p => {
    html += `<div class="alert-row" style="cursor:pointer;" role="button" tabindex="0" data-open-detail="${escStr(p.id)}" data-close-modal="modal-search">
      <div class="psi-avatar" style="width:36px;height:36px;border-radius:9px;background:var(--accent-light);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:var(--accent);flex-shrink:0;">${esc(initials(p))}</div>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:500;">${esc(p.lastname)}, ${esc(p.firstname)}</div>
        <div style="font-size:11px;color:var(--text3);">${esc(p.nationality)} · ${fmtDate(p.dob)} · <span style="font-family:var(--mono);">${esc(p.parg?.num || p.dni?.num || '')}</span></div>
      </div>
      ${getOverallBadge(p)}
    </div>`;
  });
  html += '</div>';
  document.getElementById('search-results-body').innerHTML = html;
  openModal('modal-search');
};

// ==================== SCANNER IA ====================
window.onDragOver = function(e) {
  e.preventDefault();
  document.getElementById('scan-dropzone').classList.add('drag-over');
};
window.onDragLeave = function() {
  document.getElementById('scan-dropzone').classList.remove('drag-over');
};
window.onDrop = function(e) {
  e.preventDefault();
  document.getElementById('scan-dropzone').classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files);
  if (files.length) processScannedFiles(files);
};
window.onFileSelected = function(e) {
  const files = Array.from(e.target.files);
  if (files.length) processScannedFiles(files);
  e.target.value = ''; // allow re-selecting the same file via click
};

let scanDetectedOtherGroups = [];

function normScanValue(v) {
  return (v || '').toString().toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function normScanNumber(v) {
  return (v || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
}

function getScanIdentity(mapped) {
  return {
    lastname: normScanValue(mapped?.lastname),
    firstname: normScanValue(mapped?.firstname),
    dob: mapped?.dob || '',
    passport: normScanNumber(mapped?.parg?.num || mapped?.pext?.num || ''),
    dni: normScanNumber(mapped?.dni?.num || ''),
    visa: normScanNumber(mapped?.visa?.num || '')
  };
}

function hasIdentitySignals(identity) {
  return !!(identity.passport || identity.dni || identity.visa || identity.dob || identity.lastname || identity.firstname);
}

function identityMatchesBase(base, candidate) {
  if (!base || !candidate) return true;

  const docMatch = (
    (base.passport && candidate.passport && base.passport === candidate.passport) ||
    (base.dni && candidate.dni && base.dni === candidate.dni) ||
    (base.visa && candidate.visa && base.visa === candidate.visa)
  );
  if (docMatch) return true;

  const sameDob = base.dob && candidate.dob && base.dob === candidate.dob;
  const sameLast = base.lastname && candidate.lastname && base.lastname === candidate.lastname;
  const sameFirst = base.firstname && candidate.firstname && base.firstname === candidate.firstname;
  if (sameDob && (sameLast || sameFirst)) return true;

  const hasComparableDocs =
    (!!base.passport && !!candidate.passport) ||
    (!!base.dni && !!candidate.dni) ||
    (!!base.visa && !!candidate.visa);
  const hasComparableNames = !!base.dob && !!candidate.dob && (!!base.lastname || !!base.firstname) && (!!candidate.lastname || !!candidate.firstname);

  // Si no hay señales comparables, no bloquear para evitar falsos descartes.
  if (!hasComparableDocs && !hasComparableNames) return true;
  return false;
}

function mergeIdentity(base, candidate) {
  if (!base) return candidate;
  return {
    lastname: base.lastname || candidate.lastname,
    firstname: base.firstname || candidate.firstname,
    dob: base.dob || candidate.dob,
    passport: base.passport || candidate.passport,
    dni: base.dni || candidate.dni,
    visa: base.visa || candidate.visa
  };
}

function renderDetectedOtherPassengers(context) {
  const wrap = document.getElementById('scan-other-passengers');
  const text = document.getElementById('scan-other-passengers-text');
  const btn = document.getElementById('scan-other-passengers-btn');
  if (!wrap || !text || !btn) return;

  const grouped = groupByPassenger(context.ignoredResults || []);
  scanDetectedOtherGroups = grouped;

  if (!grouped.length) {
    wrap.style.display = 'none';
    text.textContent = '';
    btn.textContent = 'Agregar pasajeros detectados';
    return;
  }

  text.textContent =
    `Se detectaron ${grouped.length} pasajero(s) distinto(s) en ${context.ignoredCount} archivo(s). Podés agregarlos automáticamente.`;
  btn.textContent = `Agregar ${grouped.length} pasajero(s) detectado(s)`;
  wrap.style.display = 'block';
}

window.addDetectedOtherPassengers = async function() {
  if (!scanDetectedOtherGroups.length) return;

  const btn = document.getElementById('scan-other-passengers-btn');
  const prevHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.35);border-top-color:currentColor;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px;"></span>Agregando...';

  let ok = 0;
  let skipped = 0;
  let fail = 0;

  for (const g of scanDetectedOtherGroups) {
    if (!g.lastname && !g.firstname) {
      fail++;
      continue;
    }
    if (findDuplicateInDB(g)) {
      skipped++;
      continue;
    }

    try {
      const visas = [g.visa1 || g.visa || {}, g.visa2 || {}].filter(v => v?.country || v?.num || v?.passport);
      const data = {
        lastname: (g.lastname || '').toUpperCase(),
        firstname: (g.firstname || '').toUpperCase(),
        dob: g.dob || '',
        gender: g.gender || 'M',
        nationality: g.nationality || 'ARG',
        email: g.email || '',
        whatsapp: g.whatsapp || '',
        notes: g.notes || '',
        emergencyContact: g.emergencyContact || {},
        dni: g.dni || { num: '', issue: '', exp: '' },
        parg: g.parg || { num: '', issue: '', exp: '' },
        pext: g.pext || { country: '', num: '', issue: '', exp: '' },
        visas,
        visa1: visas[0] || {},
        visa2: visas[1] || {},
        asistencias: Array.isArray(g.asistencias) ? g.asistencias : [],
        ffn: Array.isArray(g.ffn) ? g.ffn : []
      };
      await addPassenger(data);
      ok++;
    } catch (err) {
      console.error('Error importando pasajero:', err);
      fail++;
    }
  }

  const parts = [];
  if (ok) parts.push(`${ok} agregado(s)`);
  if (skipped) parts.push(`${skipped} ya existían`);
  if (fail) parts.push(`${fail} con error`);
  showToast(`✓ ${parts.join(' · ')}`);

  scanDetectedOtherGroups = [];
  const wrap = document.getElementById('scan-other-passengers');
  if (wrap) wrap.style.display = 'none';
  btn.disabled = false;
  btn.innerHTML = prevHtml;
};

// Procesa varios archivos en secuencia, fusionando resultados
async function processScannedFiles(files) {
  const allowed = ['image/jpeg','image/png','image/webp','image/gif','application/pdf'];
  const valid = files.filter(f => f.size <= 20 * 1024 * 1024 && allowed.includes(f.type));
  const invalid = files.filter(f => !valid.includes(f));

  const statusEl = document.getElementById('scan-status');
  const errorEl = document.getElementById('scan-error');
  const otherWrap = document.getElementById('scan-other-passengers');
  errorEl.style.display = 'none';
  if (otherWrap) otherWrap.style.display = 'none';
  scanDetectedOtherGroups = [];

  if (invalid.length) {
    errorEl.textContent = `✗ ${invalid.length} archivo(s) ignorado(s): formato no válido o mayor a 20MB.`;
    errorEl.style.display = 'block';
  }
  if (!valid.length) return;

  const hasPreloadedData = !!currentEditId ||
    ['form-lastname', 'form-firstname', 'form-dob'].some(id => document.getElementById(id)?.value?.trim());
  const context = {
    totalFiles: valid.length,
    acceptedCount: 0,
    ignoredCount: 0,
    failedCount: 0,
    baseIdentity: null,
    ignoredResults: [],
    hasPreloadedData
  };

  for (let i = 0; i < valid.length; i++) {
    await processScannedFile(valid[i], i, context);
    // Pausa entre archivos para no saturar la API de Gemini (límite: 15 req/min)
    if (i < valid.length - 1) await new Promise(r => setTimeout(r, 4500));
  }

  // Reconciliacion post-lote del nombre principal: si tras procesar todos los
  // archivos las celdas base (apellido/nombre ARG) quedaron vacias pero hay un
  // pasaporte extranjero con su nombre cargado en form-pext-*, lo usamos como
  // fallback. Caso: pasajero nuevo con SOLO pasaporte extranjero. Si hubo parg,
  // este ya lleno las celdas base (vacio -> llenar siempre) y esto no hace nada.
  const pextLnEl = document.getElementById('form-pext-lastname');
  const pextFnEl = document.getElementById('form-pext-firstname');
  const baseLnEl = document.getElementById('form-lastname');
  const baseFnEl = document.getElementById('form-firstname');
  if (pextLnEl?.value?.trim() && baseLnEl && !baseLnEl.value.trim()) baseLnEl.value = pextLnEl.value.trim();
  if (pextFnEl?.value?.trim() && baseFnEl && !baseFnEl.value.trim()) baseFnEl.value = pextFnEl.value.trim();

  renderDetectedOtherPassengers(context);

  const allRequired = ['form-lastname','form-firstname','form-dob']
    .every(id => document.getElementById(id).value.trim());
  statusEl.style.display = 'block';
  statusEl.style.color = context.acceptedCount ? 'var(--green)' : 'var(--text2)';
  statusEl.textContent = allRequired
    ? `✓ ${context.acceptedCount} documento(s) del pasajero base procesado(s). ${context.ignoredCount ? `${context.ignoredCount} documento(s) de otros pasajeros ignorado(s).` : ''}`.trim()
    : `✓ ${context.acceptedCount} documento(s) procesado(s) parcialmente.${context.ignoredCount ? ` ${context.ignoredCount} de otros pasajeros ignorado(s).` : ''}`;

  if (context.acceptedCount > 0) {
    showToast(allRequired ? '✓ Escaneo completado' : '✓ Escaneo parcial: revisá obligatorios');
  }
}

async function processScannedFile(file, index, context) {
  const { scanDocument, mapScanToForm, prepareImageForScan } = await loadScanner();
  const preview = document.getElementById('scan-preview');
  const statusEl = document.getElementById('scan-status');
  const errorEl = document.getElementById('scan-error');
  const mergeMode = context.acceptedCount > 0;
  const conservative = context.hasPreloadedData || mergeMode;
  // editMode: estamos editando un pasajero existente (campos ya cargados).
  // Solo acá pedimos confirmación antes de sobrescribir (feature C).
  const editMode = context.hasPreloadedData;

  // Preview: solo mostrar si es un único archivo. Comprimimos primero para que
  // el preview muestre lo mismo que va a recibir la IA (Fase 2A). El archivo
  // comprimido se pasa al scan; scanWithGemini lo smart-skipa (idempotente).
  if (context.totalFiles === 1 && file.type.startsWith('image/')) {
    file = await prepareImageForScan(file);
    preview.src = URL.createObjectURL(file);
    preview.style.display = 'block';
  } else if (!mergeMode) {
    preview.style.display = 'none';
  }

  statusEl.style.display = 'block';
  const label = context.totalFiles > 1
    ? `Analizando documento ${index + 1} de ${context.totalFiles}...`
    : 'Analizando documento con OCR...';
  statusEl.innerHTML = `<span class="scan-spinner"></span>${label}`;

  // En edición, campos que el scan quiere sobrescribir se acumulan acá y se
  // confirman todos juntos al final del archivo (feature C).
  const overrides = [];
  let docsApplied = 0;

  try {
    // scanDocument ahora devuelve un ARRAY de documentos (1 o más) de la misma persona.
    const results = await scanDocument(file);

    for (const result of results) {
      const mapped = mapScanToForm(result);
      const identity = getScanIdentity(mapped);

      if (!context.baseIdentity && hasIdentitySignals(identity)) {
        context.baseIdentity = identity;
      }

      // B: si un documento del array no es de la misma persona que el pasajero base,
      // se descarta. En modo edición aceptamos secundarios (ej. pasaporte + ESTA);
      // en alta nueva o merge, se ignora como "otro pasajero".
      if (context.baseIdentity && !identityMatchesBase(context.baseIdentity, identity)) {
        if (conservative) {
          // editar existente: aceptar documentos secundarios aunque algún dato difiera
        } else {
          context.ignoredCount++;
          context.ignoredResults.push({ mapped, filename: file.name });
          statusEl.style.color = 'var(--text2)';
          statusEl.textContent = `Documento ${index + 1}/${context.totalFiles} ignorado: corresponde a otro pasajero.`;
          continue;
        }
      }

      if (hasIdentitySignals(identity)) {
        context.baseIdentity = mergeIdentity(context.baseIdentity, identity);
      }

      applyMappedToForm(mapped, { conservative, editMode, overrides });
      docsApplied++;
      context.acceptedCount++;
    }

    // C: si editábamos un pasajero y el scan trae valores nuevos para campos que
    // ya tenían dato, pedimos confirmación una sola vez antes de reemplazarlos.
    if (editMode && overrides.length) {
      applyOverridesWithConfirm(overrides);
    }

    if (docsApplied > 0) {
      statusEl.style.color = 'var(--green)';
      statusEl.textContent = `Documento ${index + 1}/${context.totalFiles}: ${docsApplied} documento(s) procesado(s) para el pasajero base.`;
    }

  } catch (err) {
    context.failedCount++;
    errorEl.textContent = `✗ Error en "${file.name}": ${err.message}`;
    errorEl.style.display = 'block';
  }
}

// ============================================================
//  Aplicación de un documento mapeado al formulario
//  - Campos vacíos se llenan siempre.
//  - Alta nueva (no conservative): sobrescribe campos con valor distinto.
//  - Merge (conservative sin editMode): no toca campos ya cargados (gana el 1er archivo).
//  - Edición (editMode): los campos con valor distinto se acumulan en `overrides`
//    y se confirman al final del archivo (feature C), en vez de sobrescribir.
// ============================================================
function applyMappedToForm(mapped, { conservative, editMode, overrides }) {
  if (!mapped) return;

  // setField: unifica el comportamiento de llenar/sobrescribir/deferir.
  function setField(id, newValue, label) {
    if (!newValue) return;
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value.trim();
    if (!cur) { el.value = newValue; return; }            // vacío -> llenar siempre
    if (cur === String(newValue).trim()) return;          // sin cambio
    if (editMode) {
      overrides.push({ id, newValue, label });            // editar -> deferir confirmación
    } else if (!conservative) {
      el.value = newValue;                                // alta nueva -> sobrescribe
    }
    // conservative && !editMode (merge): no tocar, gana el primer archivo
  }

  // Apellido/Nombre: en pasaporte extranjero (pext) van SOLO a las celdas propias
  // (form-pext-lastname/firstname, "Apellido/Nombre en este pasaporte") para no
  // pisar la identidad principal (ARG). Para parg/dni/otros, a las celdas base.
  // El fallback "si la base esta vacia, llenarla con el nombre extranjero" NO va
  // aca: si el pext se procesa antes que el parg en un lote, llenaria form-lastname
  // y el parg (conservative) no podria reclamarlo. Ese fallback se hace post-lote
  // en processScannedFiles, solo si tras todos los archivos la base sigue vacia
  // (caso: pasajero con SOLO pasaporte extranjero).
  if (mapped.doc_type === 'pext') {
    setField('form-pext-lastname',  mapped.lastname,  'Apellido (pasaporte ext.)');
    setField('form-pext-firstname', mapped.firstname, 'Nombre (pasaporte ext.)');
  } else {
    setField('form-lastname',  mapped.lastname,  'Apellido');
    setField('form-firstname', mapped.firstname, 'Nombre');
  }
  setField('form-dob',       mapped.dob,       'Fecha de nacimiento');
  setField('form-gender',    mapped.gender,    'Sexo');

  // PARG siempre impone la nacionalidad (incluso en mergeMode): el pasaporte ARG
  // es la identidad principal, gana sobre la nacionalidad de un pasaporte
  // extranjero escaneado antes en el mismo lote. En editMode (pasajero existente)
  // no se toca la nacionalidad ya cargada.
  // PEXT en mergeMode nunca sobreescribe la nacionalidad ya cargada
  // En conservativeMode tampoco se sobrescribe nacionalidad
  if (mapped.doc_type === 'parg' && mapped.nationality && !editMode) {
    const natEl = document.getElementById('form-nationality');
    if (natEl) natEl.value = mapped.nationality;
  } else if (mapped.doc_type !== 'pext' || !conservative) {
    if (!conservative || !document.getElementById('form-nationality')?.value) {
      if (mapped.nationality) {
        const natEl = document.getElementById('form-nationality');
        if (natEl) natEl.value = mapped.nationality;
      }
    }
  }

  if (mapped.dni) {
    setField('form-dni-country', mapped.dni.country, 'DNI país emisor');
    setField('form-dni-num',   mapped.dni.num,   'DNI número');
    setField('form-dni-issue', mapped.dni.issue, 'DNI emisión');
    setField('form-dni-exp',   mapped.dni.exp,   'DNI vencimiento');
  }
  if (mapped.parg) {
    setField('form-parg-num',   mapped.parg.num,   'Pasaporte ARG número');
    setField('form-parg-issue', mapped.parg.issue, 'Pasaporte ARG emisión');
    setField('form-parg-exp',   mapped.parg.exp,   'Pasaporte ARG vencimiento');
  }
  if (mapped.pext) {
    setField('form-pext-country', mapped.pext.country, 'Pasaporte ext. país');
    setField('form-pext-num',     mapped.pext.num,     'Pasaporte ext. número');
    setField('form-pext-issue',   mapped.pext.issue,   'Pasaporte ext. emisión');
    setField('form-pext-exp',     mapped.pext.exp,     'Pasaporte ext. vencimiento');
  }
  if (mapped.visa) {
    // Si ya hay una visa de otro país, agregar nueva entrada; si no, sobrescribir la que tenga el mismo país
    const existing = Array.from(document.querySelectorAll('#visa-list .visa-row'));
    const sameCountry = existing.find(row =>
      row.querySelector('.visa-country')?.value?.trim().toUpperCase() === (mapped.visa.country || '').toUpperCase()
    );
    if (sameCountry) {
      setField(sameCountry.querySelector('.visa-num').id, mapped.visa.num, 'Visa numero');
      setField(sameCountry.querySelector('.visa-issued-at').id, mapped.visa.issued_at, 'Visa lugar de emision');
      setField(sameCountry.querySelector('.visa-type').id, mapped.visa.type, 'Visa tipo');
      setField(sameCountry.querySelector('.visa-passport').id, mapped.visa.passport, 'Visa pasaporte');
      setField(sameCountry.querySelector('.visa-issue').id, mapped.visa.issue, 'Visa emision');
      setField(sameCountry.querySelector('.visa-exp').id, mapped.visa.exp, 'Visa vencimiento');
    } else {
      // País nuevo: agregar automáticamente una nueva entrada
      addVisaEntry(mapped.visa);
    }
  }
  if (mapped.asistencia) {
    addAsistenciaEntry(mapped.asistencia);
  }
  if (mapped.ffn) {
    const ya = getFFNEntries().some(e =>
      e.airline === mapped.ffn.airline && e.number === mapped.ffn.number
    );
    if (!ya) addFFNEntry(mapped.ffn.airline, mapped.ffn.number);
  }
}

// C: confirma una sola vez antes de reemplazar campos que ya tenían valor cargado.
function applyOverridesWithConfirm(overrides) {
  // Dedup por id (queda el último) por si varios docs del mismo archivo tocan el mismo campo
  const byId = {};
  for (const ov of overrides) byId[ov.id] = ov;
  const list = Object.values(byId);
  if (!list.length) return;

  const lines = list.map(ov => `• ${ov.label}: ${ov.newValue}`).join('\n');
  const ok = confirm(
    `El escaneo trae datos nuevos para:\n\n${lines}\n\n` +
    `Estos campos ya tienen un valor cargado. ¿Querés reemplazarlos?`
  );
  if (!ok) return;
  for (const ov of list) {
    const el = document.getElementById(ov.id);
    if (el) el.value = ov.newValue;
  }
}

function clearScanUI() {
  document.getElementById('scan-preview').style.display = 'none';
  document.getElementById('scan-preview').src = '';
  document.getElementById('scan-status').style.display = 'none';
  document.getElementById('scan-error').style.display = 'none';
  document.getElementById('scan-other-passengers').style.display = 'none';
  document.getElementById('scan-other-passengers-text').textContent = '';
  document.getElementById('scan-other-passengers-btn').textContent = 'Agregar pasajeros detectados';
  document.getElementById('scan-file').value = '';
  scanDetectedOtherGroups = [];
}

// ==================== MODAL ====================
window.openModal = function(id) {
  document.getElementById(id)?.classList.add('open');
  document.body.style.overflow = 'hidden';
};
window.closeModal = function(id) {
  document.getElementById(id)?.classList.remove('open');
  // Restaurar scroll solo si no hay otros modales abiertos
  if (!document.querySelector('.modal-overlay.open')) {
    document.body.style.overflow = '';
  }
};

document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', function(e) { if (e.target === this) closeModal(this.id); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
});

// ==================== UTILS UI ====================
window.copyText = function(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'copiar'; btn.classList.remove('copied'); }, 1500);
  });
};

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  const inner = document.getElementById('toast-text');
  inner.textContent = msg;
  inner.classList.toggle('error', !!isError);
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 3000);
}


// ==================== IMPORTACION MASIVA ====================

let importGroups = []; // array de pasajeros agrupados para revisar

// SheetJS solo se usa aca: no bloquear el login. Misma URL que antes.
let xlsxPromise = null;
function loadXlsx() {
  if (typeof XLSX !== 'undefined') return Promise.resolve();
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve();
    s.onerror = () => { xlsxPromise = null; reject(new Error('xlsx')); };
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

async function handleImportDrop(e) {
  const { archivosImportacionMasiva } = await loadScanner();
  const files = archivosImportacionMasiva(e.dataTransfer.files);
  if (files.length) startBulkImport(files);
}

window.handleImportFiles = async function(e) {
  const { archivosImportacionMasiva } = await loadScanner();
  const files = archivosImportacionMasiva(e.target.files);
  if (files.length) startBulkImport(files);
  e.target.value = ''; // allow re-selecting the same file/folder via click
};

async function startBulkImport(files) {
  importGroups = [];
  document.getElementById('import-dropzone').style.display = 'none';
  document.getElementById('import-review-wrap').style.display = 'none';

  const progressWrap = document.getElementById('import-progress-wrap');
  const progressBar = document.getElementById('import-progress-bar');
  const progressLabel = document.getElementById('import-progress-label');
  const progressCount = document.getElementById('import-progress-count');
  progressWrap.style.display = 'block';

  const { scanDocument, mapScanToForm } = await loadScanner();
  const results = [];
  for (let i = 0; i < files.length; i++) {
    progressLabel.textContent = `Analizando: ${files[i].name}`;
    progressCount.textContent = `${i + 1} / ${files.length}`;
    progressBar.style.width = `${Math.round(((i) / files.length) * 100)}%`;
    try {
      // scanDocument devuelve un array de documentos (1 o más) de la misma persona
      const docs = await scanDocument(files[i]);
      for (const result of docs) {
        const mapped = mapScanToForm(result);
        if (mapped.lastname || mapped.firstname) {
          results.push({ mapped, filename: files[i].name });
        }
      }
    } catch (err) { console.warn('Imagen ilegible, se ignora:', err); }
  }

  progressBar.style.width = '100%';
  progressLabel.textContent = 'Agrupando pasajeros...';

  importGroups = groupByPassenger(results);
  progressWrap.style.display = 'none';
  renderImportReview();
}

// ==================== IMPORTACION DESDE EXCEL/CSV ====================

window.handleExcelImport = function(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // permitir re-seleccionar el mismo archivo
  if (!file) return;
  startExcelImport(file);
};

async function startExcelImport(file) {
  importGroups = [];
  document.getElementById('import-dropzone').style.display = 'none';
  document.getElementById('import-review-wrap').style.display = 'none';

  const progressWrap = document.getElementById('import-progress-wrap');
  const progressBar = document.getElementById('import-progress-bar');
  const progressLabel = document.getElementById('import-progress-label');
  const progressCount = document.getElementById('import-progress-count');
  progressWrap.style.display = 'block';
  progressLabel.textContent = `Leyendo: ${file.name}`;
  progressCount.textContent = '';
  progressBar.style.width = '30%';

  try {
    await loadXlsx();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (!aoa.length) {
      progressWrap.style.display = 'none';
      document.getElementById('import-dropzone').style.display = 'block';
      showToast('El archivo no tiene filas con datos.', true);
      return;
    }

    // Detectar la fila de encabezado: la primera fila (en las primeras 5)
    // con >=2 columnas reconocidas. Soporta filas de titulo antes del header.
    let headerIdx = -1;
    const fieldOf = {}; // campo -> indice de columna
    for (let i = 0; i < Math.min(aoa.length, 5); i++) {
      const map = {};
      let hits = 0;
      (aoa[i] || []).forEach((cell, ci) => {
        const field = csvField(cell);
        if (field && map[field] == null) { map[field] = ci; hits++; }
      });
      if (hits >= 2) { headerIdx = i; Object.assign(fieldOf, map); break; }
    }

    if (headerIdx === -1) {
      progressWrap.style.display = 'none';
      document.getElementById('import-dropzone').style.display = 'block';
      showToast('No se reconocieron columnas válidas. Revisá los encabezados.', true);
      return;
    }

    const ignored = (aoa[headerIdx] || []).filter(h => String(h).trim() && !csvField(h));
    if (ignored.length) showToast('Columnas no importadas: ' + ignored.join(', '), true);
    progressBar.style.width = '70%';
    progressLabel.textContent = 'Mapeando pasajeros...';

    const dataRows = aoa.slice(headerIdx + 1);
    importGroups = dataRows
      .map(r => excelRowToPassenger(r || [], fieldOf))
      // 1 fila = 1 pasajero; saltar filas vacias (sin apellido ni nombre ni docs)
      .filter(g => g.lastname || g.firstname || g.dni?.num || g.parg?.num)
      .map(g => ({ ...g, _files: [file.name] }));

    progressWrap.style.display = 'none';
    if (!importGroups.length) {
      document.getElementById('import-dropzone').style.display = 'block';
      showToast('No se encontraron pasajeros con datos.', true);
      return;
    }
    renderImportReview();
  } catch (err) {
    console.error('Error leyendo Excel:', err);
    progressWrap.style.display = 'none';
    document.getElementById('import-dropzone').style.display = 'block';
    const libFail = err && err.message === 'xlsx';
    showToast(libFail
      ? 'No se pudo cargar la librería de Excel. Recargá la página.'
      : 'No se pudo leer el archivo. ¿Es un Excel/CSV válido?', true);
  }
}

// Agrupa documentos del mismo pasajero: visa + pasaporte con mismo número de pasaporte,
// o mismo apellido + nombre + fecha de nacimiento como fallback.
function groupByPassenger(results) {
  const groups = []; // cada grupo es el objeto pasajero final

  for (const { mapped, filename } of results) {
    const pnum = (mapped.parg?.num || mapped.pext?.num || '').toUpperCase().trim();
    const nameKey = `${mapped.lastname || ''}|${mapped.firstname || ''}|${mapped.dob || ''}`;

    // Buscar grupo existente por número de pasaporte o por nombre+fecha
    let group = null;
    if (pnum) {
      group = groups.find(g => {
        const gp = (g.parg?.num || g.pext?.num || '').toUpperCase().trim();
        return gp && gp === pnum;
      });
    }
    if (!group && nameKey !== '||') {
      group = groups.find(g => {
        const gk = `${g.lastname || ''}|${g.firstname || ''}|${g.dob || ''}`;
        return gk === nameKey;
      });
    }

    if (!group) {
      // Nuevo pasajero
      group = { ...mapped, _files: [filename] };
      groups.push(group);
    } else {
      // Fusionar: completar campos vacíos y agregar visa si es nueva
      group._files.push(filename);
      const fill = (key, sub) => {
        if (sub) {
          if (!group[key]) { group[key] = mapped[key]; return; }
          // Fusionar subcampos (ej: parg, visa1)
          for (const [k, v] of Object.entries(mapped[key] || {})) {
            if (v && !group[key][k]) group[key][k] = v;
          }
        } else {
          if (!group[key] && mapped[key]) group[key] = mapped[key];
        }
      };
      fill('lastname'); fill('firstname'); fill('dob'); fill('gender'); fill('nationality');
      fill('dni', true); fill('parg', true); fill('pext', true);
    }
    // El primer documento tambien debe usar el formato que guarda el import.
    if (mapped.visa) {
      if (!group.visa1?.num) group.visa1 = mapped.visa;
      else if (!group.visa2?.num) group.visa2 = mapped.visa;
    }
    if (mapped.asistencia) {
      if (!group.asistencias) group.asistencias = [];
      group.asistencias.push(mapped.asistencia);
    }
  }
  return groups;
}

function renderImportReview() {
  const wrap = document.getElementById('import-review-wrap');
  const sub = document.getElementById('import-review-sub');
  const table = document.getElementById('import-review-table');

  sub.textContent = `${importGroups.length} pasajero(s) detectado(s)`;

  let html = '<div style="display:flex;flex-direction:column;gap:12px;">';
  const reviewed = [...passengers];
  importGroups.forEach((g, idx) => {
    const docs = [];
    if (g.parg?.num) docs.push(`Pas. ARG ${esc(g.parg.num)}`);
    if (g.pext?.num) docs.push(`Pas. EXT ${esc(g.pext.num)}`);
    if (g.dni?.num) docs.push(`DNI ${esc(g.dni.num)}`);
    if (g.visa1?.num) docs.push(`Visa ${esc(g.visa1.country || '')} ${esc(g.visa1.num)}`);
    if (g.visa2?.num) docs.push(`Visa ${esc(g.visa2.country || '')} ${esc(g.visa2.num)}`);
    (Array.isArray(g.ffn) ? g.ffn : []).forEach(f => docs.push(`Viajero frecuente ${esc(f.airline || '')}: ${esc(f.number || '')}`));
    if (Array.isArray(g.asistencias)) {
      g.asistencias.forEach(a => { 
        const label = a.compania ? `${esc(a.compania)} ${esc(a.num)}` : esc(a.num);
        if (a.num || a.compania) docs.push(`Asistencia ${label}`); 
      });
    }

    const warn = !g.lastname || !g.firstname || !g.dob;
    const isDup = !!findDuplicateMatch(g, null, reviewed);
    if (!isDup && (g.lastname || g.firstname)) reviewed.push(g);
    html += `
    <div class="card" style="padding:16px 20px;${isDup ? 'border-left:3px solid #9ca3af;opacity:0.7;' : warn ? 'border-left:3px solid #f59e0b;' : ''}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="flex:1;">
          <div style="font-weight:600;font-size:14px;margin-bottom:4px;">
            ${g.lastname ? esc(g.lastname) : '<span style="color:var(--red)">Sin apellido</span>'},
            ${g.firstname ? esc(g.firstname) : '<span style="color:var(--red)">Sin nombre</span>'}
            ${g.dob ? `<span style="font-size:12px;color:var(--text3);font-weight:400;margin-left:8px;">${fmtDate(g.dob)}</span>` : '<span style="color:var(--red);font-size:12px;margin-left:8px;">Sin fecha de nacimiento</span>'}
            ${isDup ? '<span style="font-size:11px;background:#f3f4f6;color:#6b7280;border-radius:4px;padding:2px 7px;margin-left:8px;">Ya existe · se omitirá</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--text2);display:flex;flex-wrap:wrap;gap:6px;">
            ${docs.map(d => `<span class="badge badge-blue">${d}</span>`).join('')}
            ${docs.length === 0 ? '<span style="color:var(--red)">Sin documentos detectados</span>' : ''}
          </div>
          ${g.notes ? `<div style="font-size:12px;margin-top:6px;">Observaciones: ${esc(g.notes)}</div>` : ''}
          ${emergencyContactsOf(g).map(c => `<div style="font-size:12px;">Emergencia: ${esc([c.name, c.relationship, c.phone].filter(Boolean).join(' · '))}</div>`).join('')}
          <div style="font-size:11px;color:var(--text3);margin-top:6px;">Archivos: ${g._files.map(f => esc(f)).join(', ')}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-remove-import="${idx}" title="Quitar este pasajero" style="flex-shrink:0;color:var(--red);" data-no-row-action="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>`;
  });
  html += '</div>';

  table.innerHTML = html;
  wrap.style.display = 'block';
}

window.removeImportGroup = function(idx) {
  importGroups.splice(idx, 1);
  if (importGroups.length === 0) { resetImport(); return; }
  document.getElementById('import-review-sub').textContent = `${importGroups.length} pasajero(s) detectado(s)`;
  renderImportReview();
};

// Busca si un grupo del import ya existe en la base de datos
// por número de pasaporte (primario) o apellido+nombre+fecha (fallback)
function stripDiacritics(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normDupName(v) {
  return stripDiacritics((v || '').toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim());
}

function findDuplicateMatch(g, excludeId = null, candidates = passengers) {
  const pargNum = normScanNumber(g.parg?.num || '');
  const pextNum = normScanNumber(g.pext?.num || '');
  const dniNum  = normScanNumber(g.dni?.num  || '');
  const dniCountry = g.dni?.country || 'ARG';
  const last    = normDupName(g.lastname  || '');
  const first   = normDupName(g.firstname || '');
  const dob     = g.dob || '';

  const original = excludeId ? candidates.find(p => p.id === excludeId) : null;
  const origParg = normScanNumber(original?.parg?.num || '');
  const origPext = normScanNumber(original?.pext?.num || '');
  const origDni  = normScanNumber(original?.dni?.num  || '');

  for (const p of candidates) {
    if (excludeId && p.id === excludeId) continue;

    const existParg = normScanNumber(p.parg?.num || '');
    const existPext = normScanNumber(p.pext?.num || '');
    const existDni  = normScanNumber(p.dni?.num  || '');

    if (pargNum && pargNum !== origParg && (pargNum === existParg || pargNum === existPext)) {
      return { passenger: p, reason: 'parg' };
    }
    if (pextNum && pextNum !== origPext && (pextNum === existParg || pextNum === existPext)) {
      return { passenger: p, reason: 'pext' };
    }
    // DNI: mismo número pero de distinto país (ej. DNI ARG vs cédula CHL) no es duplicado
    if (dniNum && dniNum !== origDni && dniNum === existDni && dniCountry === (p.dni?.country || 'ARG')) {
      return { passenger: p, reason: 'dni' };
    }
    if (last && first && dob &&
        last  === normDupName(p.lastname  || '') &&
        first === normDupName(p.firstname || '') &&
        dob   === (p.dob || '')) {
      return { passenger: p, reason: 'identity' };
    }
  }
  return null;
}

function findDuplicateInDB(g, excludeId = null) {
  return findDuplicateMatch(g, excludeId)?.passenger || null;
}

window.saveImportedPassengers = async function() {
  const btn = document.getElementById('btn-import-save');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px;"></span>Guardando...';

  let ok = 0, skipped = 0, fail = 0;
  // Armar la lista de pasajeros a guardar (mismo filtro que antes, client-side)
  const toSave = [];
  const queued = [];
  let pending = [];
  for (const g of importGroups) {
    if (!g.lastname && !g.firstname) { fail++; continue; }
    if (findDuplicateInDB(g) || findDuplicateMatch(g, null, toSave)) { skipped++; continue; }
    queued.push(g);
    toSave.push({
      lastname: (g.lastname || '').toUpperCase(),
      firstname: (g.firstname || '').toUpperCase(),
      dob: g.dob || '',
      gender: g.gender || 'M',
      nationality: g.nationality || 'ARG',
      cuil: g.cuil || '',
      email: g.email || '',
      whatsapp: g.whatsapp || '',
      notes: g.notes || '',
      emergencyContact: g.emergencyContact || {},
      dni: g.dni || { num: '', issue: '', exp: '' },
      parg: g.parg || { num: '', issue: '', exp: '' },
      pext: g.pext || { country: '', num: '', issue: '', exp: '' },
      visa1: g.visa1 || { country: '', num: '', issued_at: '', type: 'T', issue: '', exp: '', passport: '' },
      visa2: g.visa2 || { country: '', num: '', issued_at: '', type: 'T', issue: '', exp: '', passport: '' },
      asistencias: g.asistencias || [],
      ffn: g.ffn || []
    });
  }

  try {
    if (toSave.length) {
      const ids = await addPassengersBatch(toSave);
      ok = ids.length;
    }
  } catch (err) {
    console.error('Error importando pasajeros masivo (batch):', err);
    ok = err.savedIds?.length || 0;
    fail += toSave.length - ok;
    pending = queued.slice(ok);
  }

  const parts = [];
  if (ok)      parts.push(`${ok} importado(s)`);
  if (skipped) parts.push(`${skipped} ya existían (omitidos)`);
  if (fail)    parts.push(`${fail} con errores`);
  showToast(parts.join(' · '), fail > 0);
  if (pending.length) {
    importGroups = pending;
    renderImportReview();
    btn.disabled = false;
    btn.textContent = 'Reintentar pendientes';
    return;
  }
  resetImport();
  showView('passengers');
};

// ==================== RESERVAS / CHECK-IN ====================

let _resPendingPax = [];
let _resSelectedPax = new Set();      // ids de pasajeros seleccionados en el modal
let _resEditingId = null;
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
      vuelo: p.vuelo || '',
      origen: p.origen || '',
      destino: p.destino || '',
      escalas: Array.isArray(p.escalas) ? p.escalas : [],
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
  for (const r of reservations) {
    for (const p of resPiernas(r)) {
      if (p.done) continue;
      if (legIsDue(p.fecha)) out.push({ id: r.id, r, idx: p.idx, route: p.route, fecha: p.fecha });
    }
  }
  return out;
}

// Viajes cuyo primer tramo cae dentro de los 30 días. Sigue en pantalla
// aunque el mail y el modal ya hayan salido.
function viajesRequisitos(now = Date.now()) {
  const out = [];
  for (const r of reservations) {
    const piernas = resPiernas(r);
    const primera = piernas.map(p => p.fecha).filter(Boolean).sort()[0];
    if (!requisitosAlertDue(primera, now)) continue;
    const primeraP = piernas.find(p => p.fecha === primera) || {};
    const pax = (r.pasajeros || []).map(id => passengers.find(p => p.id === id)).filter(Boolean);
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

// Formatea la fecha del vuelo para mostrar (siempre en horario Argentina)
function fmtResDate(fecha) {
  const t = parseResTs(fecha);
  if (t == null) return '—';
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date(t));
  const get = (p) => (partes.find(x => x.type === p) || {}).value || '';
  const mm = get('month').replace('.', '').toLowerCase();
  return `${get('day')} ${mm} ${get('hour')}:${get('minute')}hs`;
}

// Apellidos de los pasajeros de una reserva (para identificar a simple vista)
function resPaxSurnames(r) {
  const apellidos = (r.pasajeros || [])
    .map(id => passengers.find(p => p.id === id))
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
    .map(id => passengers.find(p => p.id === id)).filter(Boolean).map(paxKey);
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
    const orig = reservations.find(r => r.id === excludeId);
    if (orig) {
      origKeys = new Set();
      const origNames = (orig.pasajeros || [])
        .map(id => passengers.find(p => p.id === id)).filter(Boolean).map(paxKey);
      for (const name of origNames) {
        for (const p of resPiernas(orig)) {
          if (p.vuelo && p.fecha) origKeys.add(tupleKey(name, p.vuelo, p.fecha));
        }
      }
    }
  }

  for (const r of reservations) {
    if (excludeId && r.id === excludeId) continue;
    const existNames = (r.pasajeros || [])
      .map(id => passengers.find(p => p.id === id)).filter(Boolean).map(paxKey);
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

window.renderReservations = function() {
  const list = document.getElementById('reservations-list');
  const count = document.getElementById('reservations-count');
  if (!list) return;

  // Buscador del sector Check ins: filtra por nombre o apellido del pasajero
  const q = stripDiacritics((document.getElementById('reservations-search')?.value || '').toLowerCase());
  const matchesSearch = r => !q || (r.pasajeros || []).some(id => {
    const p = passengers.find(x => x.id === id);
    return p && stripDiacritics(`${p.lastname} ${p.firstname}`.toLowerCase()).includes(q);
  });
  const filtered = reservations.filter(matchesSearch);

  if (count) count.textContent = q
    ? `${filtered.length} de ${reservations.length} check-in(s)`
    : `${reservations.length} check-in(s)`;

  if (!reservations.length) {
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
    const tramosLine = piernas.map(p => `${esc(p.route)} ${fmtResDate(p.fecha)}`).join(' · ') || 'Sin tramos';
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
  const r = reservations.find(x => x.id === id);
  if (!r) return;
  window._viewReservationId = id;
  const pax = reservationViewPassengers(r, passengers);
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
          <span class="info-value">${layout.showLocatorOnLegs && p.reservaVuelo ? `${esc(p.reservaVuelo)} · ` : ''}${fmtResDate(p.fecha)}${p.done ? ' · check-in hecho' : ''}</span>
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
  const r = reservations.find(x => x.id === id);
  if (!r) return;
  _resEditingId = id;
  _resSelectedPax = new Set(r.pasajeros || []);
  const rematch = matchItineraryPassengers((r.pendingPassengers || []).map(p => ({ apellido: p.lastname, nombre: p.firstname })), passengers);
  rematch.ids.forEach(pid => _resSelectedPax.add(pid));
  _resPendingPax = rematch.pending;
  document.getElementById('modal-reservation-title').textContent = 'Editar check-in';
  document.getElementById('res-id').value = id;
  document.getElementById('res-pnr').value = r.pnr || '';
  document.getElementById('res-pnr-raw').value = '';
  document.getElementById('res-alert-email').value = r.alertEmail || '';
  document.getElementById('res-alert-horas').value = String([24, 48, 72].includes(Number(r.alertHorasAntes)) ? Number(r.alertHorasAntes) : 24);
  _resPiernasDraft = storedPiernas(r);
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
  const list = passengers
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

// Click para agregar un pasajero de la lista
document.addEventListener('click', e => {
  const addId = e.target.closest('[data-add-pax]')?.dataset.addPax;
  if (!addId) return;
  _resSelectedPax.add(addId);
  consumePendingForPassenger(passengers.find(p => p.id === addId));
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
  const selected = passengers.filter(p => _resSelectedPax.has(p.id));
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
          <label style="font-size:10px;">Salida *</label>
          <input type="datetime-local" data-field="fecha" value="${escStr(p.fecha)}">
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

// Edicion de campos de cada tramo (delegado en el contenedor).
const _resPiernasWrap = document.getElementById('res-piernas');
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
  const r = reservations.find(x => x.id === id);
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

// Mail de requisitos al crear el check-in. Si falla, el check-in queda
// guardado y el cron de la mañana lo reintenta cuando el viaje entra en
// los 30 días. No se llama al editar.
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

window.saveReservation = async function() {
  const pnr = document.getElementById('res-pnr').value.trim();

  // Sincroniza los inputs del draft (fechas, checkin, aerolínea, ref) antes de guardar.
  window.syncResPiernasDraft();
  // Al editar: si un tramo cambió de fecha o es nuevo, su alerta tiene que
  // poder salir para la fecha nueva -> se resetea notified. Los tramos que
  // conservan vuelo+fecha mantienen su marca (no se reenvía).
  const original = _resEditingId ? reservations.find(x => x.id === _resEditingId) : null;
  const clavesOriginales = new Set((original ? storedPiernas(original) : []).map(p => `${p.fecha}|${(p.vuelo || '').toUpperCase()}`));
  const clavePierna = p => `${p.fecha}|${(p.vuelo || '').toUpperCase()}`;
  const piernas = _resPiernasDraft
    .filter(p => p.fecha) // descarta tramos sin fecha
    .map(p => ({
      fecha: p.fecha,
      vuelo: (p.vuelo || '').toUpperCase(),
      origen: (p.origen || '').toUpperCase(),
      destino: (p.destino || '').toUpperCase(),
      escalas: Array.isArray(p.escalas) ? p.escalas.map(s => String(s).toUpperCase()) : [],
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
    closeModal('modal-reservation');
  } catch (err) {
    console.error('Error guardando check-in:', err);
    showToast('No se pudo guardar el check-in.', true);
  }
};

// ── Interpretar PNR de Amadeus pegado (IA) ──────────────────
// Busca cada pasajero del PNR en la base (passengers en memoria) por
// apellido + primer nombre. Devuelve { encontrados: [ids], noEncontrados: [nombre] }.
function matchPnrPasajeros(pasajeros) {
  const previous = _resPendingPax
    .map(p => ({ apellido: p.lastname, nombre: p.firstname }))
    .filter(p => !isAirlineLocatorName(p.apellido, p.nombre));
  const result = matchItineraryPassengers([...previous, ...(pasajeros || [])], passengers);
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
    const previas = new Map(_resPiernasDraft.map(p => [`${p.fecha}|${(p.vuelo || '').toUpperCase()}`, p]));
    _resPiernasDraft = d.piernas.map(p => {
      const fecha = (p.fecha || '').slice(0, 16);
      const previa = previas.get(`${fecha}|${(p.vuelo || '').toUpperCase()}`);
      return {
        fecha,
        vuelo: p.vuelo || '',
        origen: p.origen || '',
        destino: p.destino || '',
        escalas: Array.isArray(p.escalas) ? p.escalas : [],
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

// ==================== SEGURIDAD (2FA) ====================

// Helper: obtiene un ID token fresco para llamar a las Functions de MFA.
async function _mfaIdToken() {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesión expirada.');
  return await user.getIdToken();
}

function _mfaFnUrl(path) {
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://localhost:8888/.netlify/functions/${path}`
    : `/.netlify/functions/${path}`;
}

// ==================== CIUDADES GDS ====================
let gdsCities = [];

function paintGdsCities() {
  const list = document.getElementById('gds-cities-list');
  if (!list) return;
  list.innerHTML = gdsCities.map(c => {
    const gdsLabel = c.gds === 'sabre' ? 'Sabre' : 'Amadeus';
    if (c.saved && !c.editing) {
      return `<div class="gds-city-card" data-city-id="${escStr(c.id)}">
        <div class="gds-city-gds">${esc(c.title)}<small>${gdsLabel}</small></div>
        <input type="text" data-city-code autocomplete="off" spellcheck="false" placeholder="Codigo de ciudad" value="${escStr(c.code)}" aria-label="Codigo ${escStr(c.title)}">
        <button type="button" class="copy-btn" data-city-copy>copiar</button>
        <button type="button" class="btn btn-ghost btn-sm" data-city-edit>Editar</button>
        <button type="button" class="gds-city-remove" data-city-remove aria-label="Quitar ciudad">x</button>
      </div>`;
    }
    return `<div class="gds-city-card draft" data-city-id="${escStr(c.id)}">
      <input type="text" data-city-title autocomplete="off" placeholder="Ej. Ciudad Ricale" value="${escStr(c.title)}" aria-label="Titulo">
      <select data-city-gds aria-label="GDS">
        <option value="amadeus"${c.gds === 'amadeus' ? ' selected' : ''}>Amadeus</option>
        <option value="sabre"${c.gds === 'sabre' ? ' selected' : ''}>Sabre</option>
      </select>
      <input type="text" data-city-code autocomplete="off" spellcheck="false" placeholder="Codigo de ciudad" value="${escStr(c.code)}" aria-label="Codigo de ciudad">
      <button type="button" class="btn btn-primary btn-sm" data-city-save>Guardar</button>
      <button type="button" class="gds-city-remove" data-city-remove aria-label="Quitar ciudad">x</button>
    </div>`;
  }).join('');
}

async function persistGdsCities() {
  try {
    await saveGdsCities(persistable(gdsCities));
  } catch (err) {
    console.warn('[Ciudades] No se pudo guardar:', err?.message || err);
    showToast('No se pudieron guardar las ciudades.', true);
  }
}

function scheduleSaveGdsCities() {
  clearTimeout(scheduleSaveGdsCities._t);
  scheduleSaveGdsCities._t = setTimeout(() => persistGdsCities(), 400);
}

function cityIsSaved(id) {
  return gdsCities.some(c => c.id === id && c.saved);
}

async function loadGdsCities() {
  const list = document.getElementById('gds-cities-list');
  if (list && !gdsCities.length) list.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:12px;">Cargando…</div>';
  try {
    gdsCities = fromStorage(await getGdsCities());
  } catch (err) {
    console.warn('[Ciudades] No se pudo leer:', err?.message || err);
    gdsCities = [];
  }
  paintGdsCities();
}

document.getElementById('gds-cities-list')?.addEventListener('input', e => {
  const card = e.target.closest('[data-city-id]');
  if (!card) return;
  const id = card.dataset.cityId;
  if (e.target.matches('[data-city-code]')) {
    gdsCities = updateCity(gdsCities, id, { code: e.target.value });
    if (cityIsSaved(id)) scheduleSaveGdsCities();
  } else if (e.target.matches('[data-city-title]')) {
    gdsCities = updateCity(gdsCities, id, { title: e.target.value });
  }
});
document.getElementById('gds-cities-list')?.addEventListener('change', e => {
  const card = e.target.closest('[data-city-id]');
  if (!card || !e.target.matches('[data-city-gds]')) return;
  gdsCities = updateCity(gdsCities, card.dataset.cityId, { gds: e.target.value });
});
document.getElementById('gds-cities-list')?.addEventListener('click', e => {
  const card = e.target.closest('[data-city-id]');
  if (!card) return;
  const id = card.dataset.cityId;
  if (e.target.closest('[data-city-copy]')) {
    window.copyText(e.target.closest('[data-city-copy]'), copyValue(gdsCities, id));
    return;
  }
  if (e.target.closest('[data-city-edit]')) {
    gdsCities = editCity(gdsCities, id);
    paintGdsCities();
    document.querySelector(`#gds-cities-list [data-city-id="${CSS.escape(id)}"] [data-city-title]`)?.focus();
    return;
  }
  if (e.target.closest('[data-city-save]')) {
    const title = card.querySelector('[data-city-title]')?.value || '';
    const gds = card.querySelector('[data-city-gds]')?.value || 'amadeus';
    const code = card.querySelector('[data-city-code]')?.value || '';
    const next = saveCity(gdsCities, id, { title, gds, code });
    if (!next.find(c => c.id === id)?.saved) {
      showToast('Poné un titulo para guardar.', true);
      return;
    }
    gdsCities = next;
    paintGdsCities();
    persistGdsCities();
    return;
  }
  if (e.target.closest('[data-city-remove]')) {
    gdsCities = removeCity(gdsCities, id);
    paintGdsCities();
    persistGdsCities();
  }
});
document.getElementById('btn-gds-city-add')?.addEventListener('click', () => {
  gdsCities = addCity(gdsCities, { gds: 'amadeus' });
  paintGdsCities();
  const titles = document.querySelectorAll('#gds-cities-list [data-city-title]');
  titles[titles.length - 1]?.focus();
});

window.renderSecurity = function() {
  const selfEl = document.getElementById('security-self-status');
  const adminBlock = document.getElementById('security-admin-block');
  if (selfEl) {
    const enrolled = auth.currentUser ? multiFactor(auth.currentUser).enrolledFactors.length > 0 : false;
    selfEl.innerHTML = enrolled
      ? `<span class="badge badge-green">2FA activo</span> Tu cuenta usa Google Authenticator.`
      : `<span class="badge badge-red">2FA pendiente</span> Activá el autenticador (cerrá sesión y volvé a ingresar).`;
  }
  // Solo owner/admin ven el bloque de gestión de miembros.
  const canManage = currentUserRole === 'owner' || currentUserRole === 'admin';
  if (adminBlock) adminBlock.style.display = canManage ? '' : 'none';
  if (canManage) window.loadSecurityMembers();
};

window.loadSecurityMembers = async function() {
  const list = document.getElementById('security-members-list');
  if (!list) return;
  list.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:12px;">Cargando miembros…</div>';
  try {
    const idToken = await _mfaIdToken();
    const res = await fetch(_mfaFnUrl('mfa-admin') + '?members=1', {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    const json = await res.json();
    if (!res.ok || json.error) { list.innerHTML = `<div style="padding:12px;color:var(--red);font-size:12px;">${esc(json.error || 'Error')}</div>`; return; }
    const members = json.members || [];
    if (!members.length) { list.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:12px;">Sin miembros.</div>'; return; }
    list.innerHTML = members.map(m => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-size:13px;">${esc(m.displayName || m.email || m.uid)}</div>
          <div style="font-size:11px;color:var(--text3);">${esc(m.email || '')} · ${esc(m.role || '')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="badge badge-${m.mfaEnrolled ? 'green' : 'red'}">${m.mfaEnrolled ? '2FA activo' : 'pendiente'}</span>
          <button class="btn btn-ghost btn-sm" data-mfa-reset="${escStr(m.uid)}" data-no-row-action="true">Resetear</button>
        </div>
      </div>`).join('');
  } catch (err) {
    console.error('Error cargando miembros 2FA:', err);
    list.innerHTML = '<div style="padding:12px;color:var(--red);font-size:12px;">No se pudo cargar.</div>';
  }
};

// Click delegado: resetear 2FA de un miembro.
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-mfa-reset]');
  if (!btn) return;
  const targetUid = btn.dataset.mfaReset;
  const recoveryCode = prompt(`Ingresá un código de recuperación del miembro (otorgado por él):`);
  if (!recoveryCode) return;
  btn.disabled = true; btn.textContent = 'Reseteando…';
  try {
    const idToken = await _mfaIdToken();
    const res = await fetch(_mfaFnUrl('mfa-admin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({ action: 'reset', targetUid, recoveryCode })
    });
    const json = await res.json();
    if (!res.ok || json.error) { showToast(json.error || 'No se pudo resetear.', true); btn.disabled = false; btn.textContent = 'Resetear'; return; }
    showToast('2FA reseteado. El miembro debe re-configurar su autenticador.');
    window.loadSecurityMembers();
  } catch (err) {
    console.error('Error reseteando 2FA:', err);
    showToast('No se pudo resetear.', true);
    btn.disabled = false; btn.textContent = 'Resetear';
  }
});

document.getElementById('btn-security-refresh')?.addEventListener('click', () => window.loadSecurityMembers());

// ==================== REQUISITOS DE VUELO ====================


// Limpiar vista de resultados
window.resetTravelView = function() {
  document.getElementById('tv-vuelo').value = '';
  document.getElementById('tv-origen').value = '';
  document.getElementById('tv-destino').value = '';
  document.getElementById('tv-fecha').value = '';
  document.getElementById('tv-nacionalidad').selectedIndex = 0; // más robusto que comparar strings
  document.getElementById('tv-results').style.display = 'none';
  document.getElementById('tv-results').innerHTML = '';
  document.getElementById('tv-hint').textContent = '';
  _pdfSegmentos = [];
  const pdfFile = document.getElementById('tv-pdf-file');
  if (pdfFile) pdfFile.value = '';
  const pdfPreview = document.getElementById('pdf-preview');
  if (pdfPreview) { pdfPreview.style.display = 'none'; pdfPreview.innerHTML = ''; }
  const pdfMsg = document.getElementById('tv-pdf-msg');
  if (pdfMsg) {
    pdfMsg.style.color = 'var(--text3)';
    pdfMsg.textContent = 'Se leen los vuelos en este equipo. No se sube el archivo.';
  }
};

// Consulta principal
// ── Estado del modo GDS ──────────────────────────────────────
let _travelMode      = 'single'; // 'single' | 'gds' | 'pdf'
let _parsedSegmentos = [];       // [{vuelo, origen, destino, fecha}]
let _pdfSegmentos    = [];

window.setTravelMode = function(mode) {
  _travelMode = mode;
  document.getElementById('travel-panel-single').style.display = mode === 'single' ? '' : 'none';
  document.getElementById('travel-panel-gds').style.display   = mode === 'gds'    ? '' : 'none';
  document.getElementById('travel-panel-pdf').style.display   = mode === 'pdf'    ? '' : 'none';
  document.getElementById('btn-mode-single').classList.toggle('active', mode === 'single');
  document.getElementById('btn-mode-gds').classList.toggle('active',    mode === 'gds');
  document.getElementById('btn-mode-pdf').classList.toggle('active',    mode === 'pdf');
  document.getElementById('tv-results').style.display = 'none';
};

// Parser de segmentos GDS (Amadeus, Galileo, Sabre, WorldSpan)
// Acepta múltiples formatos — con o sin número de segmento, con o sin clase, con o sin horarios.
function parseGDSSegmentos(texto) {
  const resultados = [];
  for (const linea of texto.split('\n')) {
    const l = linea.toUpperCase().trim();
    if (!l) continue;

    let m;

    // Formato 1: Amadeus clásico con día*ORIGDEST
    // Ej: "2  MU 746 R 28APR 2*EZEPVG HK1  0215 1810  29APR  E  CA/QBRHFZ"
    m = l.match(/^\s*(?:\d{1,3}\s+)?([A-Z]{2}[0-9A-Z]?)\s*(\d{1,4})\s+[A-Z]\s+(\d{1,2}[A-Z]{3}(?:\d{2,4})?)\s+\d\*([A-Z]{3})([A-Z]{3})/);
    if (m) { resultados.push({ vuelo: m[1]+m[2], origen: m[4], destino: m[5], fecha: m[3] }); continue; }

    // Formato 2: ORIG y DEST separados por espacio, con o sin día
    // Ej: "2  MU 746 R 28APR 2 EZE PVG HK1"  o  "MU 746 R 28APR EZE PVG"
    m = l.match(/^\s*(?:\d{1,3}\s+)?([A-Z]{2}[0-9A-Z]?)\s*(\d{1,4})\s+[A-Z]\s+(\d{1,2}[A-Z]{3}(?:\d{2,4})?)\s+(?:\d\*?\s*)?([A-Z]{3})\s+([A-Z]{3})/);
    if (m) { resultados.push({ vuelo: m[1]+m[2], origen: m[4], destino: m[5], fecha: m[3] }); continue; }

    // Formato 3: ORIGDEST sin día* (Galileo/Sabre/WorldSpan)
    // Ej: "MU746 R 28APR EZEPVG HK1"
    m = l.match(/^\s*(?:\d{1,3}\s+)?([A-Z]{2}[0-9A-Z]?)\s*(\d{1,4})\s+[A-Z]\s+(\d{1,2}[A-Z]{3}(?:\d{2,4})?)\s+([A-Z]{3})([A-Z]{3})\s+(?:HK|HL|SS|UN|WK|GK|TK|RR|DK|SC|KK)/);
    if (m) { resultados.push({ vuelo: m[1]+m[2], origen: m[4], destino: m[5], fecha: m[3] }); continue; }

    // Formato 4: Sin clase explícita — más flexible
    // Ej: "MU746 28APR EZE-PVG"  o  "MU 746 28APR EZEPVG"
    m = l.match(/^\s*(?:\d{1,3}\s+)?([A-Z]{2}[0-9A-Z]?)\s*(\d{1,4})\s+(?:[A-Z]\s+)?(\d{1,2}[A-Z]{3}(?:\d{2,4})?)\s+(?:\d\*?\s*)?([A-Z]{3})[- ]?([A-Z]{3})/);
    if (m) { resultados.push({ vuelo: m[1]+m[2], origen: m[4], destino: m[5], fecha: m[3] }); continue; }

    // Formato 5: ORIG DEST DATE HORA > HORA AIRLINE FLTNUM [CLASE]
    // Ej: "EZE MIA 15JUL 21:00 > 05:00 +1 AA 0900 V"
    m = l.match(/^([A-Z]{3})\s+([A-Z]{3})\s+(\d{1,2}[A-Z]{3}(?:\d{2,4})?)\s+\d{1,2}:\d{2}.*?([A-Z]{2}[0-9A-Z]?)\s*(\d{1,4})/);
    if (m) { resultados.push({ vuelo: m[4]+m[5], origen: m[1], destino: m[2], fecha: m[3] }); continue; }
  }
  return resultados;
}

function pintarTramos(preview, segmentos) {
  if (!preview) return;
  if (!segmentos.length) {
    preview.style.display = 'none';
    preview.innerHTML = '';
    return;
  }
  const n = segmentos.length;
  let html = `<div class="gds-segment-preview">
    <div class="gds-seg-header">${n} tramo${n > 1 ? 's' : ''} detectado${n > 1 ? 's' : ''}</div>`;
  for (const s of segmentos) {
    html += `<div class="gds-seg-row">
      <span style="font-family:var(--mono);font-weight:700;color:var(--accent);min-width:72px;">${esc(s.vuelo)}</span>
      <span style="color:var(--text2);">${esc(s.origen)}</span>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="color:var(--text3);flex-shrink:0;"><path d="M3 8h10M10 5l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span style="color:var(--text2);">${esc(s.destino)}</span>
      <span style="font-size:11px;color:var(--text3);margin-left:auto;font-family:var(--mono);">${esc(s.fecha)}</span>
    </div>`;
  }
  html += '</div>';
  preview.innerHTML = html;
  preview.style.display = 'block';
}

window.parsearGDS = function() {
  const texto = (document.getElementById('tv-gds-text')?.value || '');
  _parsedSegmentos = parseGDSSegmentos(texto);
  pintarTramos(document.getElementById('gds-preview'), _parsedSegmentos);
};

function msgPdf(texto, error) {
  const el = document.getElementById('tv-pdf-msg');
  if (!el) return;
  el.style.color = error ? 'var(--red)' : 'var(--text3)';
  el.textContent = texto;
}

const PDFJS_VER = '4.10.38';
let _pdfjsPromise = null;

function cargarPdfjs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  const base = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/`;
  _pdfjsPromise = (async () => {
    const pdfjs = await import(base + 'pdf.min.mjs');
    // worker-src es solo 'self' y blob. El worker del CDN se baja y se corre como blob.
    const res = await fetch(base + 'pdf.worker.min.mjs');
    if (!res.ok) throw new Error('worker');
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'text/javascript' }));
    return pdfjs;
  })().catch(err => {
    _pdfjsPromise = null;
    throw err;
  });
  return _pdfjsPromise;
}

window.leerItinerarioPdf = async function(file) {
  const { parseItinerarioTexto, fechaIso, textoDesdeItems, claseItinerario, normalizarOcr } = await loadItinerario();
  const preview = document.getElementById('pdf-preview');
  _pdfSegmentos = [];
  if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
  if (!file) return;
  const clase = claseItinerario(file);
  if (!clase) { msgPdf('Adjuntá un PDF o una foto.', true); return; }
  if (clase === 'pdf' && file.size > 8 * 1024 * 1024) { msgPdf('El PDF pesa más de 8 MB.', true); return; }
  if (clase === 'imagen' && file.size > 20 * 1024 * 1024) { msgPdf('La foto pesa más de 20 MB.', true); return; }
  msgPdf(clase === 'imagen' ? 'Leyendo la foto...' : 'Leyendo el itinerario...');
  try {
    let texto = '';
    if (clase === 'pdf') {
      const pdfjs = await cargarPdfjs();
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjs.getDocument({ data }).promise;
      if (doc.numPages > 20) { msgPdf('El PDF es demasiado largo.', true); return; }
      const partes = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        partes.push(textoDesdeItems(content.items));
      }
      texto = partes.join('\n');
    } else {
      const { textoDeImagen, prepareImageForScan } = await loadScanner();
      texto = normalizarOcr(await textoDeImagen(await prepareImageForScan(file)));
    }
    let todos = parseItinerarioTexto(texto);
    if (!todos.length) todos = parseGDSSegmentos(texto);
    const segs = todos.slice(0, 12);
    if (!segs.length) {
      msgPdf(clase === 'imagen'
        ? 'No encontré vuelos en esa foto. Tiene que verse el número de vuelo, la fecha y los aeropuertos.'
        : 'No encontré vuelos en ese PDF. Tiene que verse el número de vuelo, la fecha y los aeropuertos.', true);
      return;
    }
    _pdfSegmentos = segs;
    const iso = fechaIso(segs[0].fecha);
    const fechaEl = document.getElementById('tv-fecha');
    if (iso && fechaEl) fechaEl.value = iso;
    pintarTramos(preview, segs);
    let msg = segs.length + (segs.length > 1 ? ' tramos listos para consultar.' : ' tramo listo para consultar.');
    if (todos.length > segs.length) msg += ' Se toman los primeros 12.';
    msgPdf(msg);
  } catch (err) {
    console.error('itinerario pdf:', err && err.message ? err.message : err);
    msgPdf(clase === 'imagen'
      ? 'No pude leer esa foto. Probá con una más nítida o pegá los segmentos en GDS.'
      : 'No pude leer ese PDF. Probá de nuevo o pegá los segmentos en GDS.', true);
  }
};

// ── Consultar requisitos (modo individual o GDS) ─────────────


window.consultarVuelo = async function() {
  const nacionalidad = document.getElementById('tv-nacionalidad').value;
  if (!nacionalidad) { showToast('Seleccioná la nacionalidad del pasajero'); return; }

  let bodyPayload;

  if (_travelMode === 'gds' || _travelMode === 'pdf') {
    if (_travelMode === 'gds') {
      parsearGDS();
      if (_parsedSegmentos.length === 0) {
        showToast('Pegá los segmentos GDS — no se detectaron tramos válidos');
        document.getElementById('tv-gds-text')?.focus();
        return;
      }
    } else if (_pdfSegmentos.length === 0) {
      showToast('Adjuntá el itinerario en PDF');
      document.getElementById('btn-pdf-itinerario')?.focus();
      return;
    }
    const fecha = document.getElementById('tv-fecha').value;
    const segmentos = _travelMode === 'pdf' ? _pdfSegmentos : _parsedSegmentos;
    bodyPayload = { segmentos, fecha, nacionalidad };

  } else {
    const vuelo  = (document.getElementById('tv-vuelo').value  || '').trim().toUpperCase();
    const origen  = (document.getElementById('tv-origen').value || '').trim().toUpperCase();
    const destino = (document.getElementById('tv-destino').value|| '').trim().toUpperCase();
    const fecha   = document.getElementById('tv-fecha').value;

    if (!vuelo) { showToast('Ingresá el número de vuelo'); document.getElementById('tv-vuelo').focus(); return; }
    if (!/^[A-Z0-9]{2,3}\d{1,5}$/.test(vuelo)) {
      showToast('Formato inválido. Ejemplos: MU746, AR1102, AA100');
      document.getElementById('tv-vuelo').focus();
      return;
    }
    if (!origen || origen.length !== 3) {
      showToast('Ingresá el origen (código IATA de 3 letras, ej: EZE)');
      document.getElementById('tv-origen').focus();
      return;
    }
    if (!destino || destino.length !== 3) {
      showToast('Ingresá el destino (código IATA de 3 letras, ej: AUA)');
      document.getElementById('tv-destino').focus();
      return;
    }
    bodyPayload = { vuelo, origen, destino, fecha, nacionalidad };

    const hintEl = document.getElementById('tv-hint');
    if (hintEl) hintEl.textContent = '';
  }

  // Split en 2 llamadas: la 1ra (analisis) arma ruta + requisitos base dentro
  // del limite de 26s de Netlify; la 2da (verificacion) corre la verificacion
  // web con presupuesto propio. Sin esto, el Paso 2b compitia por tiempo y se
  // salteaba (requisitos sin URL oficial / formularios omitidos).
  bodyPayload.fase = 'analisis';

  // Resetear estado del módulo antes de cada consulta nueva
  _travelStops  = [];
  _passportCode = 'ARG';

  const btn = document.getElementById('tv-btn-consultar');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span>Consultando directamente...';

  const resultsEl = document.getElementById('tv-results');
  resultsEl.style.display = 'block';
  const modoLabel = bodyPayload.segmentos
    ? `${bodyPayload.segmentos.length} tramos del itinerario`
    : `vuelo ${bodyPayload.vuelo || ''}`;
  resultsEl.innerHTML = `
    <div class="card" style="padding:40px;text-align:center;">
      <div class="scan-spinner" style="width:24px;height:24px;border-width:3px;margin:0 auto 14px;"></div>
      <div style="font-size:14px;font-weight:500;color:var(--text2);">Analizando ${modoLabel}...</div>
    </div>`;

  // Timeout de 60 segundos (itinerarios multi-segmento pueden tardar más)
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 60000);

  try {
    const fnUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:8888/.netlify/functions/gemini-travel'
      : '/.netlify/functions/gemini-travel';

    // ID token de Firebase Auth para autenticar la function
    const currentUser = auth.currentUser;
    if (!currentUser) { showToast('Sesión expirada. Volvé a ingresar.'); return; }
    const idToken = await currentUser.getIdToken();

    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const json = await res.json();

    if (!res.ok || json.error) {
      resultsEl.innerHTML = `
        <div class="scan-error" style="margin:0;">
          ⚠ ${(json.error || 'Error al consultar. Intentá de nuevo.').replace(/</g,'&lt;')}
        </div>`;
      return;
    }

    const tr = await loadTravelReqs();
    tr.injectKnownForms(json.data, nacionalidad);
    tr.injectKnownAlerts(json.data, nacionalidad);
    await renderTravelResult(json.data, resultsEl);

    // 2da llamada (split): verificacion web con presupuesto propio de 26s.
    // Completa URLs oficiales + agrega requisitos omitidos, y re-renderiza.
    // Graceful: si falla, queda lo de la fase analisis.
    const verifyBanner = document.createElement('div');
    verifyBanner.className = 'card';
    verifyBanner.style.cssText = 'padding:14px 18px;margin-top:14px;text-align:center;font-size:13px;color:var(--text2);';
    verifyBanner.textContent = 'Verificando requisitos en la web...';
    resultsEl.appendChild(verifyBanner);
    btn.innerHTML = '<span class="btn-spinner"></span>Verificando en la web...';

    try {
      const vController = new AbortController();
      const vTimeout = setTimeout(() => vController.abort(), 30000);
      const vRes = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          fase: 'verificacion',
          ruta: json.data.ruta,
          nacionalidad,
          ...(Array.isArray(bodyPayload.segmentos) ? { segmentos: bodyPayload.segmentos } : {})
        }),
        signal: vController.signal
      });
      clearTimeout(vTimeout);
      const vJson = await vRes.json();

      if (vRes.ok && vJson.data && Array.isArray(vJson.data.ruta)) {
        json.data.ruta = vJson.data.ruta;
        json.data._meta = { ...json.data._meta, ...vJson.data._meta };
        tr.injectKnownForms(json.data, nacionalidad);
        tr.injectKnownAlerts(json.data, nacionalidad);
        await renderTravelResult(json.data, resultsEl);
      } else if (json.data._meta) {
        json.data._meta.verificoWeb = false;
      }
    } catch (_) {
      if (json.data._meta) json.data._meta.verificoWeb = false;
      // sin verificacion web: queda el resultado base de la fase analisis
    } finally {
      verifyBanner.remove();
    }

  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err.name === 'AbortError'
      ? 'La consulta tardó demasiado (55s). Intentá de nuevo.'
      : 'No se pudo conectar con el servidor. Verificá tu conexión.';
    resultsEl.innerHTML = `<div class="scan-error" style="margin:0;">⚠ ${msg}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Consultar requisitos`;
  }
};

// Estado del módulo de viaje
let _travelStops    = [];
let _passportCode   = 'ARG';

function iatasDeStop(stop) {
  if (Array.isArray(stop?.aeropuertos) && stop.aeropuertos.length) return stop.aeropuertos;
  const iata = String(stop?.aeropuerto_iata || '').toUpperCase();
  return iata ? [iata] : [];
}

function subtituloTab(stop) {
  const iatas = iatasDeStop(stop);
  if (iatas.length > 1) return iatas.join(' · ');
  const ciudad = (Array.isArray(stop?.ciudades) && stop.ciudades[0]) || stop?.ciudad || '';
  if (iatas[0] && ciudad) return iatas[0] + ' · ' + ciudad;
  return iatas[0] || '';
}

function recorridoPais(stop) {
  const iatas = iatasDeStop(stop);
  const ciudades = Array.isArray(stop?.ciudades) ? stop.ciudades : [];
  if (!iatas.length) return '';
  return iatas.map((code, i) => {
    const c = ciudades[i];
    return c ? `${c} (${code})` : code;
  }).join(' · ');
}

// Seleccionar pestaña de parada — muestra tarjetas de requisitos
window.selectTravelStop = async function(idx) {
  document.querySelectorAll('.stop-tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
  });

  const stop  = _travelStops[idx];
  const panel = document.getElementById('sherpa-panel');
  if (!panel || !stop) return;

  const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';


  // Punto de partida — sin requisitos
  if (stop.tipo === 'origen') {
    panel.innerHTML = `<div class="sherpa-origin-msg">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style="margin:0 auto 10px;display:block;color:var(--text3);"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="12" cy="9" r="2.5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
      <div style="font-size:13px;font-weight:500;color:var(--text2);">Punto de partida</div>
      <div style="font-size:12px;margin-top:4px;">No se requieren requisitos de ingreso en el origen.</div>
    </div>`;
    return;
  }

  const fromCode  = (_passportCode || 'ARG').replace(/[^A-Z]/g, '').slice(0, 3);
  const toCode    = (stop.pais_codigo || '').replace(/[^A-Z]/g, '').slice(0, 3);
  const tr = await loadTravelReqs();
  const view = tr.planTravelStopView(stop);
  const { migratorios, salud } = view;

  // Etiqueta y color por categoría
  const CAT_LABEL = { visa:'VISA', evisa:'eVISA', eta:'eTA', visa_transito:'TRÁNSITO', vacuna:'VACUNA', medicacion:'MEDICACIÓN', plf:'PLF', declaracion_salud:'DECLARACIÓN', seguro_medico:'SEGURO', otro:'REQUISITO' };
  const CAT_CLASS = { visa:'cat-visa', evisa:'cat-evisa', eta:'cat-eta', visa_transito:'cat-transito', vacuna:'cat-vacuna', medicacion:'cat-medicacion', plf:'cat-plf', declaracion_salud:'cat-plf', seguro_medico:'cat-seguro', otro:'cat-otro' };

  // Renderizado de una tarjeta de requisito (reutilizable)
  const renderCard = req => {
    const cat   = (req.categoria || 'otro').toLowerCase().replace(/-/g,'_');
    const label = CAT_LABEL[cat] || 'REQUISITO';
    const cls   = CAT_CLASS[cat] || 'cat-otro';
    const url   = safeUrl(req.url_oficial);
    return `
      <div class="req-card">
        <div class="req-card-header">
          <span class="req-cat ${cls}">${label}</span>
          <span class="${req.obligatorio ? 'req-obligatorio' : 'req-opcional'}">${req.obligatorio ? 'Obligatorio' : 'Recomendado'}</span>
        </div>
        <div class="req-nombre">${esc(req.nombre)}</div>
        <div class="req-desc">${esc(req.descripcion)}</div>
        ${req.motivo_origen ? `<div class="req-motivo">🌐 ${esc(req.motivo_origen)}</div>` : ''}
        ${req.nota_fuentes && !/Matriz de visados|Matriz de sanidad/.test(req.nota_fuentes) ? `<div class="req-nota-fuentes" title="${esc(req.nota_fuentes)}">⚠ Nota oficial — ver detalle</div><div class="req-nota-detalle">${esc(req.nota_fuentes)}</div>` : ''}
        <div class="req-meta">
          ${req.costo_aproximado        ? `<span class="req-meta-item">💰 ${esc(req.costo_aproximado)}</span>` : ''}
          ${req.anticipacion_recomendada? `<span class="req-meta-item">⏱ ${esc(req.anticipacion_recomendada)}</span>` : ''}
          ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="req-link" style="margin-left:auto;">Sitio oficial →</a>` : ''}
        </div>
      </div>`;
  };

  let html = '<div class="req-panel">';

  const recorrido = recorridoPais(stop);
  if (recorrido) {
    html += `<div class="req-recorrido">${esc(recorrido)}</div>`;
  }

  if (view.showEmptyState) {
    html += `<div class="req-libre">
      <div style="font-size:13px;color:var(--text3);">Sin requisitos especiales detectados para esta parada.<br>Verificá con TIMATIC antes de emitir.</div>
    </div>`;
  } else if (view.showLibreBanner && !view.showMigratorioCards && !view.showHealthSection) {
    html += `<div class="req-libre">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" style="margin:0 auto;display:block;color:var(--green);"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="req-libre-title">Libre de visa</div>
      <div class="req-libre-sub">Pasaporte ${esc(fromCode)} ingresa sin visa a ${esc(stop.pais || stop.ciudad || toCode)}.</div>
    </div>`;
  } else {
    if (view.showLibreBanner || view.showMigratorioCards) {
      html += `<div class="req-section-title">Requisitos migratorios</div>`;
      if (view.showLibreBanner) {
        html += `<div class="req-libre" style="padding:14px;">
          <div class="req-libre-title" style="font-size:14px;">Libre de visa</div>
          <div class="req-libre-sub">Pasaporte ${esc(fromCode)} ingresa sin visa a ${esc(stop.pais || stop.ciudad || toCode)}.</div>
        </div>`;
      }
      if (view.showMigratorioCards) {
        migratorios.forEach(r => { html += renderCard(r); });
      }
    }

    if (view.showHealthSection) {
      html += `<div class="req-section-title">Riesgos y requisitos de salud</div>`;
      if (salud.length === 0) {
        const cdcUrl = `https://wwwnc.cdc.gov/travel/destinations/list`;
        html += `<div class="req-libre" style="padding:14px;">
          <div style="font-size:13px;color:var(--text3);">Sin alertas sanitarias específicas para esta parada.<br>
            <a href="${esc(cdcUrl)}" target="_blank" rel="noopener noreferrer" class="req-link">Verificá con CDC →</a>
          </div>
        </div>`;
      } else {
        salud.forEach(r => { html += renderCard(r); });
      }
    }
  }

  if (stop.notas) {
    html += `<div class="req-notas">📌 ${esc(stop.notas)}</div>`;
  }

  html += '</div>';

  // Barra inferior: disclaimer (sin links externos)
  html += `<div class="req-verificar">
    <span style="font-size:11px;color:var(--text3);font-weight:500;">⚠ Datos orientativos — verificar antes de emitir.</span>
  </div>`;

  panel.innerHTML = html;
};

// Renderizar resultados
async function renderTravelResult(data, container) {
  if (!data || typeof data !== 'object') {
    container.innerHTML = `<div class="scan-error" style="margin:0;">⚠ Respuesta inesperada del servidor. Intentá de nuevo.</div>`;
    return;
  }
  const v = data.vuelo || {};
  const ruta = data.ruta || [];
  const alertas = data.alertas_criticas || [];

  // Extraer código de pasaporte de la nacionalidad seleccionada ("Argentina (ARG)" → "ARG")
  const rawNac    = document.getElementById('tv-nacionalidad')?.value || '';
  const nacMatch  = rawNac.match(/\(([A-Z]{3})\)/);
  _passportCode   = nacMatch ? nacMatch[1] : 'ARG';
  const tr = await loadTravelReqs();
  _travelStops    = tr.paradasVisibles(ruta, _passportCode);

  // Barra de info del vuelo
  const confianzaClass = { alta: 'confianza-alta', media: 'confianza-media', baja: 'confianza-baja' }[v.confianza_ruta] || 'confianza-media';
  let html = `
    <div class="flight-info-bar">
      <div class="flight-info-item">
        <span class="flight-info-label">Vuelo</span>
        <span class="flight-info-value mono">${esc(v.numero)}</span>
      </div>
      <div class="flight-info-item">
        <span class="flight-info-label">Aerolínea</span>
        <span class="flight-info-value">${esc(v.aerolinea)}</span>
      </div>
      <div class="flight-info-item">
        <span class="flight-info-label">Ruta</span>
        <span class="flight-info-value mono">${esc(v.origen_iata)} → ${esc(v.destino_iata)}</span>
      </div>
      ${v.duracion_aproximada ? `<div class="flight-info-item">
        <span class="flight-info-label">Duración</span>
        <span class="flight-info-value">${esc(v.duracion_aproximada)}</span>
      </div>` : ''}
      <div class="flight-info-item">
        <span class="flight-info-label">Certeza de ruta</span>
        <span class="confianza-badge ${confianzaClass}">${esc(v.confianza_ruta || 'media')}</span>
      </div>
    </div>`;

  // Nota de ruta si hay
  if (v.nota_ruta) {
    html += `<div style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--accent);margin-bottom:16px;padding:12px 14px;background:var(--accent-light);border-radius:8px;border:1px solid var(--accent);border-left:4px solid var(--accent);">
      ℹ ${esc(v.nota_ruta)}
    </div>`;
  }

  // Panel de alertas críticas. La leyenda de licencia va siempre,
  // aunque el vuelo no tenga otras alertas.
  html += `<div class="travel-alerts-panel">
    <div class="travel-alerts-title">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 13H2L8 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/><path d="M8 6v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r=".75" fill="currentColor"/></svg>
      ALERTAS CRÍTICAS — Comunicar al pasajero antes de volar
    </div>`;
  alertas.forEach(a => {
    html += `<div class="travel-alert-item"><span>⚠</span><span>${esc(a)}</span></div>`;
  });
  html += `<div class="travel-alert-item"><span>⚠</span><span>Si alquila un auto, recuerde <a href="https://www.aca.org.ar/popup/requisitos-registro-internacional-2/" target="_blank" rel="noopener noreferrer" class="req-link">licencia internacional</a> y licencia nacional vigente.</span></div>`;
  html += `</div>`;

  // Ruta: pestañas de paradas
  if (ruta.length === 0) {
    html += `<div class="card" style="padding:32px;text-align:center;color:var(--text3);">
      No se pudo determinar la ruta para este vuelo. Verificá el número e intentá de nuevo.
    </div>`;
    container.innerHTML = html;
    return;
  }

  // Pestañas
  html += `<div class="stop-tabs">`;
  _travelStops.forEach((stop, idx) => {
    const esTecnica   = stop.tipo === 'parada_tecnica';
    // Badge "Requisitos" si hay tarjetas (aunque el modelo marque alerta:false,
    // ej. ARG exento de visa en China pero con Tarjeta de Llegada obligatoria)
    // y no solo cuando el modelo marca alerta.
    const tieneAlerta = stop.alerta || (Array.isArray(stop.requisitos) && stop.requisitos.length > 0);
    const tabClass    = esTecnica ? 'tecnica' : tieneAlerta ? 'alerta' : '';
    const badge = esTecnica
      ? `<span class="stop-tab-badge tecnica">Parada técnica</span>`
      : tieneAlerta
        ? `<span class="stop-tab-badge alerta">Requisitos</span>`
        : stop.tipo !== 'origen'
          ? `<span class="stop-tab-badge ok">Verificar</span>`
          : '';

    html += `<button class="stop-tab-btn ${tabClass}${idx === 0 ? ' active' : ''}" data-select-stop="${idx}">
      <span class="stop-tab-iata">${esc(stop.pais || stop.pais_codigo || stop.aeropuerto_iata || '???')}</span>
      <span class="stop-tab-label">${esc(subtituloTab(stop))}</span>
      ${badge}
    </button>`;
  });
  html += `</div>`;

  // Panel Sherpa (se carga al seleccionar pestaña)
  html += `<div class="sherpa-panel" id="sherpa-panel">
    <div class="sherpa-origin-msg">
      <div style="font-size:14px;font-weight:500;color:var(--text2);">Punto de partida</div>
      <div style="font-size:12px;margin-top:4px;">No se requieren requisitos de ingreso en el origen.</div>
    </div>
  </div>`;

  // Disclaimer de verificación (sin mención a IA/Gemini)
  html += `<div style="margin-top:16px;padding:14px 18px;border:2px solid var(--border);border-radius:10px;background:var(--surface2);text-align:center;">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:6px;">Aviso legal</div>
    <div style="font-size:13px;color:var(--text2);line-height:1.6;">
      La información se facilita únicamente como guía.<br>
      <strong>Confirmá siempre con fuentes oficiales del gobierno antes de emitir.</strong>
    </div>
  </div>`;

  container.innerHTML = html;

  // Cargar la primera pestaña correctamente (puede no ser siempre "origen")
  selectTravelStop(0);
}

window.resetImport = function() {
  importGroups = [];
  document.getElementById('import-dropzone').style.display = 'block';
  document.getElementById('import-progress-wrap').style.display = 'none';
  document.getElementById('import-review-wrap').style.display = 'none';
  document.getElementById('import-file-input').value = '';
  const excelInput = document.getElementById('import-excel-input');
  if (excelInput) excelInput.value = '';
  const btn = document.getElementById('btn-import-save');
  if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 4L6 11l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Guardar todos'; }
};


// ============================================================
//  ADMINISTRACIÓN (super-admin) — Fase 1
//  Llama a /.netlify/functions/admin-api (ver _platform-admin.cjs).
// ============================================================

let _adminTab = 'agencies';
let _adminAgencies = [];
let _adminBillingEnabled = false;
let _adminMembers = [];
let _adminUsersFilter = '';

function adminBaseUrl() {
  return (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8888/.netlify/functions/admin-api'
    : '/.netlify/functions/admin-api';
}

// Fetch autenticado contra admin-api. Lanza {status, error} si no es ok.
async function adminFetch(path, options = {}, endpoint = 'admin-api') {
  const currentUser = auth.currentUser;
  if (!currentUser) throw { status: 401, error: 'Sesión expirada. Volvé a ingresar.' };
  const idToken = await currentUser.getIdToken();
  const res = await fetch(adminBaseUrl().replace(/admin-api$/, endpoint) + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
      ...(options.headers || {})
    }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, error: json.error || 'Error desconocido.' };
  return json;
}

window.renderAdmin = function () {
  setAdminTab(_adminTab);
};

function setAdminTab(tab) {
  _adminTab = tab;
  document.querySelectorAll('.admin-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.adminTab === tab)
  );
  document.getElementById('admin-panel-agencies').style.display = tab === 'agencies' ? '' : 'none';
  document.getElementById('admin-panel-users').style.display = tab === 'users' ? '' : 'none';
  document.getElementById('admin-panel-usage').style.display = tab === 'usage' ? '' : 'none';
  document.getElementById('admin-panel-billing').style.display = tab === 'billing' ? '' : 'none';
  if (tab === 'agencies' || tab === 'billing') loadAgencies();
  else if (tab === 'users') loadUsersPanel();
  else if (tab === 'usage') initUsagePanel();
}
window.setAdminTab = setAdminTab;

// ── Agencias ──────────────────────────────────────────────
async function loadAgencies() {
  const tbody = document.getElementById('admin-agencies-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--text3);">Cargando...</td></tr>`;
  const billingBody = document.getElementById('admin-billing-agencies-tbody');
  billingBody.innerHTML = '<tr><td colspan="3">Cargando agencias...</td></tr>';
  try {
    const json = await adminFetch('/agencies');
    _adminAgencies = json.agencies || [];
    _adminBillingEnabled = json.billingEnabled === true;
    document.getElementById('admin-billing-fields').hidden = !_adminBillingEnabled;
    document.querySelector('[data-admin-tab="billing"]').hidden = !_adminBillingEnabled;
    document.getElementById('admin-billing-history').hidden = !_adminBillingEnabled;
    if (_adminBillingEnabled) {
      document.getElementById('admin-billing-agencies-tbody').innerHTML = _adminAgencies.map(a => `<tr>
        <td>${esc(a.name || a.id)}</td><td>${esc(billingStatusLabel(a.billingStatus))}</td>
        <td>${a.billingStatus.state === 'ready' ? `<button class="btn btn-ghost btn-sm" data-billing-preview="${esc(a.id)}">Facturar</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="3">Sin agencias.</td></tr>';
      if (_adminTab === 'billing') loadBillingInvoices();
    }
    renderAgenciesTable();
    populateAgencySelects();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--red);">${esc(err.error || 'Error al cargar agencias.')}</td></tr>`;
    billingBody.innerHTML = `<tr><td colspan="3">${esc(err.error || 'Error al cargar agencias.')}</td></tr>`;
  }
}

let _billingInvoices = [];
const billingRequest = (body, endpoint = 'billing-api') => adminFetch('', { method: 'POST', body: JSON.stringify(body) }, endpoint);
const billingMoney = invoice => new Intl.NumberFormat('es-AR', { style: 'currency', currency: invoice.input.currency }).format(invoice.input.items[0].amount / 100);

async function loadBillingInvoices() {
  const message = document.getElementById('admin-billing-message');
  message.textContent = 'Cargando facturas...';
  try {
    const result = await billingRequest({ action: 'list' });
    _billingInvoices = result.invoices;
    const labels = { draft: 'Borrador', issuing: 'Consultar resultado', authorized: 'Autorizada', rejected: 'Rechazada', indeterminate: 'Requiere consulta', conflict: 'Conflicto: requiere revision' };
    document.getElementById('admin-billing-tbody').innerHTML = _billingInvoices.map(invoice => `<tr>
      <td>${esc(invoice.receiver.legalName)}</td><td>${esc(invoice.period)}</td><td>${esc(billingMoney(invoice))}</td>
      <td>${esc(labels[invoice.status] || invoice.status)}${invoice.outcome?.issues?.length ? `<br><small>${esc(invoice.outcome.issues.map(issue => issue.message || issue.code).join('; '))}</small>` : ''}</td>
      <td>${invoice.status === 'authorized' ? `<button class="btn btn-ghost btn-sm" data-billing-pdf="${esc(invoice.id)}">Descargar PDF</button>` : ''}
      ${invoice.status === 'draft' || invoice.status === 'rejected' ? `<button class="btn btn-ghost btn-sm" data-billing-preview="${esc(invoice.agencyId)}">${invoice.status === 'rejected' ? 'Revisar correccion' : 'Revisar y emitir'}</button>` : ''}
      ${['issuing', 'indeterminate'].includes(invoice.status) ? `<button class="btn btn-ghost btn-sm" data-billing-recover="${esc(invoice.id)}">Consultar ARCA</button>` : ''}
      ${invoice.status === 'indeterminate' && invoice.outcome?.lookup?.kind === 'not_found' ? `<button class="btn btn-ghost btn-sm" data-billing-retry="${esc(invoice.id)}">Reintentar</button>` : ''}</td></tr>`).join('');
    message.textContent = _billingInvoices.length ? '' : 'Todavia no hay facturas de prueba.';
  } catch (err) { message.textContent = err.error || 'No se pudieron cargar las facturas.'; }
}

async function previewBilling(agencyId) {
  try {
    const invoice = await billingRequest({ action: 'preview', agencyId });
    if (invoice.status !== 'draft') { await loadBillingInvoices(); return; }
    confirmBilling(invoice, 'issue');
  } catch (err) { showToast(err.error || 'No se pudo preparar la factura.', true); }
}

function confirmBilling(invoice, action) {
  showConfirmDialog({
    title: 'Confirmar factura C de prueba',
    message: `${invoice.receiver.legalName}, CUIT ${invoice.receiver.taxId}. ${invoice.receiver.address}. Condicion: ${invoice.receiver.condition}. Servicio TravelDocs del mes ${invoice.period}. Total: ${billingMoney(invoice)} (${invoice.input.currency}).`,
    subtext: `Desde, hasta y vencimiento: ${fmtDate(invoice.input.date)}. ${invoice.quotation ? `Cotizacion ARCA: ${invoice.quotation.rate}, fecha ${invoice.quotation.date}. Pago en USD.` : ''} Sin valor fiscal.`,
    confirmLabel: action === 'retry' ? 'Confirmar reintento' : 'Emitir prueba',
    onConfirm: () => runBilling(action, invoice),
  });
}

async function runBilling(action, invoice) {
  try {
    await billingRequest({ action, invoiceId: invoice.id, digest: invoice.digest });
  } catch (err) { showToast(err.error || 'Consultar el estado antes de reintentar.', true); }
  await loadBillingInvoices();
}

async function downloadBillingPdf(id) {
  try {
    const result = await billingRequest({ invoiceId: id }, 'billing-pdf');
    const blob = new Blob([Uint8Array.from(atob(result.pdf), c => c.charCodeAt(0))], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = result.filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) { showToast(err.error || 'No se pudo descargar el PDF.', true); }
}

function billingStatusLabel(status) {
  if (status.state === 'trial') return `Prueba gratis hasta ${fmtDate(status.trialEndsOn)}`;
  if (status.state === 'incomplete') return 'Ficha fiscal incompleta';
  if (status.state === 'scheduled') return `Facturacion desde ${status.firstPeriod}`;
  if (status.state === 'ready') return 'Habilitada para facturar';
  if (status.state === 'suspended') return 'Facturacion suspendida';
  return 'Revisar fecha de alta';
}

function renderAgenciesTable() {
  const tbody = document.getElementById('admin-agencies-tbody');
  if (!tbody) return;
  if (!_adminAgencies.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--text3);">Sin agencias.</td></tr>`;
    return;
  }
  tbody.innerHTML = _adminAgencies.map(a => `
    <tr>
      <td style="font-weight:500;">${esc(a.name || a.id)}</td>
      <td style="font-family:var(--mono);font-size:12px;">${esc(a.slug || a.id)}</td>
      <td>${planBadge(a.plan)}</td>
      <td>${statusBadgeAdmin(a.status)}${a.billingStatus ? `<br><small>${esc(billingStatusLabel(a.billingStatus))}</small>` : ''}</td>
      <td>${a.memberCount ?? 0}</td>
      <td style="font-size:12px;white-space:nowrap;">${fmtDate(a.createdAt)}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-ghost btn-sm" data-agency-edit="${esc(a.id)}">Editar</button>
        ${a.status === 'suspended'
          ? `<button class="btn btn-ghost btn-sm" data-agency-activate="${esc(a.id)}">Reactivar</button>`
          : `<button class="btn btn-ghost btn-sm" data-agency-suspend="${esc(a.id)}">Suspender</button>`}
        <button class="btn btn-ghost btn-sm" data-agency-delete="${esc(a.id)}" style="color:var(--red);">Eliminar</button>
      </td>
    </tr>`).join('');
}

function populateAgencySelects() {
  const active = _adminAgencies.filter(a => a.status !== 'suspended');
  const opts = (list, all) =>
    (all ? `<option value="">Todas</option>` : '') +
    list.map(a => `<option value="${esc(a.id)}">${esc(a.name || a.id)}</option>`).join('');

  const usAgency = document.getElementById('admin-us-agency');
  const filter = document.getElementById('admin-us-filter-agency');
  if (usAgency) {
    const prev = usAgency.value;
    usAgency.innerHTML = opts(active, false);
    if (prev) usAgency.value = prev;
  }
  if (filter) {
    const prev = _adminUsersFilter;
    filter.innerHTML = opts(_adminAgencies, true);
    const valid = [...filter.options].some(o => o.value === prev);
    filter.value = valid ? prev : '';
    _adminUsersFilter = filter.value;
  }
}

function openEditAgency(agencyId) {
  const a = _adminAgencies.find(x => x.id === agencyId);
  if (!a) return;
  // Necesitamos los campos completos (branding/alerts) que no vienen en el listado.
  // Los pedimos al backend solo si faltan; si no hay, abrimos igual con lo que hay.
  fillAgencyForm({
    id: a.id,
    name: a.name || '',
    slug: a.slug || a.id,
    plan: a.plan,
    status: a.status,
    branding: a.branding || {},
    alerts: a.alerts || {},
    billing: a.billing || {}
  });
}

// Estado del logo de la agencia en edición: '' = sin logo, data URL o path = logo cargado.
let adminLogoDataUrl = '';

// Muestra/oculta la vista previa del logo y el botón "Quitar logo" según haya o no valor.
function setAgencyLogoPreview(value) {
  const img = document.getElementById('admin-ag-logo-preview');
  const removeBtn = document.getElementById('admin-ag-logo-remove');
  if (!img || !removeBtn) return;
  if (value) {
    img.src = value;
    img.style.display = '';
    removeBtn.style.display = '';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    removeBtn.style.display = 'none';
  }
}

// Handler del input file: procesa la imagen elegida a data URL y actualiza preview/estado.
async function handleAgencyLogoChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const { prepareLogoDataUrl } = await loadScanner();
    const dataUrl = await prepareLogoDataUrl(file);
    adminLogoDataUrl = dataUrl;
    setAgencyLogoPreview(dataUrl);
  } catch (err) {
    showToast(err.message || 'No se pudo procesar el logo.', true);
  }
}

function fillAgencyForm(a) {
  document.getElementById('admin-billing-fields').open = false;
  for (const key of ['taxId', 'legalName', 'address', 'condition', 'currency']) {
    document.getElementById('admin-bill-' + key).value = a.billing?.[key] || '';
  }
  document.getElementById('admin-bill-amount').value = a.billing?.amount ? (a.billing.amount / 100).toFixed(2) : '';
  document.getElementById('admin-agency-edit-id').value = a.id || '';
  document.getElementById('admin-ag-name').value = a.name || '';
  document.getElementById('admin-ag-slug').value = a.slug || '';
  document.getElementById('admin-ag-slug').disabled = !!a.id;
  document.getElementById('admin-ag-plan').value = a.plan || 'trial';
  document.getElementById('admin-ag-status').value = a.status || 'active';
  document.getElementById('admin-ag-alerts-email').value = a.alerts?.email || '';
  document.getElementById('admin-ag-app-name').value = a.branding?.appName || '';
  document.getElementById('admin-ag-color').value = a.branding?.primaryColor || '#1a3a5c';
  // Logo: se gestiona como data URL (upload) o path existente. Mostramos preview y reseteamos el input.
  adminLogoDataUrl = a.branding?.logoUrl || '';
  setAgencyLogoPreview(adminLogoDataUrl);
  const logoFileInput = document.getElementById('admin-ag-logo-file');
  if (logoFileInput) logoFileInput.value = '';
  const emailjs = emailjsParaAlta(a.alerts);
  document.getElementById('admin-ag-emailjs-pk').value = emailjs.emailjsPublicKey;
  document.getElementById('admin-ag-emailjs-svc').value = emailjs.emailjsServiceId;
  document.getElementById('admin-ag-emailjs-tpl').value = emailjs.emailjsTemplateId;
  document.getElementById('admin-agency-form-title').textContent = a.id ? 'Editar agencia' : 'Nueva agencia';
  document.getElementById('admin-ag-save').textContent = a.id ? 'Guardar cambios' : 'Crear agencia';
  document.getElementById('admin-ag-cancel').style.display = a.id ? '' : 'none';
}

function clearAgencyForm() {
  fillAgencyForm({});
}

async function submitAgencyForm() {
  const editId = document.getElementById('admin-agency-edit-id').value;
  const payload = {
    name: document.getElementById('admin-ag-name').value.trim(),
    slug: document.getElementById('admin-ag-slug').value.trim().toLowerCase(),
    plan: document.getElementById('admin-ag-plan').value,
    status: document.getElementById('admin-ag-status').value,
    branding: {
      appName: document.getElementById('admin-ag-app-name').value.trim(),
      logoUrl: adminLogoDataUrl,
      primaryColor: document.getElementById('admin-ag-color').value
    },
    alerts: {
      email: document.getElementById('admin-ag-alerts-email').value.trim(),
      emailjsPublicKey: document.getElementById('admin-ag-emailjs-pk').value.trim(),
      emailjsServiceId: document.getElementById('admin-ag-emailjs-svc').value.trim(),
      emailjsTemplateId: document.getElementById('admin-ag-emailjs-tpl').value.trim()
    }
  };

  if (_adminBillingEnabled) {
    payload.billing = {};
    for (const key of ['taxId', 'legalName', 'address', 'condition', 'currency']) payload.billing[key] = document.getElementById('admin-bill-' + key).value.trim();
    try {
      const amount = document.getElementById('admin-bill-amount').value.trim();
      payload.billing.amount = amount ? parsePrice(amount) : null;
    } catch (err) { return showToast(err.message, true); }
  }

  if (!payload.name) return showToast('Falta el nombre comercial.', true);
  if (!editId) {
    if (!payload.slug) return showToast('Falta el slug.', true);
    if (!/^[a-z0-9-]{3,40}$/.test(payload.slug)) {
      return showToast('Slug inválido: 3-40 chars, solo a-z, 0-9 y guiones.', true);
    }
  }
  if (payload.alerts.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.alerts.email)) {
    return showToast('El email de alertas no es válido.', true);
  }

  const btn = document.getElementById('admin-ag-save');
  const label = editId ? 'Guardar cambios' : 'Crear agencia';
  btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>Guardando...';
  try {
    if (editId) {
      delete payload.slug; // el slug no se edita
      await adminFetch('/agencies/' + encodeURIComponent(editId), { method: 'PATCH', body: JSON.stringify(payload) });
      showToast('Cambios guardados.');
    } else {
      await adminFetch('/agencies', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Agencia creada.');
    }
    clearAgencyForm();
    await loadAgencies();
  } catch (err) {
    showToast(err.error || 'Error al guardar.', true);
  } finally {
    btn.disabled = false;
    // label según estado actual del form (clearAgencyForm pudo haberlo reseteado a "Crear agencia")
    const currentEdit = document.getElementById('admin-agency-edit-id').value;
    btn.textContent = currentEdit ? 'Guardar cambios' : 'Crear agencia';
  }
}

async function toggleAgencyStatus(agencyId, suspend) {
  const label = suspend ? 'suspender' : 'reactivar';
  showConfirmDialog({
    title: suspend ? '¿Suspender agencia?' : '¿Reactivar agencia?',
    message: `Se va a ${label} la agencia. ${suspend ? 'Sus usuarios no podrán iniciar sesión (las sesiones activas se cierran al refrescar token).' : ''}`,
    confirmLabel: suspend ? 'Suspender' : 'Reactivar',
    onConfirm: async () => {
      try {
        await adminFetch('/agencies/' + encodeURIComponent(agencyId), {
          method: 'PATCH',
          body: JSON.stringify({ status: suspend ? 'suspended' : 'active' })
        });
        showToast(suspend ? 'Agencia suspendida.' : 'Agencia reactivada.');
        await loadAgencies();
      } catch (err) {
        showToast(err.error || 'Error.', true);
      }
    }
  });
}

// ── Usuarios ──────────────────────────────────────────────
function loadUsersPanel() {
  populateAgencySelects();
  loadMembers(_adminUsersFilter);
}

async function loadMembers(agencyId) {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--text3);">Cargando...</td></tr>`;
  try {
    const json = agencyId
      ? await adminFetch('/agencies/' + encodeURIComponent(agencyId) + '/members')
      : await adminFetch('/users');
    _adminMembers = json.members || [];
    renderUsersTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--red);">${esc(err.error || 'Error al cargar usuarios.')}</td></tr>`;
  }
}

function renderUsersTable() {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  if (!_adminMembers.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--text3);">${_adminUsersFilter ? 'Sin usuarios en esta agencia.' : 'Sin usuarios.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = _adminMembers.map(m => `
    <tr>
      <td style="font-family:var(--mono);font-size:12px;">${esc(m.email)}</td>
      <td>${esc(m.displayName || '—')}</td>
      <td>${esc(m.agencyName || m.agencyId || '—')}</td>
      <td>
        <select class="admin-role-select" data-user-role="${esc(m.uid)}" style="font-size:12px;">
          ${['owner','admin','agent'].map(r => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </td>
      <td>${m.active ? '<span style="color:var(--green);font-weight:500;">Activo</span>' : '<span style="color:var(--red);font-weight:500;">Inactivo</span>'}</td>
      <td style="font-size:12px;white-space:nowrap;">${fmtDate(m.createdAt)}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-ghost btn-sm" data-user-edit="${esc(m.uid)}">Editar</button>
        ${m.active
          ? `<button class="btn btn-ghost btn-sm" data-user-deactivate="${esc(m.uid)}">Desactivar</button>`
          : `<button class="btn btn-ghost btn-sm" data-user-activate="${esc(m.uid)}">Reactivar</button>`}
        <button class="btn btn-ghost btn-sm" data-user-mfa-reset="${escStr(m.uid)}">Resetear 2FA</button>
        <button class="btn btn-ghost btn-sm" data-user-delete="${esc(m.uid)}" style="color:var(--red);">Eliminar</button>
      </td>
    </tr>`).join('');
}

function forceResetUserMfa(uid) {
  showConfirmDialog({
    title: 'Resetear autenticador',
    message: 'Se cerraran las sesiones del usuario y se invalidara su codigo de recuperacion. Debera ingresar con su contrasena y configurar un nuevo autenticador.',
    confirmLabel: 'Resetear 2FA',
    onConfirm: async () => {
      try {
        const idToken = await _mfaIdToken();
        const res = await fetch(_mfaFnUrl('mfa-admin'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ action: 'force-reset', targetUid: uid }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'No se pudo resetear el 2FA.');
        if (uid === auth.currentUser?.uid) {
          await signOut(auth);
          window.location.href = './login.html?reason=need2fa';
          return;
        }
        showToast('2FA reseteado. El usuario debe configurar un nuevo autenticador.');
      } catch (err) {
        showToast(err.message || 'No se pudo resetear el 2FA.', true);
      }
    },
  });
}

async function submitUserForm() {
  const payload = {
    email: document.getElementById('admin-us-email').value.trim().toLowerCase(),
    password: document.getElementById('admin-us-password').value,
    agencyId: document.getElementById('admin-us-agency').value,
    role: document.getElementById('admin-us-role').value,
    displayName: document.getElementById('admin-us-name').value.trim()
  };
  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return showToast('Email inválido.', true);
  if (!payload.agencyId) return showToast('Elegí una agencia.', true);
  if (payload.password && payload.password.length < 8) return showToast('La contraseña debe tener al menos 8 caracteres.', true);

  const btn = document.getElementById('admin-us-save');
  btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>Procesando...';
  try {
    const json = await adminFetch('/users', { method: 'POST', body: JSON.stringify(payload) });
    showToast(json.created ? 'Usuario creado.' : 'Usuario vinculado.');
    document.getElementById('admin-us-email').value = '';
    const passInput = document.getElementById('admin-us-password');
    passInput.value = '';
    passInput.type = 'password';
    const copyBtn = document.getElementById('admin-us-password-copy');
    if (copyBtn) copyBtn.hidden = true;
    document.getElementById('admin-us-name').value = '';
    await loadMembers(payload.agencyId);
  } catch (err) {
    showToast(err.error || 'Error al crear el usuario.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear / vincular usuario';
  }
}

async function setUserRole(uid, role) {
  try {
    await adminFetch('/users/' + encodeURIComponent(uid), { method: 'PATCH', body: JSON.stringify({ role }) });
    showToast('Rol actualizado.');
  } catch (err) {
    showToast(err.error || 'Error.', true);
    loadMembers(_adminUsersFilter);
  }
}

function toggleUserActive(uid, active) {
  // Reactivar es directo; desactivar pide confirmación (revoca la sesión activa).
  const run = async () => {
    try {
      await adminFetch('/users/' + encodeURIComponent(uid), { method: 'PATCH', body: JSON.stringify({ active }) });
      showToast(active ? 'Usuario reactivado.' : 'Usuario desactivado.');
      await loadMembers(_adminUsersFilter);
    } catch (err) {
      showToast(err.error || 'Error.', true);
    }
  };
  if (active) { run(); return; }
  showConfirmDialog({
    title: '¿Desactivar usuario?',
    message: 'El usuario no podrá iniciar sesión y se le revocará la sesión activa.',
    confirmLabel: 'Desactivar',
    onConfirm: run
  });
}

// ── Editar usuario (email / password / nombre / rol) ──────
function openEditUserModal(uid) {
  const m = _adminMembers.find(x => x.uid === uid);
  if (!m) return;
  document.getElementById('admin-edit-user-uid').value = m.uid;
  document.getElementById('admin-edit-user-email').value = m.email || '';
  document.getElementById('admin-edit-user-name').value = m.displayName || '';
  document.getElementById('admin-edit-user-role').value = m.role || 'agent';
  document.getElementById('admin-edit-user-password').value = '';
  openModal('modal-edit-user');
}

async function submitEditUser() {
  const uid = document.getElementById('admin-edit-user-uid').value;
  if (!uid) return;
  const payload = {
    email: document.getElementById('admin-edit-user-email').value.trim().toLowerCase(),
    displayName: document.getElementById('admin-edit-user-name').value.trim(),
    role: document.getElementById('admin-edit-user-role').value
  };
  const password = document.getElementById('admin-edit-user-password').value;
  if (password) payload.password = password;

  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return showToast('Email inválido.', true);
  }
  if (password && password.length < 8) {
    return showToast('La contraseña debe tener al menos 8 caracteres.', true);
  }

  const btn = document.getElementById('admin-edit-user-save');
  btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>Guardando...';
  try {
    await adminFetch('/users/' + encodeURIComponent(uid), { method: 'PATCH', body: JSON.stringify(payload) });
    showToast('Cambios guardados.');
    closeModal('modal-edit-user');
    await loadMembers(_adminUsersFilter);
  } catch (err) {
    showToast(err.error || 'Error al guardar.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  }
}

// ── Eliminar usuario (borrado definitivo) ─────────────────
function deleteUser(uid) {
  const m = _adminMembers.find(x => x.uid === uid);
  showConfirmDialog({
    title: '¿Eliminar usuario?',
    message: `Se va a eliminar definitivamente a ${m?.email || uid}. Se borra su cuenta de Auth, sus datos y deja de pertenecer a la agencia.`,
    subtext: 'Esta acción no se puede deshacer.',
    confirmLabel: 'Sí, eliminar',
    onConfirm: async () => {
      try {
        await adminFetch('/users/' + encodeURIComponent(uid), {
          method: 'DELETE',
          body: JSON.stringify({ confirm: true })
        });
        showToast('Usuario eliminado.');
        await loadMembers(_adminUsersFilter);
      } catch (err) {
        showToast(err.error || 'Error al eliminar.', true);
      }
    }
  });
}

// ── Eliminar agencia (confirmación con slug) ──────────────
function openDeleteAgencyModal(agencyId) {
  document.getElementById('admin-agency-delete-target').value = agencyId;
  const input = document.getElementById('admin-agency-delete-input');
  input.value = '';
  const btn = document.getElementById('admin-agency-delete-confirm');
  btn.disabled = true;
  btn.textContent = 'Eliminar agencia';
  openModal('modal-agency-delete');
  setTimeout(() => input.focus(), 50);
}

async function confirmDeleteAgency() {
  const agencyId = document.getElementById('admin-agency-delete-target').value;
  const confirmSlug = document.getElementById('admin-agency-delete-input').value.trim();
  if (confirmSlug !== agencyId) return;

  const btn = document.getElementById('admin-agency-delete-confirm');
  btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>Eliminando...';
  try {
    await adminFetch('/agencies/' + encodeURIComponent(agencyId), {
      method: 'DELETE',
      body: JSON.stringify({ confirmSlug })
    });
    showToast('Agencia eliminada.');
    closeModal('modal-agency-delete');
    clearAgencyForm();
    await loadAgencies();
  } catch (err) {
    showToast(err.error || 'Error al eliminar.', true);
    btn.disabled = false;
    btn.textContent = 'Eliminar agencia';
  }
}

// ── Badges ────────────────────────────────────────────────
function planBadge(plan) {
  const colors = { trial: 'var(--text3)', starter: '#2563eb', pro: 'var(--green)' };
  return `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:${colors[plan] || 'var(--text3)'}1a;color:${colors[plan] || 'var(--text3)'};">${esc(plan || 'trial')}</span>`;
}
function statusBadgeAdmin(status) {
  const ok = status !== 'suspended';
  return `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:${ok ? 'var(--green)' : 'var(--red)'}1a;color:${ok ? 'var(--green)' : 'var(--red)'};">${ok ? 'active' : 'suspended'}</span>`;
}

// ── Uso y gasto (reporte para cobro manual) ───────────────
// Lee agencies/{id}/usage/{YYYY-MM-DD} vía GET /usage de admin-api.
let _usageInited = false;

function usageDefaultMonth(now = new Date()) {
  // Mes actual en hora de Argentina (consistente con usageDayId de _usage.cjs).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit',
  }).formatToParts(now);
  const y = (parts.find(p => p.type === 'year') || {}).value;
  const m = (parts.find(p => p.type === 'month') || {}).value;
  return `${y}-${m}`;
}

function initUsagePanel() {
  if (!_usageInited) {
    const monthInput = document.getElementById('admin-usage-month');
    const rangeInput = document.getElementById('admin-usage-range');
    if (monthInput) {
      monthInput.value = usageDefaultMonth();
      monthInput.disabled = rangeInput?.value === 'historical';
    }
    document.getElementById('admin-usage-refresh')?.addEventListener('click', loadUsage);
    rangeInput?.addEventListener('change', () => {
      // Histórico no usa mes.
      if (monthInput) monthInput.disabled = rangeInput.value === 'historical';
      loadUsage();
    });
    monthInput?.addEventListener('change', loadUsage);
    _usageInited = true;
  }
  loadUsage();
}

async function loadUsage() {
  const tbody = document.getElementById('admin-usage-tbody');
  const totalsRow = document.getElementById('admin-usage-totals');
  const status = document.getElementById('admin-usage-status');
  const thKey = document.getElementById('admin-usage-th-key');
  if (!tbody) return;

  const range = document.getElementById('admin-usage-range').value || 'monthly';
  const hist = range === 'historical';
  const month = document.getElementById('admin-usage-month').value || usageDefaultMonth();
  thKey.textContent = (range === 'monthly' || range === 'historical') ? 'Agencia'
    : (range === 'daily' ? 'Día' : 'Semana');

  tbody.innerHTML = `<tr><td colspan="6" style="padding:16px;color:var(--text3);">Cargando...</td></tr>`;
  if (totalsRow) totalsRow.innerHTML = '';
  if (status) { status.style.display = 'none'; status.textContent = ''; }

  try {
    const qs = `?range=${encodeURIComponent(range)}${hist ? '' : `&month=${encodeURIComponent(month)}`}`;
    const json = await adminFetch(`/usage${qs}`);
    renderUsageTable(json, range);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:16px;color:var(--red);">${esc(err.error || 'Error al cargar el uso.')}</td></tr>`;
  }
}

function fmtUsd(v) {
  return Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function renderUsageTable(json, range) {
  const tbody = document.getElementById('admin-usage-tbody');
  const totalsRow = document.getElementById('admin-usage-totals');
  const rows = (json && json.rows) || [];
  const totals = (json && json.totals) || null;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:16px;color:var(--text3);">Sin uso registrado en este período.</td></tr>`;
    if (totalsRow) totalsRow.innerHTML = '';
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${esc(r.label || r.key)}</td>
      <td>${r.scans}</td>
      <td>${r.travel}</td>
      <td><strong>${r.total}</strong></td>
      <td>${r.claudePct}%</td>
      <td>${fmtUsd(r.estimatedCostUsd)}</td>
    </tr>
  `).join('');

  if (totalsRow && totals) {
    totalsRow.innerHTML = `
      <td>Totales</td>
      <td>${totals.scans}</td>
      <td>${totals.travel}</td>
      <td>${totals.total}</td>
      <td>${totals.claudePct}%</td>
      <td>${fmtUsd(totals.estimatedCostUsd)}</td>
    `;
  }
}

// ── Wire de eventos ───────────────────────────────────────
document.querySelectorAll('#admin-tabs .admin-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => setAdminTab(btn.dataset.adminTab));
});
document.getElementById('admin-ag-save')?.addEventListener('click', () => submitAgencyForm());
document.getElementById('admin-ag-cancel')?.addEventListener('click', () => clearAgencyForm());
document.getElementById('admin-ag-logo-file')?.addEventListener('change', handleAgencyLogoChange);
document.getElementById('admin-ag-logo-remove')?.addEventListener('click', () => {
  adminLogoDataUrl = '';
  setAgencyLogoPreview('');
  const logoFileInput = document.getElementById('admin-ag-logo-file');
  if (logoFileInput) logoFileInput.value = '';
});
document.getElementById('admin-us-save')?.addEventListener('click', () => submitUserForm());
document.getElementById('admin-us-password-gen')?.addEventListener('click', () => {
  const input = document.getElementById('admin-us-password');
  if (!input) return;
  input.type = 'text';
  input.value = generarContrasena();
  input.focus();
  input.select();
  const copy = document.getElementById('admin-us-password-copy');
  if (copy) copy.hidden = false;
});
document.getElementById('admin-us-password-copy')?.addEventListener('click', async () => {
  const input = document.getElementById('admin-us-password');
  const value = input?.value || '';
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast('Contraseña copiada.');
  } catch {
    input.focus();
    input.select();
    showToast('Seleccionada. Copiala con Cmd+C.', true);
  }
});
document.getElementById('admin-us-filter-agency')?.addEventListener('change', e => {
  _adminUsersFilter = e.target.value;
  loadMembers(_adminUsersFilter);
});
// Auto-slug desde el nombre solo en alta
document.getElementById('admin-ag-name')?.addEventListener('input', e => {
  const slugInput = document.getElementById('admin-ag-slug');
  if (slugInput && !slugInput.disabled && !slugInput.dataset.touched) {
    slugInput.value = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }
});
document.getElementById('admin-ag-slug')?.addEventListener('input', e => {
  e.target.dataset.touched = '1';
});

// Wiring modal editar usuario
document.getElementById('admin-edit-user-save')?.addEventListener('click', () => submitEditUser());
document.getElementById('admin-edit-user-cancel')?.addEventListener('click', () => closeModal('modal-edit-user'));
document.getElementById('modal-edit-user-close-btn')?.addEventListener('click', () => closeModal('modal-edit-user'));

// Wiring modal eliminar agencia
document.getElementById('admin-agency-delete-cancel')?.addEventListener('click', () => closeModal('modal-agency-delete'));
document.getElementById('modal-agency-delete-close-btn')?.addEventListener('click', () => closeModal('modal-agency-delete'));
document.getElementById('admin-agency-delete-confirm')?.addEventListener('click', () => confirmDeleteAgency());
document.getElementById('admin-agency-delete-input')?.addEventListener('input', e => {
  const target = document.getElementById('admin-agency-delete-target').value;
  document.getElementById('admin-agency-delete-confirm').disabled = e.target.value.trim() !== target;
});

document.getElementById('admin-billing-refresh')?.addEventListener('click', loadBillingInvoices);
// Delegación para acciones en tablas
document.addEventListener('click', e => {
  const preview = e.target.closest('[data-billing-preview]');
  if (preview) { previewBilling(preview.dataset.billingPreview); return; }
  const pdf = e.target.closest('[data-billing-pdf]');
  if (pdf) { downloadBillingPdf(pdf.dataset.billingPdf); return; }
  const recover = e.target.closest('[data-billing-recover]');
  if (recover) { const invoice = _billingInvoices.find(i => i.id === recover.dataset.billingRecover); if (invoice) runBilling('recover', invoice); return; }
  const retry = e.target.closest('[data-billing-retry]');
  if (retry) { const invoice = _billingInvoices.find(i => i.id === retry.dataset.billingRetry); if (invoice) confirmBilling(invoice, 'retry'); return; }
  const edit = e.target.closest('[data-agency-edit]');
  if (edit) { openEditAgency(edit.dataset.agencyEdit); return; }
  const suspend = e.target.closest('[data-agency-suspend]');
  if (suspend) { toggleAgencyStatus(suspend.dataset.agencySuspend, true); return; }
  const activate = e.target.closest('[data-agency-activate]');
  if (activate) { toggleAgencyStatus(activate.dataset.agencyActivate, false); return; }
  const agDel = e.target.closest('[data-agency-delete]');
  if (agDel) { openDeleteAgencyModal(agDel.dataset.agencyDelete); return; }
  const deact = e.target.closest('[data-user-deactivate]');
  if (deact) { toggleUserActive(deact.dataset.userDeactivate, false); return; }
  const react = e.target.closest('[data-user-activate]');
  if (react) { toggleUserActive(react.dataset.userActivate, true); return; }
  const usEdit = e.target.closest('[data-user-edit]');
  if (usEdit) { openEditUserModal(usEdit.dataset.userEdit); return; }
  const mfaReset = e.target.closest('[data-user-mfa-reset]');
  if (mfaReset) { forceResetUserMfa(mfaReset.dataset.userMfaReset); return; }
  const usDel = e.target.closest('[data-user-delete]');
  if (usDel) { deleteUser(usDel.dataset.userDelete); return; }
});
document.addEventListener('change', e => {
  const roleSel = e.target.closest('.admin-role-select');
  if (roleSel) setUserRole(roleSel.dataset.userRole, roleSel.value);
});
