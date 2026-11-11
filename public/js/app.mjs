import { initSeguridad } from './compartido/seguridad.mjs';
import { estado } from './compartido/estado.mjs';
import { estadoAlertas, renderAlerts, updateAlertBadge, initAlertas } from './alertas/pantalla.mjs';
import { onAuthStateChanged, signOut, multiFactor } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { REQUIRE_2FA } from './config.js';
import { initDB, setTenantContext, getUserAgency, getAgency, listenPassengers, isNotified, markNotified, listenReservations, deleteReservations } from './db.js';
import { storeAgencyId, clearStoredAgencyId, applyBranding, parseAgencyAlerts } from './tenant.js';
import { reservationStale } from './alertas/alert-core.mjs';
import { DIRECT_MESSAGES, findDirectMessage } from './direct-messages.mjs';
import { opcionesPais } from './compartido/paises.mjs';
import { venceSesion } from './sesion.mjs';
import { loadScanner, loadTravelReqs } from './compartido/cargas.mjs';
import { app, auth } from './compartido/firebase.mjs';
import { checkAndSendUnifiedAlerts } from './alertas/envios.mjs';
import { esc, showToast, initUi } from './compartido/ui.mjs';
import { renderDashboard } from './dashboard/pantalla.mjs';
import { renderDocuments, initDocumentos } from './documentos/pantalla.mjs';
import { loadXlsx, initImportacion } from './importacion/pantalla.mjs';
import { resPiernas, updateReservationsBadge, initReservas } from './reservas/pantalla.mjs';
import { loadGdsCities, initCiudades } from './ciudades/pantalla.mjs';
import { initPasajeros } from './pasajeros/pantalla.mjs';
import { initScanner } from './documentos/scanner-ui.mjs';
import { initRequisitos } from './requisitos/pantalla.mjs';
import { initAdministracion } from './administracion/pantalla.mjs';
import { initFacturacion } from './facturacion/pantalla.mjs';

initPasajeros();
initDocumentos();
initAlertas();
initScanner();
initUi();
initImportacion();
initReservas();
initCiudades();
initSeguridad();
initRequisitos();
initAdministracion();
initFacturacion();


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
initDB(app);

// Sesion de 5h desde el ultimo login (regla en sesion.mjs). Vence aunque la
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

// Lectura por agente y tarjeta, persistida con las notificaciones de la agencia.
async function initPlatformUpdates(uid) {
  const section = document.getElementById('platform-updates');
  const summary = section.querySelector('summary');
  const link = document.getElementById('platform-updates-link');
  const revision = section.dataset.updatesRevision;
  let unread = [...section.querySelectorAll('[data-update-id]')].map(card => `platform-update_${revision}_${uid}_${card.dataset.updateId}`);
  section.open = false;
  const track = document.getElementById('platform-updates-track');
  const previous = document.getElementById('platform-updates-previous');
  const next = document.getElementById('platform-updates-next');
  const updateArrows = () => {
    previous.disabled = track.scrollLeft <= 1;
    next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
  };
  const step = () => track.firstElementChild.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap);
  previous.onclick = () => track.scrollBy({ left: -step() });
  next.onclick = () => track.scrollBy({ left: step() });
  track.addEventListener('scroll', updateArrows);
  track.querySelectorAll('.platform-update details').forEach(details => {
    details.addEventListener('toggle', () => {
      if (details.open) details.scrollIntoView({ block: 'start', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  });
  new ResizeObserver(updateArrows).observe(track);
  section.addEventListener('toggle', () => {
    if (section.open) {
      track.scrollLeft = 0;
      updateArrows();
    }
  });
  try {
    const read = await Promise.all(unread.map(key => isNotified(key)));
    unread = unread.filter((_, i) => !read[i]);
  } catch (err) {
    console.warn('[Novedades] No se pudo consultar la lectura:', err?.message || err);
  }
  link.hidden = unread.length === 0;
  let saving = false;
  const markRead = async () => {
    if (saving || !unread.length) return;
    saving = true;
    try {
      await Promise.all(unread.map(key => markNotified(key)));
      unread = [];
      link.hidden = true;
    } catch (err) {
      console.warn('[Novedades] No se pudo guardar la lectura:', err?.message || err);
      showToast('No se pudo marcar como leido. Volve a abrir las novedades para reintentar.', true);
    } finally {
      saving = false;
    }
  };
  summary.onclick = () => { if (!section.open) markRead(); };
  link.onclick = event => {
    event.preventDefault();
    window.showView('dashboard');
    section.open = true;
    summary.focus({ preventScroll: true });
    section.scrollIntoView({ block: 'start' });
    markRead();
  };
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

  // Sesion de 5h: el token forzado trae iat del server (ver sesion.mjs).
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
  estado.alertConfig = parseAgencyAlerts(agency);
  estado.appName = agency.branding?.appName || 'TravelDocs';
  estado.agencyName = (agency.name || '').trim();
  applyBranding(agency.branding);
  await initPlatformUpdates(user.uid);

  // Visibilidad de Administración según claim platformAdmin del JWT.
  try {
    const tokenResult = await user.getIdTokenResult();
    estado.currentUserRole = tokenResult.claims?.role || null;
    estado.isPlatformAdmin = tokenResult.claims?.platformAdmin === true;
    if (estado.isPlatformAdmin) {
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
    estado.passengers = data;
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
    estado._paxLoaded = true;
    checkAndSendUnifiedAlerts();
  });
  listenReservations(data => {
    estado.reservations = data;
    // Limpieza automática: los check-ins cuyo último tramo voló ayer o antes
    // se borran solos (regla en reservationStale, testeada en alerts.test.mjs).
    const stale = data.filter(r => reservationStale(resPiernas(r))).map(r => r.id);
    if (stale.length) {
      deleteReservations(stale).catch(err => console.warn('[Check-ins] Limpieza automática falló:', err?.message || err));
    }
    refreshCurrentView();
    updateReservationsBadge();
    updateAlertBadge();
    estado._resLoaded = true;
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
  if (v !== 'dashboard') document.getElementById('platform-updates').open = false;
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
    estadoAlertas._alertsCritOpen = false;
    estadoAlertas._alertsWarnOpen = false;
    estadoAlertas._alertsReqOpen = false;
    estadoAlertas._alertsSixOpen = false;
    estadoAlertas._alertsBdOpen = false;
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

document.getElementById('modal-confirm-close-btn')?.addEventListener('click', () => window.closeModal('modal-confirm'));
document.getElementById('modal-confirm-cancel-btn')?.addEventListener('click', () => window.closeModal('modal-confirm'));
document.getElementById('direct-message-close-btn')?.addEventListener('click', () => window.closeModal('modal-direct-message'));
document.getElementById('direct-message-ok-btn')?.addEventListener('click', () => window.closeModal('modal-direct-message'));
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
