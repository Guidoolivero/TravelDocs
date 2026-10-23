// ============================================================
//  alert-core.mjs — Lógica de alertas compartida cliente + server
//
//  Módulo "leaf": CERO imports y cero side effects (no toca window,
//  DOM ni Firebase). La require netlify/functions/send-alerts.cjs
//  (esbuild la bundlea desde CommonJS, mismo patrón que conocidos.mjs
//  en gemini-travel.cjs) y la importan app.mjs y alerts.test.mjs.
//
//  Regla central de fechas: TODO se resuelve en el calendario de
//  Argentina (America/Argentina/Buenos_Aires, UTC-3 fijo sin DST),
//  igual que parseResTs/hoy en el cliente. Nunca se depende del TZ
//  del runtime (el browser corre en ART, Netlify en UTC: sin esto
//  los vencimientos/cumpleaños/check-ins se desfazarían 3 horas).
// ============================================================

const ARG_TZ = 'America/Argentina/Buenos_Aires';

// Partes de una fecha en calendario argentino (patrón usageDayId de _usage.cjs)
function partesART(ms, opts) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ARG_TZ, ...opts }).formatToParts(new Date(ms));
  const get = t => (parts.find(p => p.type === t) || {}).value;
  return get;
}

// 'YYYY-MM-DD' de "ahora" en Argentina
export function hoyART(now = Date.now()) {
  const get = partesART(now, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Año de "ahora" en Argentina como NUMBER (para birthdayNotifiedYear: el
// dato histórico es numérico — new Date().getFullYear() — y compararlo como
// string rompería el dedup y reenviaría cumpleaños ya notificados).
export function anioART(now = Date.now()) {
  return Number(hoyART(now).slice(0, 4));
}

// 'YYYY-MM-DD' de un epoch cualquiera, en calendario argentino
export function diaART(ms) {
  const get = partesART(ms, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Diferencia exacta de días entre dos date-only 'YYYY-MM-DD'.
// Se parsean como UTC midnight para que la resta sea exacta (sin DST/TZ).
export function diasEntre(a, b) {
  const ya = a?.split('-').map(Number);
  const yb = b?.split('-').map(Number);
  if (!ya || !yb || ya.length !== 3 || yb.length !== 3 || ya.some(isNaN) || yb.some(isNaN)) return null;
  return Math.round((Date.UTC(yb[0], yb[1] - 1, yb[2]) - Date.UTC(ya[0], ya[1] - 1, ya[2])) / 86400000);
}

// Parseo explícito ART: acepta los formatos que existen en la DB y SIEMPRE
// resuelve como UTC-3 (o el offset que el string ya trae). Devuelve epoch o null.
//  - 'YYYY-MM-DDTHH:mm'      (16) -> el que escriben todos los writers actuales
//  - 'YYYY-MM-DDTHH:mm:ss'   (19) -> defensivo
//  - 'YYYY-MM-DD'            (10) -> medianoche ART (defensivo; un check-in
//                                     cargado solo con fecha alerta desde las 00:00)
//  - string con offset propio ('...Z' o '+HH:MM'/'-HH:MM') -> tal cual
export function parseFechaART(fechaStr) {
  if (!fechaStr || typeof fechaStr !== 'string') return null;
  const s = fechaStr.trim();
  let iso = null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) iso = s + ':00-03:00';
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) iso = s + '-03:00';
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = s + 'T00:00:00-03:00';
  else if (/(Z|[+-]\d{2}:\d{2})$/.test(s)) iso = s;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : t;
}

// ¿Hay que mandar el alerta de check-in de este tramo?
//
// Semántica de DÍAS de anticipación (no reloj exacto), igual que el
// comportamiento histórico de legIsDue "hoy o mañana": con 24 avisa
// desde el día anterior al vuelo y hasta la salida; con 48 desde 2
// días antes; con 72 desde 3 días antes. Ejemplo que no puede romperse:
// vuelo mañana 21:00 + agente que entra hoy 9:00 -> alerta (faltan 36hs
// de reloj, pero es "el día anterior").
//
// La ventana abre a las 00:00 ART del día (vuelo - N días) y no cierra
// hasta la salida: el cron horario recupera corridas perdidas y el flag
// piernas[].notified deduplica.
// Aviso de requisitos: desde 30 días de calendario ART antes del primer
// vuelo y hasta que ese vuelo sale. Un check-in cargado ya adentro de la
// ventana también entra.
export const REQUISITOS_DIAS = 30;

// Días de calendario ART hasta el vuelo. Negativo si ya pasó ese día.
export function diasHastaVuelo(fechaStr, now = Date.now()) {
  const t = parseFechaART(fechaStr);
  if (t == null) return null;
  return diasEntre(hoyART(now), diaART(t));
}

// El primer tramo que todavía no salió. Si todos salieron, el último.
export function proximaFechaVuelo(fechas, now = Date.now()) {
  const orden = (Array.isArray(fechas) ? fechas : []).filter(Boolean).slice().sort();
  if (!orden.length) return null;
  const futura = orden.find(f => {
    const d = diasHastaVuelo(f, now);
    return d != null && d >= 0;
  });
  return futura || orden[orden.length - 1];
}

// Menor = más arriba en Check ins. Próximo tramo pendiente, el más cercano
// primero. Si ya salieron todos, va al final.
export function claveOrdenCheckin(fechas, now = Date.now()) {
  const dias = diasHastaVuelo(proximaFechaVuelo(fechas, now), now);
  if (dias == null) return Number.POSITIVE_INFINITY;
  if (dias < 0) return 100000 - dias;
  return dias;
}

// Hasta 7 días (una semana) rojo, hasta 15 ámbar, más de 15 verde.
// Un viaje que ya salió queda rojo.
export function colorDiasViaje(dias) {
  if (dias == null) return null;
  if (dias <= 7) return 'red';
  if (dias <= 15) return 'amber';
  return 'green';
}

export function requisitosAlertDue(fechaStr, now = Date.now()) {
  const t = parseFechaART(fechaStr);
  if (t == null || now >= t) return false;
  const diff = diasEntre(hoyART(now), diaART(t));
  return diff != null && diff >= 0 && diff <= REQUISITOS_DIAS;
}

export function checkinAlertDue(fechaStr, horasAntes = 24, now = Date.now()) {
  const t = parseFechaART(fechaStr);
  if (t == null || now >= t) return false; // ya salió el vuelo
  const h = Number(horasAntes);
  const dias = [24, 48, 72].includes(h) ? h / 24 : 1;
  const diff = diasEntre(hoyART(now), diaART(t));
  return diff != null && diff >= 0 && diff <= dias;
}

// ¿Se limpia solo este check-in? Todas las piernas volaron antes de hoy
// (día de calendario ART): al día siguiente del último vuelo ya no sirve.
// Con una pierna sin fecha no se puede saber -> false (no se borra).
export function reservationStale(piernas, now = Date.now()) {
  const list = Array.isArray(piernas) ? piernas : [];
  if (!list.length) return false;
  const hoy = hoyART(now);
  return list.every(p => {
    const t = parseFechaART(p?.fecha);
    return t != null && diaART(t) < hoy;
  });
}

// ¿Cumple años hoy este pasajero? Compara mes/día del dob contra el
// calendario ART de "ahora" (el cliente viejo usaba getDate() del runtime).
// Policy 02-29 (se mantiene la actual): solo coincide en años bisiestos.
export function isBirthdayToday(pax, now = Date.now()) {
  const dob = pax?.dob;
  if (!dob || typeof dob !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  return hoyART(now).slice(5) === dob.slice(5);
}

// Días de calendario ART entre "hoy" y una fecha date-only 'YYYY-MM-DD'
// (vencimientos de documentos). Reemplaza a daysUntil en el camino de
// alertas: daysUntil es elapsed-time del runtime, esto es calendario ART.
export function diasHastaART(expStr, now = Date.now()) {
  if (!expStr || typeof expStr !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(expStr)) return null;
  return diasEntre(hoyART(now), expStr.slice(0, 10));
}

// ── Vencimientos: mismos helpers que vivían en utils.js ──────
// (movidos acá para que el server los reutilice; utils.js los re-exporta)

// Asistencias al viajero: avisan solo 30 días antes del vencimiento
// (los demás documentos avisan a 180 días).
export const ASISTENCIA_ALERT_DAYS = 30;

export function getPassengerVisas(p) {
  const list = Array.isArray(p.visas) && p.visas.length ? p.visas : [p.visa1, p.visa2];
  return list.filter(v => v?.exp && (v?.country || v?.num));
}

export function visaAlertLabel(v) {
  return v.type === 'E' ? 'ESTA' : `Visa ${v.country}`;
}

// Documentos dentro de la ventana de aviso (180 días, asistencias 30).
// Clave única: passengerId + docType + expDate -> cada vencimiento se
// notifica UNA sola vez; si renuevan el documento, la clave cambia.
export function collectEmailAlertCandidates(passengers, now = Date.now()) {
  const candidates = [];
  passengers.forEach(p => {
    const check = (docType, docNum, exp, alertDays = 180) => {
      const days = diasHastaART(exp, now);
      if (days === null || days < 0 || days > alertDays) return;
      const key = `tdAlert_${p.id}_${docType}_${exp}`;
      candidates.push({ key, name: `${p.lastname}, ${p.firstname}`, docType, docNum: docNum || '—', exp, days });
    };
    if (p.dni?.exp) check(p.dni.country && p.dni.country !== 'ARG' ? `DNI ${p.dni.country}` : 'DNI', p.dni.num, p.dni.exp);
    if (p.parg?.exp) check('Pasaporte ARG', p.parg.num, p.parg.exp);
    if (p.pext?.exp && p.pext?.country) check(`Pas. ${p.pext.country}`, p.pext.num, p.pext.exp);
    getPassengerVisas(p).forEach(v => check(visaAlertLabel(v), v.num, v.exp));
    p.asistencias?.forEach(a => {
      if (a.fin && parseInt(a.duracion || '0') >= 30) {
        check('Asistencia al Viajero', a.num, a.fin, ASISTENCIA_ALERT_DAYS);
      }
    });
  });
  return candidates;
}

// ── Email unificado (Vencimientos | Check Ins | Cumpleaños) ──
// HTML email-safe: Arial/Helvetica, estilos inline, tablas con
// table-layout:fixed y columnas de ancho en % ( Outlook no respeta
// word-break solo; el layout fijo + % alcanza). Nombres largos hacen
// wrap dentro de su columna en vez de desplazar la fila.

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function escHtml(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Epoch -> '10 sep 2026' (calendario ART)
function fmtDia(ms) {
  const get = partesART(ms, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${get('day')} ${MESES[Number(get('month')) - 1]} ${get('year')}`;
}

// Epoch -> '10 sep · 21:00' (calendario ART)
function fmtDiaHora(ms) {
  const get = partesART(ms, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${get('day')} ${MESES[Number(get('month')) - 1]} &middot; ${get('hour')}:${get('minute')}`;
}

// Date-only 'YYYY-MM-DD' -> '17 ene 1971' (UTC, determinístico)
function fmtDiaStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return s;
  return `${String(d).padStart(2, '0')} ${MESES[m - 1]} ${y}`;
}

// 'MAR 8 SEP 2026' — fecha de cabecera en español y calendario ART
function fechaHeaderART(now) {
  const parts = new Intl.DateTimeFormat('es-AR', { timeZone: ARG_TZ, weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date(now));
  const get = t => (parts.find(p => p.type === t) || {}).value;
  const mes = MESES[Number(get('month')) - 1] || get('month');
  return `${get('weekday')} ${get('day')} ${mes} ${get('year')}`.toUpperCase().replace(/\./g, '');
}

// Paleta del diseño editorial del email (fondo crema, tinta, grises)
const CREMA = '#f0ece4';
const GRIS_TEXTO = '#9c8f82';
const GRIS_HEADER = '#6b6256';
const BORDE_SUAVE = '#d4cdc4';
const TINTA = '#111827';
const ROJO_CRITICO = '#c0392b';
const SERIF = "font-family:Georgia,'Times New Roman',serif;";
const SANS = 'font-family:Arial,Helvetica,sans-serif;';
const MONO = 'font-family:Tahoma,Arial,sans-serif;';

// Título de sección (serif) + conteo a la derecha
function encabezadoSeccion(titulo, conteo) {
  return `<tr><td style="padding-bottom:16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="60%"><span class="td-title" style="${SERIF}font-size:22px;font-weight:bold;color:${TINTA};letter-spacing:-0.5px;">${escHtml(titulo)}</span></td>
<td width="40%" align="right" valign="middle"><span class="td-count" style="font-size:11px;color:${GRIS_TEXTO};${SANS}">${escHtml(conteo)}</span></td>
</tr></table></td></tr>`;
}

// Fila de encabezados de tabla (borde superior de tinta, labels mini uppercase).
// En mobile se oculta (los datos se apilan con sus mini-etiquetas).
function filaEncabezado(cols) {
  const ths = cols.map(c => `<th width="${c.w}%" class="td-th" style="padding:6px 0;text-align:left;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:0.1em;color:${GRIS_TEXTO};${SANS};">${escHtml(c.t)}</th>`).join('');
  return `<tr><td class="td-headrow td-btop" style="border-top:1px solid ${TINTA};border-bottom:1px solid ${BORDE_SUAVE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><tr>${ths}</tr></table>
</td></tr>`;
}

// Fila de datos: una tabla anidada por fila (patrón clásico email-safe)
function filaDatos(celdas) {
  return `<tr><td class="td-bbot" style="border-bottom:1px solid ${BORDE_SUAVE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><tr>${celdas}</tr></table>
</td></tr>`;
}

// Celda base de fila de datos
function tdDatos(w, content, extra = '') {
  return `<td width="${w}%" class="td-td td-cell" style="padding:14px 0;font-size:14px;color:${TINTA};${SANS}${extra}">${content}</td>`;
}

// Mini-etiqueta que solo se ve en mobile (cuando las celdas se apilan)
function mlabel(texto) {
  return `<span class="td-mlabel" style="display:none;color:${GRIS_TEXTO};font-size:11px;">${escHtml(texto)} </span>`;
}

// Estilos del email. Dos media queries:
// 1) MODO OSCURO: los email clients no permiten JS ni "detectar" el tema.
//    La técnica estándar: declarar color-scheme (evita inversiones naive) +
//    overrides !important en prefers-color-scheme con NUESTRA paleta oscura.
//    Apple Mail y Gmail lo respetan; Outlook hace inversión forzada y esta
//    paleta cálida queda decente invertida.
// 2) MOBILE: en pantallas chicas las celdas se apilan verticalmente
//    (display:block), se ocultan los encabezados de columna y aparecen las
//    mini-etiquetas. Outlook desktop no soporta media queries y sigue
//    viendo el layout de escritorio (sin regresión).
const ESTILO_EMAIL = `<style>
@media (prefers-color-scheme: dark) {
  body { background-color:#1c1915 !important; }
  .td-root { background-color:#1c1915 !important; }
  .td-brand, .td-title, .td-flight, .td-td { color:#ece7de !important; }
  .td-date, .td-count, .td-th, .td-sub, .td-plus, .td-foot, .td-mlabel { color:#a89e90 !important; }
  .td-crit { color:#e0785c !important; }
  .td-btop { border-top-color:#ece7de !important; border-bottom-color:#3d382f !important; }
  .td-bbot { border-bottom-color:#3d382f !important; }
  .td-b2 { border-bottom-color:#ece7de !important; }
}
@media (max-width: 620px) {
  .td-headrow { display: none !important; }
  .td-cell { display: block !important; width: 100% !important; box-sizing: border-box; padding: 3px 0 !important; }
  .td-cell:first-child { padding-top: 12px !important; }
  .td-cell:last-child { padding-bottom: 14px !important; }
  .td-right { text-align: left !important; white-space: normal !important; }
  .td-mlabel { display: inline !important; }
  .td-sec { padding-top: 30px !important; }
  .td-brandrow { padding-bottom: 22px !important; }
}
</style>`;

// Cáscara común de los mails: fondo crema, marca, fecha y pie.
// filas es el cuerpo, sin cabecera ni pie.
export function marcoEmail({ appName = 'TravelDocs', now = Date.now(), filas = [] }) {
  const head = `<tr><td class="td-brandrow td-b2" style="padding-bottom:32px;border-bottom:2px solid ${TINTA};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="bottom"><span class="td-brand" style="${SERIF}font-size:32px;font-weight:bold;color:${TINTA};letter-spacing:-1px;line-height:1;">${escHtml(appName)}</span></td>
<td valign="bottom" align="right"><span class="td-date" style="font-size:11px;color:${GRIS_HEADER};${SANS}letter-spacing:0.04em;">${escHtml(fechaHeaderART(now))}</span></td>
</tr></table></td></tr>`;
  const foot = `<tr><td style="padding-top:48px;">
<span class="td-foot" style="font-size:10px;color:${GRIS_TEXTO};${SANS}letter-spacing:0.04em;">Enviado automáticamente por ${escHtml(appName)} &mdash; Ingresá para más detalles.</span>
</td></tr>`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
${ESTILO_EMAIL}
</head>
<body style="margin:0;padding:0;background-color:${CREMA};${SANS}">
<table role="presentation" class="td-root" width="100%" cellpadding="0" cellspacing="0" style="background-color:${CREMA};">
<tr><td align="center" style="padding:40px 16px 48px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
${[head, ...filas, foot].join('\n')}
</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Compone el email unificado de alertas (diseño editorial: fondo crema,
 * títulos Georgia, bordes finos, tablas anidadas por fila — todo inline y
 * con fuentes web-safe).
 *   vencimientos : [{ name, docType, docNum, exp ('YYYY-MM-DD'), days }]
 *   checkins     : [{ pax, paxCount, vuelo, ruta, fecha ('YYYY-MM-DDTHH:mm'), ref }]
 *   cumpleanos   : [{ name, dob ('YYYY-MM-DD') }]
 *   requisitos   : [{ name, ruta, fecha }]
 *   now          : epoch opcional (para la fecha de cabecera; tests)
 * Devuelve { subject, html }. Las secciones vacías no se renderizan y el
 * asunto arma dinámicamente solo con las presentes, en orden fijo.
 */
export function buildAlertEmail({ appName = 'TravelDocs', vencimientos = [], checkins = [], cumpleanos = [], requisitos = [], formularios = [], now = Date.now() }) {
  const secciones = [];
  if (vencimientos.length) secciones.push('Vencimientos');
  if (checkins.length) secciones.push('Check Ins');
  if (cumpleanos.length) secciones.push('Cumpleaños');
  if (requisitos.length) secciones.push('Verifique requisitos');
  if (formularios.length) secciones.push('Formularios');
  const subject = secciones.length ? `${appName} · ${secciones.join(' | ')}` : appName;

  const filas = [];
  if (formularios.length) {
    filas.push(`<tr><td style="padding-top:36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${encabezadoSeccion('Formularios pendientes', `${formularios.length} recordatorio(s)`)}
${filaEncabezado([{ t: 'Formulario', w: 40 }, { t: 'Pasajeros', w: 40 }, { t: 'Ingreso', w: 20 }])}
${formularios.map(f => filaDatos(tdDatos(40, escHtml(f.title)) + tdDatos(40, escHtml(f.pax)) + tdDatos(20, escHtml(fmtDiaStr(f.date))))).join('\n')}
</table></td></tr>`);
  }

  // Sección 1: Vencimientos próximos
  if (vencimientos.length) {
    const n = vencimientos.length;
    const filasV = vencimientos.map(v => {
      // Rojo cuando entra en la ventana crítica del semáforo (<= 30 días)
      const critico = v.days != null && v.days <= 30;
      const estilo = critico ? `font-weight:bold;color:${ROJO_CRITICO};` : `color:${TINTA};`;
      const clase = critico ? 'td-crit' : 'td-td';
      const sub = critico ? `font-weight:bold;color:${ROJO_CRITICO};` : `color:${GRIS_TEXTO};`;
      const subClase = critico ? 'td-crit' : 'td-sub';
      const cuando = v.days === 0 ? 'hoy' : `en ${v.days} día${v.days === 1 ? '' : 's'}`;
      return filaDatos(
        tdDatos(34, escHtml(v.name), 'line-height:1.5;word-break:break-word;')
        + tdDatos(26, escHtml(v.docType))
        + tdDatos(20, mlabel('Número') + escHtml(v.docNum), MONO)
        + `<td width="20%" class="td-cell" style="padding:14px 0;${SANS}">
<span class="${clase}" style="font-size:14px;${estilo}">${escHtml(fmtDiaStr(v.exp))}</span><br>
<span class="${subClase}" style="font-size:12px;${sub}">${critico ? '&#9651; ' : ''}${escHtml(cuando)}</span>
</td>`
      );
    });
    filas.push(`<tr><td class="td-sec" style="padding-top:36px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${encabezadoSeccion('Vencimientos próximos', `${n} documento${n === 1 ? '' : 's'}`)}
${filaEncabezado([{ t: 'Pasajero', w: 34 }, { t: 'Documento', w: 26 }, { t: 'Número', w: 20 }, { t: 'Vence', w: 20 }])}
${filasV.join('\n')}
</table></td></tr>`);
  }

  // Sección 2: Check-ins por hacer
  if (checkins.length) {
    const n = checkins.length;
    const filasC = checkins.map(c => {
      const t = parseFechaART(c.fecha);
      const ruta = c.ruta ? escHtml(String(c.ruta)).replace(/-/g, '&rarr;') : '';
      const pax = escHtml(c.pax) + (c.paxCount > 1 ? ` <span class="td-plus" style="color:${GRIS_TEXTO};">+${c.paxCount - 1}</span>` : '');
      return filaDatos(
        tdDatos(34, pax, 'word-break:break-word;line-height:1.5;')
        + `<td width="26%" class="td-cell" style="padding:14px 0;${SANS}">
<span class="td-flight" style="font-size:16px;font-weight:bold;color:${TINTA};font-family:Georgia,serif;">${escHtml(c.vuelo)}</span><span class="td-sub" style="font-size:12px;color:${GRIS_TEXTO};${SANS}">&middot; ${ruta}</span>
</td>`
        + tdDatos(20, t == null ? escHtml(c.fecha) : fmtDiaHora(t))
        + tdDatos(20, mlabel('Ref') + escHtml(c.ref || ''), `${MONO}font-weight:bold;letter-spacing:0.06em;`)
      );
    });
    filas.push(`<tr><td class="td-sec" style="padding-top:44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${encabezadoSeccion('Check-ins por hacer', `${n} vuelo${n === 1 ? '' : 's'}`)}
${filaEncabezado([{ t: 'Pasajeros', w: 34 }, { t: 'Vuelo / Ruta', w: 26 }, { t: 'Fecha', w: 20 }, { t: 'Ref', w: 20 }])}
${filasC.join('\n')}
</table></td></tr>`);
  }

  // Sección: verificar requisitos (un mes antes del primer vuelo)
  if (requisitos.length) {
    const n = requisitos.length;
    const filasR = requisitos.map(c => {
      const t = parseFechaART(c.fecha);
      const ruta = c.ruta ? escHtml(String(c.ruta)).replace(/->/g, '&rarr;').replace(/-/g, '&rarr;') : '';
      return filaDatos(
        tdDatos(46, escHtml(c.name), 'line-height:1.5;word-break:break-word;')
        + tdDatos(32, mlabel('Ruta') + ruta)
        + tdDatos(22, t == null ? escHtml(c.fecha) : fmtDiaHora(t))
      );
    });
    filas.push(`<tr><td class="td-sec" style="padding-top:44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${encabezadoSeccion('Verificar requisitos migratorios y sanitarios', `${n} viaje${n === 1 ? '' : 's'}`)}
${filaEncabezado([{ t: 'Pasajero', w: 46 }, { t: 'Ruta', w: 32 }, { t: 'Fecha', w: 22 }])}
${filasR.join('\n')}
</table></td></tr>`);
  }

  // Sección 3: Cumpleaños de hoy (nombre a la izquierda, nacimiento a la derecha;
  // en mobile se apilan)
  if (cumpleanos.length) {
    const filasB = cumpleanos.map(c => `<tr><td class="td-bbot" style="padding:14px 0;border-bottom:1px solid ${BORDE_SUAVE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td class="td-td td-cell" style="font-size:14px;color:${TINTA};word-break:break-word;${SANS}">${escHtml(c.name)}</td>
<td align="right" class="td-right td-cell" style="padding-left:16px;white-space:nowrap;"><span class="td-sub" style="font-size:13px;color:${GRIS_TEXTO};${SANS}">n. ${escHtml(fmtDiaStr(c.dob))}</span></td>
</tr></table></td></tr>`);
    filas.push(`<tr><td class="td-sec" style="padding-top:44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${encabezadoSeccion('Cumpleaños de hoy', '')}
<tr><td class="td-btop" style="border-top:1px solid ${TINTA};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filasB.join('\n')}</table>
</td></tr>
</table></td></tr>`);
  }

  const html = marcoEmail({ appName, now, filas });

  return { subject, html };
}
