import { estadoImportacion } from '../importacion/pantalla.mjs';
import { loadScanner, loadItinerario, loadTravelReqs } from '../compartido/cargas.mjs';
import { auth } from '../compartido/firebase.mjs';
import { esc, showToast } from '../compartido/ui.mjs';
import { cargarPdfjs } from '../compartido/pdf.mjs';


// Consulta principal
// ── Estado del modo GDS ──────────────────────────────────────
let _travelMode      = 'single'; // 'single' | 'gds' | 'pdf'
let _parsedSegmentos = [];       // [{vuelo, origen, destino, fecha}]
let _pdfSegmentos    = [];

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

function msgPdf(texto, error) {
  const el = document.getElementById('tv-pdf-msg');
  if (!el) return;
  el.style.color = error ? 'var(--red)' : 'var(--text3)';
  el.textContent = texto;
}

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
export function initRequisitos() {
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

  window.parsearGDS = function() {
    const texto = (document.getElementById('tv-gds-text')?.value || '');
    _parsedSegmentos = parseGDSSegmentos(texto);
    pintarTramos(document.getElementById('gds-preview'), _parsedSegmentos);
  };

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

  window.resetImport = function() {
    estadoImportacion.importGroups = [];
    document.getElementById('import-dropzone').style.display = 'block';
    document.getElementById('import-progress-wrap').style.display = 'none';
    document.getElementById('import-review-wrap').style.display = 'none';
    document.getElementById('import-file-input').value = '';
    const excelInput = document.getElementById('import-excel-input');
    if (excelInput) excelInput.value = '';
    const btn = document.getElementById('btn-import-save');
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 4L6 11l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Guardar todos'; }
  };
}
