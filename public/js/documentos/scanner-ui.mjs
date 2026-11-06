import { normScanValue, normScanNumber } from './identidad.mjs';
import { estado } from '../compartido/estado.mjs';
import { addPassenger } from '../db.js';
import { loadScanner } from '../compartido/cargas.mjs';
import { getFFNEntries } from '../pasajeros/viajeros-frecuentes.mjs';
import { showToast } from '../compartido/ui.mjs';
import { groupByPassenger } from '../importacion/agrupacion.mjs';
import { findDuplicateInDB } from '../pasajeros/duplicados.mjs';


let scanDetectedOtherGroups = [];


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

  const hasPreloadedData = !!estado.currentEditId ||
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
export function initScanner() {
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
}

export { clearScanUI };
