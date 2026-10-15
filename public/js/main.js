import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG } from './config.js';
import { initDB, listenPassengers, addPassenger, updatePassenger, deletePassenger, isNotified, markNotified } from './db.js';
import { docStatus, statusBadge, passengerOverallStatus, fmtDate, daysUntil, initials, escStr } from './utils.js';
import { renderSSROutput, buildSSRStrings } from './ssr.js';
import { scanDocument, mapScanToForm } from './scanner.js';

// ==================== FIREBASE INIT ====================
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
initDB(app);

window.addEventListener('unhandledrejection', event => {
  console.error('Promesa rechazada sin catch:', event.reason);
});
window.addEventListener('error', event => {
  console.error('Error no capturado:', event.error || event.message);
});

let passengers = [];
let currentEditId = null;
let ssrSelectedPassenger = null;
let currentDocFilter = 'all';

// ==================== SEGURIDAD ====================
// ==================== ALERTAS POR EMAIL (EmailJS) ====================
// Pasos para activar:
// 1. Crear cuenta gratuita en https://emailjs.com (200 emails/mes gratis)
// 2. Email Services → Add New Service → Gmail → copiar el Service ID
// 3. Email Templates → Create Template, con estas variables:
//      Subject: {{subject}}
//      Body:    {{message}}
//    → copiar el Template ID
// 4. Account → API Keys → copiar la Public Key
const EMAILJS_PUBLIC_KEY  = '9hDeLGPwhgAkqc7HZ';
const EMAILJS_SERVICE_ID  = 'service_g7h8qrd';
const EMAILJS_TEMPLATE_ID = 'template_jwdgrsr';
const AGENCY_EMAIL        = 'contacto@tradingtravel.com.ar';

let _alertsCheckedThisSession = false;

