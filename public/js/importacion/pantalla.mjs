import { groupByPassenger } from './agrupacion.mjs';
import { findDuplicateMatch, findDuplicateInDB } from '../pasajeros/duplicados.mjs';
import { estado } from '../compartido/estado.mjs';
import { csvField, excelRowToPassenger } from './csv-import.mjs';
import { addPassengersBatch } from '../db.js';
import { fmtDate } from '../compartido/utils.js';
import { loadScanner } from '../compartido/cargas.mjs';
import { esc, showToast } from '../compartido/ui.mjs';
import { emergencyContactsOf } from '../pasajeros/contactos.mjs';

const estadoImportacion = {
  importGroups: []
};
 // array de pasajeros agrupados para revisar

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

async function startBulkImport(files) {
  estadoImportacion.importGroups = [];
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

  estadoImportacion.importGroups = groupByPassenger(results);
  progressWrap.style.display = 'none';
  renderImportReview();
}

async function startExcelImport(file) {
  estadoImportacion.importGroups = [];
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
    estadoImportacion.importGroups = dataRows
      .map(r => excelRowToPassenger(r || [], fieldOf))
      // 1 fila = 1 pasajero; saltar filas vacias (sin apellido ni nombre ni docs)
      .filter(g => g.lastname || g.firstname || g.dni?.num || g.parg?.num)
      .map(g => ({ ...g, _files: [file.name] }));

    progressWrap.style.display = 'none';
    if (!estadoImportacion.importGroups.length) {
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


function renderImportReview() {
  const wrap = document.getElementById('import-review-wrap');
  const sub = document.getElementById('import-review-sub');
  const table = document.getElementById('import-review-table');

  sub.textContent = `${estadoImportacion.importGroups.length} pasajero(s) detectado(s)`;

  let html = '<div style="display:flex;flex-direction:column;gap:12px;">';
  const reviewed = [...estado.passengers];
  estadoImportacion.importGroups.forEach((g, idx) => {
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

// Busca si un grupo del import ya existe en la base de datos
// por número de pasaporte (primario) o apellido+nombre+fecha (fallback)


export function initImportacion() {
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

  document.getElementById('btn-import-cancel')?.addEventListener('click', () => window.resetImport());

  document.getElementById('btn-import-save')?.addEventListener('click', () => window.saveImportedPassengers());

  window.handleImportFiles = async function(e) {
    const { archivosImportacionMasiva } = await loadScanner();
    const files = archivosImportacionMasiva(e.target.files);
    if (files.length) startBulkImport(files);
    e.target.value = ''; // allow re-selecting the same file/folder via click
  };

  // ==================== IMPORTACION DESDE EXCEL/CSV ====================

  window.handleExcelImport = function(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // permitir re-seleccionar el mismo archivo
    if (!file) return;
    startExcelImport(file);
  };

  window.removeImportGroup = function(idx) {
    estadoImportacion.importGroups.splice(idx, 1);
    if (estadoImportacion.importGroups.length === 0) { resetImport(); return; }
    document.getElementById('import-review-sub').textContent = `${estadoImportacion.importGroups.length} pasajero(s) detectado(s)`;
    renderImportReview();
  };

  window.saveImportedPassengers = async function() {
    const btn = document.getElementById('btn-import-save');
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px;"></span>Guardando...';

    let ok = 0, skipped = 0, fail = 0;
    // Armar la lista de pasajeros a guardar (mismo filtro que antes, client-side)
    const toSave = [];
    const queued = [];
    let pending = [];
    for (const g of estadoImportacion.importGroups) {
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
      estadoImportacion.importGroups = pending;
      renderImportReview();
      btn.disabled = false;
      btn.textContent = 'Reintentar pendientes';
      return;
    }
    resetImport();
    showView('passengers');
  };
}

export { estadoImportacion, loadXlsx };
