import { estado } from '../compartido/estado.mjs';
import { statusBadge, fmtDate, daysUntil, escStr, getPassengerVisas, visaAlertLabel, asistenciaBadge } from '../compartido/utils.js';
import { esc } from '../compartido/ui.mjs';

let currentDocFilter = 'all';

function renderDocuments() {
  let rows = [];
  estado.passengers.forEach(p => {
    const name = `${p.lastname}, ${p.firstname}`;
    if (p.dni?.num) rows.push({ pid:p.id, name, type:'dni', country:p.dni.country || 'ARG', num:p.dni.num, issue:p.dni.issue, exp:p.dni.exp });
    if (p.parg?.num) rows.push({ pid:p.id, name, type:'passport_arg', country:'ARG', num:p.parg.num, issue:p.parg.issue, exp:p.parg.exp });
    if (p.pext?.country && p.pext?.num) rows.push({ pid:p.id, name, type:'passport_ext', country:p.pext.country, num:p.pext.num, issue:p.pext.issue, exp:p.pext.exp });
    getPassengerVisas(p).forEach(v => {
      rows.push({
        pid: p.id, name,
        type: 'visa',
        displayType: visaAlertLabel(v),
        country: v.country,
        num: v.num,
        issue: v.issue,
        exp: v.exp
      });
    });
    if (Array.isArray(p.asistencias)) {
      p.asistencias.forEach(a => {
        if (a.num || a.fin) rows.push({
          pid:p.id, name,
          type:'asistencia',
          country: a.compania || '—',
          num:a.num,
          issue:a.inicio,
          exp:a.fin,
          producto: a.producto || '',
          cobertura: a.cobertura || ''
        });
      });
    }
  });

  if (currentDocFilter !== 'all') rows = rows.filter(r => r.type === currentDocFilter);
  rows.sort((a,b) => { const da = daysUntil(a.exp) ?? 9999, db = daysUntil(b.exp) ?? 9999; return da - db; });

  const typeLabels = { dni:'DNI', passport_arg:'Pasaporte ARG', passport_ext:'Pas. Extranjero', visa:'Visa', asistencia:'Asistencia Médica' };

  if (!rows.length) {
    document.getElementById('documents-tbody').innerHTML =
      `<tr><td colspan="7"><div class="empty-state"><div class="empty-title">Sin documentos</div></div></td></tr>`;
    return;
  }

  let html = '';
  rows.forEach(r => {
    if (r.type === 'asistencia') {
      html += `<tr style="cursor:pointer;" tabindex="0" role="button" data-open-detail="${escStr(r.pid)}">
        <td><span style="font-weight:500;">${esc(r.name)}</span></td>
        <td><span class="badge badge-gray">${typeLabels[r.type]}</span></td>
        <td><span class="chip">${esc(r.country)}</span></td>
        <td><span class="doc-num">${esc(r.num || '—')}</span>${r.producto ? `<br><small>${esc(r.producto)}</small>` : ''}${r.cobertura ? `<br><small>${esc(r.cobertura)}</small>` : ''}</td>
        <td style="font-size:12px;color:var(--text2);">${fmtDate(r.issue)}</td>
        <td style="font-size:12px;">${fmtDate(r.exp)}</td>
        <td>${asistenciaBadge(r.exp)}</td>
      </tr>`;
    } else {
      html += `<tr style="cursor:pointer;" tabindex="0" role="button" data-open-detail="${escStr(r.pid)}">
        <td><span style="font-weight:500;">${esc(r.name)}</span></td>
        <td><span class="badge badge-gray">${esc(r.displayType || typeLabels[r.type])}</span></td>
        <td><span class="chip">${esc(r.country)}</span></td>
        <td><span class="doc-num">${esc(r.num || '—')}</span></td>
        <td style="font-size:12px;color:var(--text2);">${fmtDate(r.issue)}</td>
        <td style="font-size:12px;">${fmtDate(r.exp)}</td>
        <td>${statusBadge(r.exp)}</td>
      </tr>`;
    }
  });
  document.getElementById('documents-tbody').innerHTML = html;
}
export function initDocumentos() {
  document.querySelectorAll('#doc-tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => window.setDocFilter(btn.dataset.docFilter, btn));
  });

  // ==================== DOCUMENTOS ====================
  window.setDocFilter = function(f, btn) {
    currentDocFilter = f;
    document.querySelectorAll('#doc-tabs .tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    renderDocuments();
  };
}

export { renderDocuments };