async function checkAndSendAlerts() {
  if (!EMAILJS_PUBLIC_KEY || !EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID) {
    console.warn('[Alertas] Faltan variables EmailJS, se omite el chequeo.');
    return;
  }
  if (_alertsCheckedThisSession) {
    console.log('[Alertas] Ya se chequeó en esta sesión, se omite.');
    return;
  }
  _alertsCheckedThisSession = true;
  console.log('[Alertas] Iniciando chequeo de alertas...');

  // Detectar documentos nuevos que llegan al umbral de 6 meses y aún no fueron notificados.
  // Clave única: passengerId + docType + expDate → así cada vencimiento se notifica UNA sola vez.
  // Si renuevan el documento (nueva expDate), la clave cambia y se vuelve a notificar.
  const candidates = [];
  passengers.forEach(p => {
    const check = (docType, docNum, exp) => {
      const days = daysUntil(exp);
      if (days === null || days < 0 || days > 180) return;
      const key = `tdAlert_${p.id}_${docType}_${exp}`;
      candidates.push({ key, name: `${p.lastname}, ${p.firstname}`, docType, docNum: docNum || '—', exp, days });
    };
    if (p.dni?.exp)  check('DNI',          p.dni.num,  p.dni.exp);
    if (p.parg?.exp) check('Pasaporte ARG', p.parg.num, p.parg.exp);
    if (p.pext?.exp && p.pext?.country) check(`Pas. ${p.pext.country}`, p.pext.num, p.pext.exp);
    if (p.visa1?.country && p.visa1?.exp) check(`Visa ${p.visa1.country}`, p.visa1.num, p.visa1.exp);
    if (p.visa2?.country && p.visa2?.exp) check(`Visa ${p.visa2.country}`, p.visa2.num, p.visa2.exp);
  });

  console.log(`[Alertas] Documentos dentro de 6 meses: ${candidates.length}`);
  const already = await Promise.all(candidates.map(e => isNotified(e.key)));
  const toNotify = candidates.filter((_, i) => !already[i]);
  console.log(`[Alertas] Documentos pendientes de email: ${toNotify.length} (ya notificados: ${candidates.length - toNotify.length})`);

  if (toNotify.length) {
    toNotify.sort((a, b) => a.days - b.days);
    const lines = toNotify.map(e =>
      `• ${e.name}  |  ${e.docType} ${e.docNum}  |  Vence: ${fmtDate(e.exp)} (${e.days} días)`
    ).join('\n');

    try {
      const ejs = await import('https://cdn.jsdelivr.net/npm/@emailjs/browser@4/+esm');
      const ejsLib = ejs.default || ejs;
      ejsLib.init({ publicKey: EMAILJS_PUBLIC_KEY });
      await ejsLib.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email: AGENCY_EMAIL,
        subject:  `TravelDocs · ${toNotify.length} documento(s) vencen en 6 meses`,
        message:  `Los siguientes documentos están próximos a vencer:\n\n${lines}\n\nIngresá al sistema para más detalles.`
      });
      console.log('[Alertas] Email de documentos enviado OK.');
      // Marcar como notificados solo si el envío fue exitoso
      await Promise.all(toNotify.map(e => markNotified(e.key)));
    } catch (err) {
      console.warn('[Alertas] No se pudo enviar el email:', err?.message || err);
    }
  }

  // Cumpleaños el mismo día (email separado, clave por año)
  const year = new Date().getFullYear();
  const bdCandidates = passengers.filter(p => {
    if (!p.dob) return false;
    const days = daysUntilBirthday(p.dob);
    return days === 0 && (!p.birthdayNotifiedYear || p.birthdayNotifiedYear !== year);
  }).map(p => ({
    p: p,
    name: `${p.lastname}, ${p.firstname}`,
    dob: p.dob
  }));

  console.log(`[Cumpleaños] Pasajeros que cumplen hoy: ${bdCandidates.length}`, bdCandidates.map(e => e.name));

  if (bdCandidates.length) {
    console.log(`[Cumpleaños] Enviando emails de cumpleaños a ${bdCandidates.length} pasajeros.`);
    const lines = bdCandidates.map(e =>
      `• ${e.name}  |  ¡Hoy!  |  ${fmtDate(e.dob)}`
    ).join('\n');

    try {
      const ejs2 = await import('https://cdn.jsdelivr.net/npm/@emailjs/browser@4/+esm');
      const ejsLib2 = ejs2.default || ejs2;
      ejsLib2.init({ publicKey: EMAILJS_PUBLIC_KEY });
      await ejsLib2.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email: AGENCY_EMAIL,
        subject:  `TravelDocs · ${bdCandidates.length} cumpleaños hoy`,
        message:  `Los siguientes pasajeros cumplen años hoy:\n\n${lines}\n\nIngresá al sistema para más detalles.`
      });
      console.log('[Cumpleaños] Email enviado OK.');
      await Promise.all(bdCandidates.map(e => updatePassenger(e.p.id, {birthdayNotifiedYear: year})));
    } catch (err) {
      console.warn('[Cumpleaños] No se pudo enviar el email:', err?.message || err);
    }
  } else {
    console.log('[Cumpleaños] Ningún pasajero cumple años hoy.');
  }
}

// Escapa HTML para prevenir XSS al renderizar datos de pasajeros
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// La whitelist de emails vive solo en netlify/functions/_auth.js (server-side).
// El check real de autorización se hace allí — cualquier call no autorizada devuelve 403.
onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = './login.html';
    return;
  }

  // Mostrar datos de usuario en sidebar
  const emailEl = document.getElementById('user-email');
  const avatarEl = document.getElementById('user-avatar');
  if (emailEl) emailEl.textContent = user.email;
  if (avatarEl) avatarEl.textContent = (user.email || 'U')[0].toUpperCase();

  // Arrancar listener de Firestore
  let firstLoad = true;
  listenPassengers(data => {
    passengers = data;
    refreshCurrentView();
    updateAlertBadge();
    // Ocultar loading
    document.getElementById('app-loading').style.display = 'none';
    document.getElementById('app-root').style.display = 'flex';
    // Verificar si hay documentos nuevos que necesiten alerta
    if (firstLoad) { firstLoad = false; checkAndSendAlerts(); }
  });
});

window.handleLogout = async function() {
  await signOut(auth);
  window.location.href = './login.html';
};

// ==================== VISTAS ====================
const viewTitles = {
  dashboard: 'Dashboard',
  passengers: 'Pasajeros',
  documents: 'Documentos',
  alerts: 'Alertas de vencimiento',
  import: 'Importación masiva',
  ssr: 'Generador SSR / FOID',
  travel: 'Requisitos de Vuelo'
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
  if (window.innerWidth <= 900) toggleSidebar(false);
  if (v === 'dashboard') renderDashboard();
  if (v === 'passengers') renderPassengers();
  if (v === 'documents') renderDocuments();
  if (v === 'alerts') renderAlerts();
  if (v === 'ssr') renderSSRView();
};

