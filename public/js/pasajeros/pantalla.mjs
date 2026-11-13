import { _airlineBadgeHtml } from '../compartido/aerolineas-ui.mjs';
import { getFFNEntries } from './viajeros-frecuentes.mjs';
import { emergencyContactsOf } from './contactos.mjs';
import { estado } from '../compartido/estado.mjs';
import { matchesPassenger } from './passenger-search.mjs';
import { addPassenger, updatePassenger, deletePassenger } from '../db.js';
import { statusBadge, passengerOverallStatus, fmtDate, daysUntil, initials, escStr, asistenciaBadge } from '../compartido/utils.js';
import { buildSSRStrings } from '../documentos/ssr.js';
import { programaFfn } from '../compartido/ffn-programs.mjs';
import { nombreAerolinea } from '../compartido/airlines.mjs';
import { passengerDetailFlags } from '../reservas/reservation-view.mjs';
import { esc, showConfirmDialog, showToast } from '../compartido/ui.mjs';
import { clearScanUI } from '../documentos/scanner-ui.mjs';
import { findDuplicateMatch } from './duplicados.mjs';


// ==================== DETALLE PASAJERO ====================
// GDS elegido para generar strings SSR en el perfil del pasajero (persiste la última elección)
function currentSSRGds() { return localStorage.getItem('td_ssr_gds') || 'amadeus'; }

// Render de la lista de strings SSR para un GDS dado (usado en openDetail y al cambiar el select)
function renderSSRItems(p, gds) {
  const items = buildSSRStrings(p, '1', '1', null, { gds }).filter(s => s.value);
  if (!items.length) return '<div style="font-size:13px;color:var(--text3);">Sin documentos cargados.</div>';
  return items.map(s => `<div style="background:var(--surface2);border-radius:8px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div>
        <div class="ssr-item-label">${esc(s.label)}</div>
        <code style="font-size:11.5px;font-family:var(--mono);color:var(--text);word-break:break-all;">${esc(s.value)}</code>
        ${s.label.includes('Email') && p.email && /[_-]/.test(p.email) ? '<div style="font-size:10px;color:var(--text3);margin-top:3px;">Email codificado para GDS (_ → .. y - → ./, estándar IATA).</div>' : ''}
      </div>
      <button class="copy-btn" style="flex-shrink:0;" data-copy-ssr="${escStr(s.value)}" data-no-row-action="true">copiar</button>
    </div>`).join('');
}

function getOverallBadge(p) {
  const s = passengerOverallStatus(p);
  if (['expired','critical'].includes(s)) return `<span class="badge badge-red">Docs vencidos</span>`;
  if (s === 'warning') return `<span class="badge badge-amber">Por vencer</span>`;
  if (s === 'ok') return `<span class="badge badge-green">Todo vigente</span>`;
  return `<span class="badge badge-gray">Sin datos</span>`;
}

// ── Visas (grupo dinámico) ─────────────────────────────────

// Agrega una fila de visa al formulario
let _visaIdx = 0;

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

// HTML del badge "AA - American Airlines" para un código IATA (vacío si no aplica).


// Deriva el código IATA del prefijo del número de vuelo (ej. "AF557" -> "AF", "G31234" -> "G3").


// Agrega una fila de Viajero Frecuente al formulario
let _ffnIdx = 0;

// Devuelve array [{airline, number}] con los datos cargados


// Limpia todas las filas FFN
function clearFFNList() {
  const list = document.getElementById('ffn-list');
  if (list) list.innerHTML = '';
  const empty = document.getElementById('ffn-empty');
  if (empty) empty.style.display = '';
}

let _emergencyIdx = 0;

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
export function initPasajeros() {
  document.getElementById('filter-status')?.addEventListener('change', () => window.renderPassengers());

  document.getElementById('passengers-new-btn')?.addEventListener('click', () => window.openNewPassenger());

  document.getElementById('modal-passenger-close-btn')?.addEventListener('click', () => window.closeModal('modal-passenger'));

  document.getElementById('modal-passenger-cancel-btn')?.addEventListener('click', () => window.closeModal('modal-passenger'));

  document.getElementById('btn-save-passenger')?.addEventListener('click', () => window.savePassenger());

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

  // ==================== LISTA PASAJEROS ====================
  window.renderPassengers = function() {
    const filter = document.getElementById('filter-status')?.value || '';
    const search = document.getElementById('global-search')?.value?.toLowerCase() || '';

    let list = estado.passengers.filter(p => {
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

  // Cambiar el GDS del selector: persiste y re-renderiza solo la lista SSR del modal abierto
  window.changeSSRGds = function(value) {
    localStorage.setItem('td_ssr_gds', value);
    const p = estado.passengers.find(x => x.id === window._detailPassengerId);
    if (!p) return;
    const list = document.getElementById('ssr-items-list');
    if (list) list.innerHTML = renderSSRItems(p, value);
  };

  window.openDetail = function(id, opts = {}) {
    const p = estado.passengers.find(x => x.id === id);
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

  // ==================== FORMULARIO PASAJERO ====================
  window.openNewPassenger = function() {
    estado.currentEditId = null;
    document.getElementById('modal-passenger-title').textContent = 'Nuevo pasajero';
    clearForm();
    clearScanUI();
    openModal('modal-passenger');
    // Siempre arranca arriba, en la zona para adjuntar documentos.
    document.querySelector('#modal-passenger .modal-body').scrollTop = 0;
  };

  window.openEdit = function(id) {
    const p = estado.passengers.find(x => x.id === id);
    if (!p) return;
    estado.currentEditId = id;
    document.getElementById('modal-passenger-title').textContent = 'Editar pasajero';
    fillForm(p);
    clearScanUI();
    openModal('modal-passenger');
  };

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

  // Muestra "AA - American Airlines" junto al campo compañía cuando hay match
  window.onCompaniaInput = function(input) {
    const badge = document.getElementById('res-compania-badge');
    if (!badge) return;
    const code = (input.value || '').trim().toUpperCase();
    input.value = code;
    badge.innerHTML = _airlineBadgeHtml(code);
  };

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
    const dupMatch = findDuplicateMatch(dupCheck, estado.currentEditId);
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
      if (estado.currentEditId) {
        await updatePassenger(estado.currentEditId, data);
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

  window.confirmDelete = function(id) {
    const p = estado.passengers.find(x => x.id === id);
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
    const results = estado.passengers.filter(p =>
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
}
