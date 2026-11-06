import { estado } from '../compartido/estado.mjs';
import { statusBadge, passengerOverallStatus, fmtDate, initials, escStr } from '../compartido/utils.js';
import { esc } from '../compartido/ui.mjs';
import { birthdayBadge, getAlertItems } from '../alertas/modelo.mjs';
import { resCompanias, upcomingCheckins, viajesRequisitos, fmtResDate, resPaxSurnames } from '../reservas/pantalla.mjs';


// ==================== DASHBOARD ====================
function renderDashboard() {
  const statusCache = new Map(estado.passengers.map(p => [p.id, passengerOverallStatus(p)]));
  const expired = estado.passengers.filter(p => ['expired','critical'].includes(statusCache.get(p.id)));
  const warning = estado.passengers.filter(p => statusCache.get(p.id) === 'warning');
  const ok = estado.passengers.filter(p => statusCache.get(p.id) === 'ok');

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card info"><div class="stat-label">Total pasajeros</div><div class="stat-value">${estado.passengers.length}</div><div class="stat-sub">en base de datos</div></div>
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

  const recent = estado.passengers.slice(0, 5);
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
export { renderDashboard };
