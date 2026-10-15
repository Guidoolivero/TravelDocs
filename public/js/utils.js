// ============================================================
//  utils.js — Fechas, formatos, helpers compartidos
// ============================================================

// Helpers de alertas compartidos con el server (leaf, sin imports):
// netlify/functions/send-alerts.cjs los requiere desde alert-core.mjs.
import { getPassengerVisas, visaAlertLabel, collectEmailAlertCandidates, ASISTENCIA_ALERT_DAYS } from './alert-core.mjs';
export { getPassengerVisas, visaAlertLabel, collectEmailAlertCandidates, ASISTENCIA_ALERT_DAYS };

export function today() { return new Date(); }

export function parseDate(s) {
  if (!s) return null;
  return new Date(s + 'T00:00:00');
}

export function daysUntil(s) {
  const d = parseDate(s);
  if (!d) return null;
  return Math.floor((d - today()) / 86400000);
}

// 17ENE1971
export function fmtDate(s) {
  if (!s) return '—';
  const d = parseDate(s);
  if (!d) return '—';
  const months = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  return d.getDate().toString().padStart(2,'0') + months[d.getMonth()] + d.getFullYear();
}

// 17JAN71 (formato GDS)
export function fmtDateGDS(s) {
  if (!s) return '';
  const d = parseDate(s);
  if (!d) return '';
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return d.getDate().toString().padStart(2,'0') + months[d.getMonth()] + d.getFullYear().toString().substring(2);
}

// 17 ene. 1971
export function fmtDateFull(s) {
  if (!s) return '—';
  const d = parseDate(s);
  if (!d) return '—';
  return d.toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'numeric' });
}

export function docStatus(expDate) {
  const days = daysUntil(expDate);
  if (days === null) return 'nodata';
  if (days < 0) return 'expired';
  if (days <= 30) return 'critical';
  if (days <= 90) return 'warning';
  return 'ok';
}

export function statusBadge(expDate, label) {
  const s = docStatus(expDate);
  const days = daysUntil(expDate);
  if (s === 'nodata') return `<span class="badge badge-gray">${label || 'Sin datos'}</span>`;
  if (s === 'expired') return `<span class="badge badge-red pulse">Vencido hace ${Math.abs(days)}d</span>`;
  if (s === 'critical') return `<span class="badge badge-red pulse">Vence en ${days}d</span>`;
  if (s === 'warning') return `<span class="badge badge-amber">Vence en ${days}d</span>`;
  return `<span class="badge badge-green">Vigente</span>`;
}

// Asistencias al viajero: la ventana de aviso (30 días) vive en alert-core.mjs.

// Estado de una asistencia al viajero con la ventana reducida a 30 días:
// solo marca critical/expired (sin warning a 90 como los demás documentos).
export function asistenciaStatus(expDate) {
  const days = daysUntil(expDate);
  if (days === null) return 'nodata';
  if (days < 0) return 'expired';
  if (days <= ASISTENCIA_ALERT_DAYS) return 'critical';
  return 'ok';
}

// Badge de estado de una asistencia (mismo look que statusBadge pero con
// la ventana de 30 días).
export function asistenciaBadge(expDate, label) {
  const s = asistenciaStatus(expDate);
  const days = daysUntil(expDate);
  if (s === 'nodata') return `<span class="badge badge-gray">${label || 'Sin datos'}</span>`;
  if (s === 'expired') return `<span class="badge badge-red pulse">Vencido hace ${Math.abs(days)}d</span>`;
  if (s === 'critical') return `<span class="badge badge-red pulse">Vence en ${days}d</span>`;
  return `<span class="badge badge-green">Vigente</span>`;
}

export function collectDocumentAlertItems(passengers, isDismissed = () => false) {
  const items = [];
  passengers.forEach(p => {
    const name = `${p.lastname}, ${p.firstname}`;
    const email = p.email || '';
    // alertDays: ventana custom de aviso (ej. asistencias = 30 días).
    // Si está definida, solo alerta dentro de esa ventana (+ vencidos).
    const addItem = (docType, docNum, expDate, is6Month, alertDays) => {
      const days = daysUntil(expDate);
      if (days === null) return;
      if (alertDays != null && days > alertDays) return;
      let urgency = null;
      if (days < 0)        urgency = 1;
      else if (days <= 30) urgency = 2;
      else if (days <= 90) urgency = 3;
      else if (is6Month && days <= 180) urgency = 4;
      if (!urgency) return;
      const dismissKey = `dismissed_${p.id}_${docType}_${expDate}`;
      if (isDismissed(dismissKey)) return;
      items.push({ pid: p.id, name, email, docType, docNum: docNum || '—', expDate, days, urgency, dismissKey });
    };
    if (p.dni?.exp) addItem(p.dni.country && p.dni.country !== 'ARG' ? `DNI ${p.dni.country}` : 'DNI', p.dni.num, p.dni.exp, true);
    if (p.parg?.exp) addItem('Pasaporte ARG', p.parg.num, p.parg.exp, true);
    if (p.pext?.exp && p.pext?.country) addItem(`Pas. ${p.pext.country}`, p.pext.num, p.pext.exp, true);
    getPassengerVisas(p).forEach(v => addItem(visaAlertLabel(v), v.num, v.exp, false));
    p.asistencias?.forEach(a => {
      if (a.fin && parseInt(a.duracion || '0') >= 30) {
        addItem('Asistencia al Viajero', a.num, a.fin, false, ASISTENCIA_ALERT_DAYS);
      }
    });
  });
  return items.sort((a, b) => a.days - b.days);
}

export function passengerOverallStatus(p) {
  const visas = Array.isArray(p.visas) && p.visas.length ? p.visas : [p.visa1, p.visa2];
  const visaExps = visas.filter(v => v?.exp && (v?.country || v?.num)).map(v => v.exp);
  const asistenciaExps = (p.asistencias || [])
    .filter(a => a.fin && parseInt(a.duracion || '0') >= 30)
    .map(a => a.fin);
  const docExps = [p.dni?.exp, p.parg?.exp, p.pext?.exp, ...visaExps].filter(Boolean);
  const statuses = [
    ...docExps.map(docStatus),
    ...asistenciaExps.map(asistenciaStatus)
  ];
  if (!statuses.length) return 'nodata';
  if (statuses.includes('expired')) return 'expired';
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('warning')) return 'warning';
  return 'ok';
}

export function initials(p) {
  return ((p.lastname?.[0] || '') + (p.firstname?.[0] || '')).toUpperCase();
}

export function escStr(s) {
  // Escapa para uso seguro en atributos HTML inline onclick="copyText(this,'...')"
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\\/g, '&#92;');
}

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