// Drawer móvil
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
  window.handleImportDrop(e);
});
document.getElementById('import-file-input')?.addEventListener('change', window.handleImportFiles);
document.getElementById('passengers-new-btn')?.addEventListener('click', () => window.openNewPassenger());
document.getElementById('filter-status')?.addEventListener('change', () => window.renderPassengers());
document.querySelectorAll('#doc-tabs .tab').forEach(btn => {
  btn.addEventListener('click', () => window.setDocFilter(btn.dataset.docFilter, btn));
});
document.getElementById('ssr-gds')?.addEventListener('change', () => window.regenerateSSR());
document.getElementById('ssr-pax-num')?.addEventListener('input', () => window.regenerateSSR());
document.getElementById('ssr-seg-num')?.addEventListener('input', () => window.regenerateSSR());
document.getElementById('ssr-infant')?.addEventListener('change', () => window.regenerateSSR());
document.getElementById('ssr-infant-pnum')?.addEventListener('input', () => window.regenerateSSR());
document.getElementById('ssr-search')?.addEventListener('input', () => window.filterSSRPassengers());
document.getElementById('ssr-copy-all-btn')?.addEventListener('click', () => window.copyAllSSR());
document.getElementById('btn-mode-single')?.addEventListener('click', () => window.setTravelMode('single'));
document.getElementById('btn-mode-gds')?.addEventListener('click', () => window.setTravelMode('gds'));
document.getElementById('btn-mode-pdf')?.addEventListener('click', () => window.setTravelMode('pdf'));
document.getElementById('btn-pdf-itinerario')?.addEventListener('click', () => document.getElementById('tv-pdf-file')?.click());
document.getElementById('tv-pdf-file')?.addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  window.leerItinerarioPdf(file);
});
document.getElementById('tv-origen')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
document.getElementById('tv-destino')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
document.getElementById('tv-gds-text')?.addEventListener('input', () => window.parsearGDS());
document.getElementById('tv-vuelo')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
document.getElementById('tv-btn-consultar')?.addEventListener('click', () => window.consultarVuelo());
document.getElementById('tv-btn-reset')?.addEventListener('click', () => window.resetTravelView());
document.getElementById('btn-import-cancel')?.addEventListener('click', () => window.resetImport());
document.getElementById('btn-import-save')?.addEventListener('click', () => window.saveImportedPassengers());
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
document.getElementById('scan-file')?.addEventListener('change', window.onFileSelected);
document.getElementById('form-lastname')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
document.getElementById('form-firstname')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
document.getElementById('visa-add-btn')?.addEventListener('click', () => window.addVisaEntry());
document.getElementById('ffn-add-btn')?.addEventListener('click', () => window.addFFNEntry());
document.getElementById('detail-ssr-btn')?.addEventListener('click', () => { window.showView('ssr'); window.closeModal('modal-detail'); });
document.getElementById('modal-detail-close-btn')?.addEventListener('click', () => window.closeModal('modal-detail'));
document.getElementById('modal-search-close-btn')?.addEventListener('click', () => window.closeModal('modal-search'));
document.getElementById('modal-confirm-close-btn')?.addEventListener('click', () => window.closeModal('modal-confirm'));
document.getElementById('modal-confirm-cancel-btn')?.addEventListener('click', () => window.closeModal('modal-confirm'));
document.addEventListener('click', e => {
  const stopAction = e.target.closest('[data-no-row-action]');
  if (stopAction) return;

  const dismissBtn = e.target.closest('[data-dismiss-alert]');
  if (dismissBtn) {
    e.stopPropagation();
    window.dismissAlert(dismissBtn.dataset.dismissAlert);
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

  const selectPassenger = e.target.closest('[data-select-ssr]');
  if (selectPassenger) {
    e.stopPropagation();
    window.selectSSRPassenger(selectPassenger.dataset.selectSsr);
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

  const detailRow = e.target.closest('[data-open-detail]');
  if (detailRow) {
    e.stopPropagation();
  function buildAlertEmail(items6m) {
    const lines = items6m.map(a => `- ${a.name} · ${a.docType} ${a.docNum} · vence ${fmtDate(a.expDate)} (${a.days} días)`).join('\n');
    const subject = encodeURIComponent('TravelDocs · Documentos por vencer en 6 meses');
    const body = encodeURIComponent('Estimado/a,\n\nLos siguientes documentos vencen dentro de los próximos 6 meses y requieren renovación:\n\n' + lines + '\n\nPor favor coordinar la renovación con anticipación.\n\nSaludos,\nTravelDocs');
    const recipients = [...new Set(items6m.map(a => a.email).filter(Boolean))].join(',');
    return `mailto:${recipients}?subject=${subject}&body=${body}`;
  }

  function renderAlerts() {
    const items = getAlertItems();
    const critical = items.filter(a => a.urgency <= 2 && !a.isBirthday);
    const warning = items.filter(a => a.urgency === 3 && !a.isBirthday);
    const sixMonth = items.filter(a => a.urgency === 4 && !a.isBirthday);

    const wrap = id => document.getElementById(id);
    const renderItem = a => {
      const emailLink = a.email ? `<a href="mailto:${escStr(a.email)}?subject=${encodeURIComponent(a.isBirthday ? '¡Feliz Cumpleaños!' : 'Renovación de ' + a.docType)}" data-no-row-action="true" title="${a.isBirthday ? 'Enviar saludo de cumpleaños' : 'Enviar mail al pasajero'}" style="color:var(--accent);display:flex;align-items:center;padding:4px;border-radius:6px;flex-shrink:0;">✉</a>` : '';
      const dismissBtn = `<button title="Marcar como leída" data-dismiss-alert="${escStr(a.dismissKey)}" data-no-row-action="true" style="background:none;border:none;cursor:pointer;color:var(--text3);display:flex;align-items:center;padding:4px;border-radius:6px;flex-shrink:0;">✓</button>`;
      return `<div class="alert-row" role="button" tabindex="0" data-open-detail="${escStr(a.pid)}"><div style="flex:1;"><div style="font-size:13px;font-weight:500;">${esc(a.name)}</div><div style="font-size:11px;color:var(--text3);">${a.isBirthday ? `Cumpleaños · ${fmtDate(a.expDate)}` : `${esc(a.docType)} · <span style="font-family:var(--mono);">${esc(a.docNum)}</span>`}</div></div>${a.isBirthday ? birthdayBadge(a.days) : statusBadge(a.expDate)}${emailLink}${dismissBtn}</div>`;
    };

    const elCrit = wrap('alerts-critical'); if (elCrit) elCrit.innerHTML = critical.length ? critical.map(renderItem).join('') : '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">✓ Sin alertas críticas</div>';
    const elWarn = wrap('alerts-warning'); if (elWarn) elWarn.innerHTML = warning.length ? warning.map(renderItem).join('') : '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">✓ Sin documentos por vencer</div>';
    const el6 = wrap('alerts-6months'); if (el6) { const emailBtn = sixMonth.length ? `<a href="${escStr(buildAlertEmail(sixMonth))}" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:var(--accent);background:var(--accent-light);border:1px solid #c5d8ef;border-radius:8px;padding:5px 12px;text-decoration:none;margin-bottom:12px;">Notificar a todos por email</a>` : ''; el6.innerHTML = emailBtn + (sixMonth.length ? sixMonth.map(renderItem).join('') : '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">✓ Ningún DNI o Pasaporte vence en los próximos 6 meses</div>'); }
    const elBd = wrap('alerts-birthdays'); if (elBd) { const bds = items.filter(a => a.isBirthday); elBd.innerHTML = bds.length ? bds.map(renderItem).join('') : '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">✓ Sin cumpleaños en los próximos 30 días</div>'; }
  }
    const id = detailRow.dataset.openDetail;
    window.openDetail(id);
    if (detailRow.dataset.closeModal) window.closeModal(detailRow.dataset.closeModal);
  }
});
document.addEventListener('keydown', e => {
  const interactive = e.target.closest('[data-open-detail], [data-select-ssr], [data-select-stop]');
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
  if (v === 'documents') renderDocuments();
  if (v === 'alerts') renderAlerts();
  if (v === 'ssr') renderSSRView();
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

  const urgentItems = getAlertItems().filter(a => a.urgency <= 2).slice(0, 6);
  let urgentHTML = '';
  if (!urgentItems.length) {
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
        <button data-dismiss-alert="${escStr(a.dismissKey)}" data-no-row-action="true" title="Marcar como leída"
          style="background:none;border:none;cursor:pointer;color:var(--text3);display:flex;align-items:center;padding:4px;border-radius:6px;flex-shrink:0;"
          >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
    recentHTML = '<table style="width:100%;"><tbody>';
    recent.forEach(p => {
      const s = passengerOverallStatus(p);
      const cls = ['expired','critical'].includes(s) ? 'red' : s === 'warning' ? 'amber' : 'green';
      recentHTML += `<tr style="cursor:pointer;" tabindex="0" role="button" data-open-detail="${escStr(p.id)}">
        <td style="padding:11px 14px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:32px;height:32px;border-radius:8px;background:var(--accent-light);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:var(--accent);flex-shrink:0;">${esc(initials(p))}</div>
            <div>
              <div style="font-size:13px;font-weight:500;">${esc(p.lastname)}, ${esc(p.firstname)}</div>
              <div style="font-size:11px;color:var(--text3);">${fmtDate(p.dob)} · ${esc(p.nationality)}</div>
            </div>
          </div>
        </td>
        <td style="padding:11px 14px;text-align:right;" data-no-row-action="true"><span class="badge badge-${cls === 'red' ? 'red' : cls === 'amber' ? 'amber' : 'green'}">${cls === 'red' ? 'Urgente' : cls === 'amber' ? 'Atención' : 'OK'}</span></td>
      </tr>`;
    });
    recentHTML += '</tbody></table>';
  }
  document.getElementById('dash-recent').innerHTML = recentHTML;
}

// Actualiza el badge de alertas: cuenta documentos vencidos o que vencen en <=30 días
function updateAlertBadge() {
  const count = getAlertItems().filter(a => a.urgency <= 2).length;
  const badge = document.getElementById('alert-badge');
  if (!badge) return;
  if (count > 0) { badge.textContent = String(count); badge.style.display = 'inline-flex'; }
  else { badge.style.display = 'none'; }
}

// ==================== LISTA PASAJEROS ====================
window.renderPassengers = function() {
  const filter = document.getElementById('filter-status')?.value || '';
  const search = document.getElementById('global-search')?.value?.toLowerCase() || '';

  let list = passengers.filter(p => {
    const matchSearch = !search || `${p.lastname} ${p.firstname} ${p.dni?.num||''} ${p.parg?.num||''} ${p.pext?.num||''} ${p.notes||''}`.toLowerCase().includes(search);
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
          <button class="btn btn-ghost btn-sm btn-icon" data-confirm-delete="${escStr(p.id)}" aria-label="Eliminar pasajero" title="Eliminar">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 5h10M6 5V3h4v2M6 8v5M10 8v5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
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
    if (p.dni?.num) rows.push({ pid:p.id, name, type:'dni', country:'ARG', num:p.dni.num, issue:p.dni.issue, exp:p.dni.exp });
    if (p.parg?.num) rows.push({ pid:p.id, name, type:'passport_arg', country:'ARG', num:p.parg.num, issue:p.parg.issue, exp:p.parg.exp });
    if (p.pext?.country && p.pext?.num) rows.push({ pid:p.id, name, type:'passport_ext', country:p.pext.country, num:p.pext.num, issue:p.pext.issue, exp:p.pext.exp });
    if (p.visa1?.country) rows.push({ pid:p.id, name, type:'visa', country:p.visa1.country, num:p.visa1.num, issue:p.visa1.issue, exp:p.visa1.exp });
    if (p.visa2?.country) rows.push({ pid:p.id, name, type:'visa', country:p.visa2.country, num:p.visa2.num, issue:p.visa2.issue, exp:p.visa2.exp });
  });

  if (currentDocFilter !== 'all') rows = rows.filter(r => r.type === currentDocFilter);
  rows.sort((a,b) => { const da = daysUntil(a.exp) ?? 9999, db = daysUntil(b.exp) ?? 9999; return da - db; });

  const typeLabels = { dni:'DNI', passport_arg:'Pasaporte ARG', passport_ext:'Pas. Extranjero', visa:'Visa' };

  if (!rows.length) {
    document.getElementById('documents-tbody').innerHTML =
      `<tr><td colspan="7"><div class="empty-state"><div class="empty-title">Sin documentos</div></div></td></tr>`;
    return;
  }

  let html = '';
  rows.forEach(r => {
    html += `<tr style="cursor:pointer;" tabindex="0" role="button" data-open-detail="${escStr(r.pid)}">
      <td><span style="font-weight:500;">${esc(r.name)}</span></td>
      <td><span class="badge badge-gray">${typeLabels[r.type]}</span></td>
      <td><span class="chip">${esc(r.country)}</span></td>
      <td><span class="doc-num">${esc(r.num || '—')}</span></td>
      <td style="font-size:12px;color:var(--text2);">${fmtDate(r.issue)}</td>
      <td style="font-size:12px;">${fmtDate(r.exp)}</td>
      <td>${statusBadge(r.exp)}</td>
    </tr>`;
  });
  document.getElementById('documents-tbody').innerHTML = html;
}

// ==================== ALERTAS ====================

function isDismissed(key) {
  return !!localStorage.getItem(key);
}

function setDismissed(key) {
  localStorage.setItem(key, '1');
}

function daysUntilBirthday(dob) {
  const birth = dob ? new Date(`${dob}T00:00:00`) : null;
  if (!birth || Number.isNaN(birth.getTime())) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
  if (next < today) next.setFullYear(next.getFullYear() + 1);
  return Math.floor((next - today) / 86400000);
}

function birthdayBadge(days) {
  if (days === 0) return '<span class="badge badge-red pulse">Hoy</span>';
  if (days === 1) return '<span class="badge badge-amber">Mañana</span>';
  if (days <= 7) return `<span class="badge badge-amber">En ${days}d</span>`;
  return `<span class="badge badge-green">En ${days}d</span>`;
}

function getAlertItems() {
  const items = [];

  const pushDoc = (p, docType, docNum, expDate) => {
    const days = daysUntil(expDate);
    if (days === null) return;

    const dismissKey = `tdAlert_${p.id}_${docType}_${expDate}`;
    if (isDismissed(dismissKey)) return;

    const urgency = days < 0 ? 1 : days <= 30 ? 2 : days <= 90 ? 3 : days <= 180 ? 4 : 5;
    if (urgency > 4) return;

    items.push({
      pid: p.id,
      name: `${p.lastname}, ${p.firstname}`,
      docType,
      docNum: docNum || '—',
      expDate,
      days,
      urgency,
      isBirthday: false,
      dismissKey,
      email: p.email || ''
    });
  };

  const pushBirthday = p => {
    if (!p.dob) return;
    const days = daysUntilBirthday(p.dob);
    if (days === null || days > 30) return;

    const dismissKey = `bdAlert_${p.id}_${p.dob}`;
    if (isDismissed(dismissKey)) return;

    items.push({
      pid: p.id,
      name: `${p.lastname}, ${p.firstname}`,
      docType: 'Cumpleaños',
      docNum: '—',
      expDate: p.dob,
      days,
      urgency: days === 0 ? 2 : 3,
      isBirthday: true,
      dismissKey,
      email: p.email || ''
    });
  };

  passengers.forEach(p => {
    if (p.dni?.exp) pushDoc(p, 'DNI', p.dni.num, p.dni.exp);
    if (p.parg?.exp) pushDoc(p, 'Pasaporte ARG', p.parg.num, p.parg.exp);
    if (p.pext?.country && p.pext?.exp) pushDoc(p, `Pas. ${p.pext.country}`, p.pext.num, p.pext.exp);
    if (p.visa1?.country && p.visa1?.exp) pushDoc(p, `Visa ${p.visa1.country}`, p.visa1.num, p.visa1.exp);
    if (p.visa2?.country && p.visa2?.exp) pushDoc(p, `Visa ${p.visa2.country}`, p.visa2.num, p.visa2.exp);
    pushBirthday(p);
  });

  items.sort((a, b) => a.urgency - b.urgency || a.days - b.days || a.name.localeCompare(b.name));
  return items;
}

function dismissAlert(key) {
  if (!key) return;
  setDismissed(key);
  updateAlertBadge();
  refreshCurrentView();
}

