import { estado } from './estado.mjs';
import { multiFactor } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { esc, showToast } from './ui.mjs';
import { escStr } from './utils.js';
import { auth } from './firebase.mjs';


// ==================== SEGURIDAD (2FA) ====================

// Helper: obtiene un ID token fresco para llamar a las Functions de MFA.
async function _mfaIdToken() {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesión expirada.');
  return await user.getIdToken();
}

function _mfaFnUrl(path) {
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://localhost:8888/.netlify/functions/${path}`
    : `/.netlify/functions/${path}`;
}
export { _mfaIdToken, _mfaFnUrl };

export function initSeguridad() {
  window.renderSecurity = function() {
    const selfEl = document.getElementById('security-self-status');
    const adminBlock = document.getElementById('security-admin-block');
    if (selfEl) {
      const enrolled = auth.currentUser ? multiFactor(auth.currentUser).enrolledFactors.length > 0 : false;
      selfEl.innerHTML = enrolled
        ? `<span class="badge badge-green">2FA activo</span> Tu cuenta usa Google Authenticator.`
        : `<span class="badge badge-red">2FA pendiente</span> Activá el autenticador (cerrá sesión y volvé a ingresar).`;
    }
    // Solo owner/admin ven el bloque de gestión de miembros.
    const canManage = estado.currentUserRole === 'owner' || estado.currentUserRole === 'admin';
    if (adminBlock) adminBlock.style.display = canManage ? '' : 'none';
    if (canManage) window.loadSecurityMembers();
  };

  window.loadSecurityMembers = async function() {
    const list = document.getElementById('security-members-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:12px;">Cargando miembros…</div>';
    try {
      const idToken = await _mfaIdToken();
      const res = await fetch(_mfaFnUrl('mfa-admin') + '?members=1', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      const json = await res.json();
      if (!res.ok || json.error) { list.innerHTML = `<div style="padding:12px;color:var(--red);font-size:12px;">${esc(json.error || 'Error')}</div>`; return; }
      const members = json.members || [];
      if (!members.length) { list.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:12px;">Sin miembros.</div>'; return; }
      list.innerHTML = members.map(m => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--border);">
          <div>
            <div style="font-size:13px;">${esc(m.displayName || m.email || m.uid)}</div>
            <div style="font-size:11px;color:var(--text3);">${esc(m.email || '')} · ${esc(m.role || '')}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="badge badge-${m.mfaEnrolled ? 'green' : 'red'}">${m.mfaEnrolled ? '2FA activo' : 'pendiente'}</span>
            <button class="btn btn-ghost btn-sm" data-mfa-reset="${escStr(m.uid)}" data-no-row-action="true">Resetear</button>
          </div>
        </div>`).join('');
    } catch (err) {
      console.error('Error cargando miembros 2FA:', err);
      list.innerHTML = '<div style="padding:12px;color:var(--red);font-size:12px;">No se pudo cargar.</div>';
    }
  };

  // Click delegado: resetear 2FA de un miembro.
  document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-mfa-reset]');
    if (!btn) return;
    const targetUid = btn.dataset.mfaReset;
    const recoveryCode = prompt(`Ingresá un código de recuperación del miembro (otorgado por él):`);
    if (!recoveryCode) return;
    btn.disabled = true; btn.textContent = 'Reseteando…';
    try {
      const idToken = await _mfaIdToken();
      const res = await fetch(_mfaFnUrl('mfa-admin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'reset', targetUid, recoveryCode })
      });
      const json = await res.json();
      if (!res.ok || json.error) { showToast(json.error || 'No se pudo resetear.', true); btn.disabled = false; btn.textContent = 'Resetear'; return; }
      showToast('2FA reseteado. El miembro debe re-configurar su autenticador.');
      window.loadSecurityMembers();
    } catch (err) {
      console.error('Error reseteando 2FA:', err);
      showToast('No se pudo resetear.', true);
      btn.disabled = false; btn.textContent = 'Resetear';
    }
  });

  document.getElementById('btn-security-refresh')?.addEventListener('click', () => window.loadSecurityMembers());
}
