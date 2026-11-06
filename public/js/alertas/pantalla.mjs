import { setDismissed, birthdayBadge, getAlertItems } from './modelo.mjs';
import { estado } from '../compartido/estado.mjs';
import { statusBadge, fmtDate, escStr } from '../compartido/utils.js';
import { esc, showConfirmDialog } from '../compartido/ui.mjs';
import { renderDashboard } from '../dashboard/pantalla.mjs';
import { viajesRequisitos, fmtResDate } from '../reservas/pantalla.mjs';
const estadoAlertas = {
  _alertsCritOpen: false,
  _alertsWarnOpen: false,
  _alertsReqOpen: false,
  _alertsSixOpen: false,
  _alertsBdOpen: false
};


// ==================== ALERTAS ====================

// Días hasta el próximo cumpleaños (ignora el año de nacimiento)


// Dismiss de alertas: per-usuario via localStorage (cada agente maneja su propio estado)


// Badge visual para cumpleaños


function dismissAlert(key) {
  setDismissed(key);
  renderAlerts();
  updateAlertBadge();
  renderDashboard();
}


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
${a.email ? `<a href="mailto:${escStr(a.email)}?subject=${encodeURIComponent(a.isBirthday ? '¡Feliz Cumpleaños!' : 'Renovación de ' + a.docType)}&body=${encodeURIComponent(a.isBirthday ? 'Estimado/a ' + a.name + ',\n\n¡Desde ' + estado.appName + ' le deseamos un muy feliz cumpleaños!\n\nSaludos,\n' + estado.appName : 'Estimado/a ' + a.name + ',\n\nSu ' + a.docType + ' (N° ' + a.docNum + ') vence el ' + fmtDate(a.expDate) + '. Le pedimos que coordine la renovación con anticipación.\n\nSaludos,\n' + estado.appName)}" data-no-row-action="true" title="${a.isBirthday ? 'Enviar saludo de cumpleaños' : 'Enviar mail al pasajero'}" style="color:var(--accent);display:flex;align-items:center;padding:4px;border-radius:6px;flex-shrink:0;">
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
    ? listaCorta(critical, estadoAlertas._alertsCritOpen, 'crit', renderItem) : emptyMsg('✓ Sin alertas críticas');
  document.getElementById('alerts-warning').innerHTML = warning.length
    ? listaCorta(warning, estadoAlertas._alertsWarnOpen, 'warn', renderItem) : emptyMsg('✓ Sin documentos por vencer');

  // Sección 6 meses (DNI y Pasaporte): primeras 5, el resto detrás de Ver todos.
  const wrap6 = document.getElementById('alerts-6months');
  if (wrap6) {
    wrap6.innerHTML = sixMonth.length
      ? listaCorta(sixMonth, estadoAlertas._alertsSixOpen, 'six', renderItem)
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
      ? listaCorta(reqs, estadoAlertas._alertsReqOpen, 'req', filaReq)
      : emptyMsg('✓ Sin viajes para verificar');
  }

  // Sección cumpleaños: primeras 5, el resto detrás de Ver todos.
  const wrapBd = document.getElementById('alerts-birthdays');
  if (wrapBd) {
    const birthdays = items.filter(a => a.isBirthday);
    wrapBd.innerHTML = birthdays.length
      ? listaCorta(birthdays, estadoAlertas._alertsBdOpen, 'bd', renderItem)
      : emptyMsg('✓ Sin cumpleaños en los próximos 30 días');
  }
}

function updateAlertBadge() {
  const count = getAlertItems().filter(a => a.urgency <= 2).length;
  const badge = document.getElementById('alert-badge');
  if (count > 0) { badge.textContent = count; badge.style.display = 'inline-flex'; }
  else { badge.style.display = 'none'; }
}
export function initAlertas() {
  document.addEventListener('click', e => {
    const more = e.target.closest('[data-alerts-more]');
    if (!more) return;
    if (more.dataset.alertsMore === 'crit') estadoAlertas._alertsCritOpen = !estadoAlertas._alertsCritOpen;
    if (more.dataset.alertsMore === 'warn') estadoAlertas._alertsWarnOpen = !estadoAlertas._alertsWarnOpen;
    if (more.dataset.alertsMore === 'req') estadoAlertas._alertsReqOpen = !estadoAlertas._alertsReqOpen;
    if (more.dataset.alertsMore === 'six') estadoAlertas._alertsSixOpen = !estadoAlertas._alertsSixOpen;
    if (more.dataset.alertsMore === 'bd') estadoAlertas._alertsBdOpen = !estadoAlertas._alertsBdOpen;
    renderAlerts();
  });

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
}

export { estadoAlertas, renderAlerts, updateAlertBadge };
