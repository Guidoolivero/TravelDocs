import { adminFetch } from './api.mjs';
import { parsePrice, SALE_CONDITIONS } from '../facturacion/billing-form.mjs';
import { signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { emailjsParaAlta } from '../tenant.js';
import { fmtDate, escStr } from '../compartido/utils.js';
import { generarContrasena } from '../compartido/contrasena.mjs';
import { loadScanner } from '../compartido/cargas.mjs';
import { auth } from '../compartido/firebase.mjs';
import { esc, showConfirmDialog, showToast } from '../compartido/ui.mjs';
import { _mfaIdToken, _mfaFnUrl } from '../compartido/seguridad.mjs';
import { loadBillingInvoices, billingStatusLabel } from '../facturacion/pantalla.mjs';


// ============================================================
//  ADMINISTRACIÓN (super-admin) — Fase 1
//  Llama a /.netlify/functions/admin-api (ver _platform-admin.cjs).
// ============================================================

let _adminTab = 'agencies';
let _adminAgencies = [];
let _adminBillingEnabled = false;
let _adminBillingEnvironment = 'test';
let _adminMembers = [];
let _adminUsersFilter = '';


// Fetch autenticado contra admin-api. Lanza {status, error} si no es ok.


function setAdminTab(tab) {
  _adminTab = tab;
  document.querySelectorAll('.admin-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.adminTab === tab)
  );
  document.getElementById('admin-panel-agencies').style.display = tab === 'agencies' ? '' : 'none';
  document.getElementById('admin-panel-users').style.display = tab === 'users' ? '' : 'none';
  document.getElementById('admin-panel-usage').style.display = tab === 'usage' ? '' : 'none';
  document.getElementById('admin-panel-billing').style.display = tab === 'billing' ? '' : 'none';
  if (tab === 'agencies' || tab === 'billing') loadAgencies();
  else if (tab === 'users') loadUsersPanel();
  else if (tab === 'usage') initUsagePanel();
}

// ── Agencias ──────────────────────────────────────────────
async function loadAgencies() {
  const tbody = document.getElementById('admin-agencies-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--text3);">Cargando...</td></tr>`;
  const billingBody = document.getElementById('admin-billing-agencies-tbody');
  billingBody.innerHTML = '<tr><td colspan="4">Cargando agencias...</td></tr>';
  try {
    const json = await adminFetch('/agencies');
    _adminAgencies = json.agencies || [];
    _adminBillingEnabled = json.billingEnabled === true;
    _adminBillingEnvironment = json.billingEnvironment === 'production' ? 'production' : 'test';
    document.getElementById('admin-billing-title').textContent = _adminBillingEnvironment === 'production' ? 'Facturas reales' : 'Facturas de homologacion';
    document.getElementById('admin-billing-environment').textContent = _adminBillingEnvironment === 'production' ? 'Produccion: los comprobantes emitidos tienen validez fiscal.' : 'Comprobantes de prueba, sin valor fiscal.';
    document.getElementById('admin-billing-fields').hidden = !_adminBillingEnabled;
    document.querySelector('[data-admin-tab="billing"]').hidden = !_adminBillingEnabled;
    document.getElementById('admin-billing-history').hidden = !_adminBillingEnabled;
    if (_adminBillingEnabled) {
      document.getElementById('admin-billing-agencies-tbody').innerHTML = _adminAgencies.map(a => `<tr>
        <td>${esc(a.name || a.id)}</td><td>${esc(billingStatusLabel(a.billingStatus))}</td>
        <td><select class="billing-sale-condition" aria-label="Condicion de venta de ${esc(a.name || a.id)}" data-billing-condition="${esc(a.id)}">${SALE_CONDITIONS.map(value => `<option${value === (a.billing.saleCondition || SALE_CONDITIONS[0]) ? ' selected' : ''}>${esc(value)}</option>`).join('')}</select></td>
        <td>${a.billingStatus.state === 'ready' ? `<button class="btn btn-ghost btn-sm" data-billing-preview="${esc(a.id)}">Vista previa</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="4">Sin agencias.</td></tr>';
      if (_adminTab === 'billing') loadBillingInvoices();
    }
    renderAgenciesTable();
    populateAgencySelects();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--red);">${esc(err.error || 'Error al cargar agencias.')}</td></tr>`;
    billingBody.innerHTML = `<tr><td colspan="4">${esc(err.error || 'Error al cargar agencias.')}</td></tr>`;
  }
}

function renderAgenciesTable() {
  const tbody = document.getElementById('admin-agencies-tbody');
  if (!tbody) return;
  if (!_adminAgencies.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--text3);">Sin agencias.</td></tr>`;
    return;
  }
  tbody.innerHTML = _adminAgencies.map(a => `
    <tr>
      <td style="font-weight:500;">${esc(a.name || a.id)}</td>
      <td style="font-family:var(--mono);font-size:12px;">${esc(a.slug || a.id)}</td>
      <td>${planBadge(a.plan)}</td>
      <td>${statusBadgeAdmin(a.status)}${a.billingStatus ? `<br><small>${esc(billingStatusLabel(a.billingStatus))}</small>` : ''}</td>
      <td>${a.memberCount ?? 0}</td>
      <td style="font-size:12px;white-space:nowrap;">${fmtDate(a.createdAt)}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-ghost btn-sm" data-agency-edit="${esc(a.id)}">Editar</button>
        ${a.status === 'suspended'
          ? `<button class="btn btn-ghost btn-sm" data-agency-activate="${esc(a.id)}">Reactivar</button>`
          : `<button class="btn btn-ghost btn-sm" data-agency-suspend="${esc(a.id)}">Suspender</button>`}
        <button class="btn btn-ghost btn-sm" data-agency-delete="${esc(a.id)}" style="color:var(--red);">Eliminar</button>
      </td>
    </tr>`).join('');
}

function populateAgencySelects() {
  const active = _adminAgencies.filter(a => a.status !== 'suspended');
  const opts = (list, all) =>
    (all ? `<option value="">Todas</option>` : '') +
    list.map(a => `<option value="${esc(a.id)}">${esc(a.name || a.id)}</option>`).join('');

  const usAgency = document.getElementById('admin-us-agency');
  const filter = document.getElementById('admin-us-filter-agency');
  if (usAgency) {
    const prev = usAgency.value;
    usAgency.innerHTML = opts(active, false);
    if (prev) usAgency.value = prev;
  }
  if (filter) {
    const prev = _adminUsersFilter;
    filter.innerHTML = opts(_adminAgencies, true);
    const valid = [...filter.options].some(o => o.value === prev);
    filter.value = valid ? prev : '';
    _adminUsersFilter = filter.value;
  }
}

function openEditAgency(agencyId) {
  const a = _adminAgencies.find(x => x.id === agencyId);
  if (!a) return;
  // Necesitamos los campos completos (branding/alerts) que no vienen en el listado.
  // Los pedimos al backend solo si faltan; si no hay, abrimos igual con lo que hay.
  fillAgencyForm({
    id: a.id,
    name: a.name || '',
    slug: a.slug || a.id,
    plan: a.plan,
    status: a.status,
    branding: a.branding || {},
    alerts: a.alerts || {},
    billing: a.billing || {}
  });
}

// Estado del logo de la agencia en edición: '' = sin logo, data URL o path = logo cargado.
let adminLogoDataUrl = '';

// Muestra/oculta la vista previa del logo y el botón "Quitar logo" según haya o no valor.
function setAgencyLogoPreview(value) {
  const img = document.getElementById('admin-ag-logo-preview');
  const removeBtn = document.getElementById('admin-ag-logo-remove');
  if (!img || !removeBtn) return;
  if (value) {
    img.src = value;
    img.style.display = '';
    removeBtn.style.display = '';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    removeBtn.style.display = 'none';
  }
}

// Handler del input file: procesa la imagen elegida a data URL y actualiza preview/estado.
async function handleAgencyLogoChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const { prepareLogoDataUrl } = await loadScanner();
    const dataUrl = await prepareLogoDataUrl(file);
    adminLogoDataUrl = dataUrl;
    setAgencyLogoPreview(dataUrl);
  } catch (err) {
    showToast(err.message || 'No se pudo procesar el logo.', true);
  }
}

function fillAgencyForm(a) {
  document.getElementById('admin-billing-fields').open = false;
  document.getElementById('admin-bill-saleCondition').value = a.billing?.saleCondition || SALE_CONDITIONS[0];
  for (const key of ['taxId', 'legalName', 'address', 'condition', 'currency']) {
    document.getElementById('admin-bill-' + key).value = a.billing?.[key] || '';
  }
  document.getElementById('admin-bill-amount').value = a.billing?.amount ? (a.billing.amount / 100).toFixed(2) : '';
  document.getElementById('admin-agency-edit-id').value = a.id || '';
  document.getElementById('admin-ag-name').value = a.name || '';
  document.getElementById('admin-ag-slug').value = a.slug || '';
  document.getElementById('admin-ag-slug').disabled = !!a.id;
  document.getElementById('admin-ag-plan').value = a.plan || 'trial';
  document.getElementById('admin-ag-status').value = a.status || 'active';
  document.getElementById('admin-ag-alerts-email').value = a.alerts?.email || '';
  document.getElementById('admin-ag-app-name').value = a.branding?.appName || '';
  document.getElementById('admin-ag-color').value = a.branding?.primaryColor || '#1a3a5c';
  // Logo: se gestiona como data URL (upload) o path existente. Mostramos preview y reseteamos el input.
  adminLogoDataUrl = a.branding?.logoUrl || '';
  setAgencyLogoPreview(adminLogoDataUrl);
  const logoFileInput = document.getElementById('admin-ag-logo-file');
  if (logoFileInput) logoFileInput.value = '';
  const emailjs = emailjsParaAlta(a.alerts);
  document.getElementById('admin-ag-emailjs-pk').value = emailjs.emailjsPublicKey;
  document.getElementById('admin-ag-emailjs-svc').value = emailjs.emailjsServiceId;
  document.getElementById('admin-ag-emailjs-tpl').value = emailjs.emailjsTemplateId;
  document.getElementById('admin-agency-form-title').textContent = a.id ? 'Editar agencia' : 'Nueva agencia';
  document.getElementById('admin-ag-save').textContent = a.id ? 'Guardar cambios' : 'Crear agencia';
  document.getElementById('admin-ag-cancel').style.display = a.id ? '' : 'none';
}

function clearAgencyForm() {
  fillAgencyForm({});
}

async function submitAgencyForm() {
  const editId = document.getElementById('admin-agency-edit-id').value;
  const payload = {
    name: document.getElementById('admin-ag-name').value.trim(),
    slug: document.getElementById('admin-ag-slug').value.trim().toLowerCase(),
    plan: document.getElementById('admin-ag-plan').value,
    status: document.getElementById('admin-ag-status').value,
    branding: {
      appName: document.getElementById('admin-ag-app-name').value.trim(),
      logoUrl: adminLogoDataUrl,
      primaryColor: document.getElementById('admin-ag-color').value
    },
    alerts: {
      email: document.getElementById('admin-ag-alerts-email').value.trim(),
      emailjsPublicKey: document.getElementById('admin-ag-emailjs-pk').value.trim(),
      emailjsServiceId: document.getElementById('admin-ag-emailjs-svc').value.trim(),
      emailjsTemplateId: document.getElementById('admin-ag-emailjs-tpl').value.trim()
    }
  };

  if (_adminBillingEnabled) {
    payload.billing = { saleCondition: document.getElementById('admin-bill-saleCondition').value };
    for (const key of ['taxId', 'legalName', 'address', 'condition', 'currency']) payload.billing[key] = document.getElementById('admin-bill-' + key).value.trim();
    try {
      const amount = document.getElementById('admin-bill-amount').value.trim();
      payload.billing.amount = amount ? parsePrice(amount) : null;
    } catch (err) { return showToast(err.message, true); }
  }

  if (!payload.name) return showToast('Falta el nombre comercial.', true);
  if (!editId) {
    if (!payload.slug) return showToast('Falta el slug.', true);
    if (!/^[a-z0-9-]{3,40}$/.test(payload.slug)) {
      return showToast('Slug inválido: 3-40 chars, solo a-z, 0-9 y guiones.', true);
    }
  }
  if (payload.alerts.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.alerts.email)) {
    return showToast('El email de alertas no es válido.', true);
  }

  const btn = document.getElementById('admin-ag-save');
  const label = editId ? 'Guardar cambios' : 'Crear agencia';
  btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>Guardando...';
  try {
    if (editId) {
      delete payload.slug; // el slug no se edita
      await adminFetch('/agencies/' + encodeURIComponent(editId), { method: 'PATCH', body: JSON.stringify(payload) });
      showToast('Cambios guardados.');
    } else {
      await adminFetch('/agencies', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Agencia creada.');
    }
    clearAgencyForm();
    await loadAgencies();
  } catch (err) {
    showToast(err.error || 'Error al guardar.', true);
  } finally {
    btn.disabled = false;
    // label según estado actual del form (clearAgencyForm pudo haberlo reseteado a "Crear agencia")
    const currentEdit = document.getElementById('admin-agency-edit-id').value;
    btn.textContent = currentEdit ? 'Guardar cambios' : 'Crear agencia';
  }
}

async function toggleAgencyStatus(agencyId, suspend) {
  const label = suspend ? 'suspender' : 'reactivar';
  showConfirmDialog({
    title: suspend ? '¿Suspender agencia?' : '¿Reactivar agencia?',
    message: `Se va a ${label} la agencia. ${suspend ? 'Sus usuarios no podrán iniciar sesión (las sesiones activas se cierran al refrescar token).' : ''}`,
    confirmLabel: suspend ? 'Suspender' : 'Reactivar',
    onConfirm: async () => {
      try {
        await adminFetch('/agencies/' + encodeURIComponent(agencyId), {
          method: 'PATCH',
          body: JSON.stringify({ status: suspend ? 'suspended' : 'active' })
        });
        showToast(suspend ? 'Agencia suspendida.' : 'Agencia reactivada.');
        await loadAgencies();
      } catch (err) {
        showToast(err.error || 'Error.', true);
      }
    }
  });
}

// ── Usuarios ──────────────────────────────────────────────
function loadUsersPanel() {
  populateAgencySelects();
  loadMembers(_adminUsersFilter);
}

async function loadMembers(agencyId) {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--text3);">Cargando...</td></tr>`;
  try {
    const json = agencyId
      ? await adminFetch('/agencies/' + encodeURIComponent(agencyId) + '/members')
      : await adminFetch('/users');
    _adminMembers = json.members || [];
    renderUsersTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--red);">${esc(err.error || 'Error al cargar usuarios.')}</td></tr>`;
  }
}

function renderUsersTable() {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  if (!_adminMembers.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:16px;color:var(--text3);">${_adminUsersFilter ? 'Sin usuarios en esta agencia.' : 'Sin usuarios.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = _adminMembers.map(m => `
    <tr>
      <td style="font-family:var(--mono);font-size:12px;">${esc(m.email)}</td>
      <td>${esc(m.displayName || '—')}</td>
      <td>${esc(m.agencyName || m.agencyId || '—')}</td>
      <td>
        <select class="admin-role-select" data-user-role="${esc(m.uid)}" style="font-size:12px;">
          ${['owner','admin','agent'].map(r => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </td>
      <td>${m.active ? '<span style="color:var(--green);font-weight:500;">Activo</span>' : '<span style="color:var(--red);font-weight:500;">Inactivo</span>'}</td>
      <td style="font-size:12px;white-space:nowrap;">${fmtDate(m.createdAt)}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-ghost btn-sm" data-user-edit="${esc(m.uid)}">Editar</button>
        ${m.active
          ? `<button class="btn btn-ghost btn-sm" data-user-deactivate="${esc(m.uid)}">Desactivar</button>`
          : `<button class="btn btn-ghost btn-sm" data-user-activate="${esc(m.uid)}">Reactivar</button>`}
        <button class="btn btn-ghost btn-sm" data-user-mfa-reset="${escStr(m.uid)}">Resetear 2FA</button>
        <button class="btn btn-ghost btn-sm" data-user-delete="${esc(m.uid)}" style="color:var(--red);">Eliminar</button>
      </td>
    </tr>`).join('');
}

function forceResetUserMfa(uid) {
  showConfirmDialog({
    title: 'Resetear autenticador',
    message: 'Se cerraran las sesiones del usuario y se invalidara su codigo de recuperacion. Debera ingresar con su contrasena y configurar un nuevo autenticador.',
    confirmLabel: 'Resetear 2FA',
    onConfirm: async () => {
      try {
        const idToken = await _mfaIdToken();
        const res = await fetch(_mfaFnUrl('mfa-admin'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ action: 'force-reset', targetUid: uid }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'No se pudo resetear el 2FA.');
        if (uid === auth.currentUser?.uid) {
          await signOut(auth);
          window.location.href = './login.html?reason=need2fa';
          return;
        }
        showToast('2FA reseteado. El usuario debe configurar un nuevo autenticador.');
      } catch (err) {
        showToast(err.message || 'No se pudo resetear el 2FA.', true);
      }
    },
  });
}

async function submitUserForm() {
  const payload = {
    email: document.getElementById('admin-us-email').value.trim().toLowerCase(),
    password: document.getElementById('admin-us-password').value,
    agencyId: document.getElementById('admin-us-agency').value,
    role: document.getElementById('admin-us-role').value,
    displayName: document.getElementById('admin-us-name').value.trim()
  };
  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return showToast('Email inválido.', true);
  if (!payload.agencyId) return showToast('Elegí una agencia.', true);
  if (payload.password && payload.password.length < 8) return showToast('La contraseña debe tener al menos 8 caracteres.', true);

  const btn = document.getElementById('admin-us-save');
  btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>Procesando...';
  try {
    const json = await adminFetch('/users', { method: 'POST', body: JSON.stringify(payload) });
    showToast(json.created ? 'Usuario creado.' : 'Usuario vinculado.');
    document.getElementById('admin-us-email').value = '';
    const passInput = document.getElementById('admin-us-password');
    passInput.value = '';
    passInput.type = 'password';
    const copyBtn = document.getElementById('admin-us-password-copy');
    if (copyBtn) copyBtn.hidden = true;
    document.getElementById('admin-us-name').value = '';
    await loadMembers(payload.agencyId);
  } catch (err) {
    showToast(err.error || 'Error al crear el usuario.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear / vincular usuario';
  }
}

async function setUserRole(uid, role) {
  try {
    await adminFetch('/users/' + encodeURIComponent(uid), { method: 'PATCH', body: JSON.stringify({ role }) });
    showToast('Rol actualizado.');
  } catch (err) {
    showToast(err.error || 'Error.', true);
    loadMembers(_adminUsersFilter);
  }
}

function toggleUserActive(uid, active) {
  // Reactivar es directo; desactivar pide confirmación (revoca la sesión activa).
  const run = async () => {
    try {
      await adminFetch('/users/' + encodeURIComponent(uid), { method: 'PATCH', body: JSON.stringify({ active }) });
      showToast(active ? 'Usuario reactivado.' : 'Usuario desactivado.');
      await loadMembers(_adminUsersFilter);
    } catch (err) {
      showToast(err.error || 'Error.', true);
    }
  };
  if (active) { run(); return; }
  showConfirmDialog({
    title: '¿Desactivar usuario?',
    message: 'El usuario no podrá iniciar sesión y se le revocará la sesión activa.',
    confirmLabel: 'Desactivar',
    onConfirm: run
  });
}

// ── Editar usuario (email / password / nombre / rol) ──────
function openEditUserModal(uid) {
  const m = _adminMembers.find(x => x.uid === uid);
  if (!m) return;
  document.getElementById('admin-edit-user-uid').value = m.uid;
  document.getElementById('admin-edit-user-email').value = m.email || '';
  document.getElementById('admin-edit-user-name').value = m.displayName || '';
  document.getElementById('admin-edit-user-role').value = m.role || 'agent';
  document.getElementById('admin-edit-user-password').value = '';
  openModal('modal-edit-user');
}

async function submitEditUser() {
  const uid = document.getElementById('admin-edit-user-uid').value;
  if (!uid) return;
  const payload = {
    email: document.getElementById('admin-edit-user-email').value.trim().toLowerCase(),
    displayName: document.getElementById('admin-edit-user-name').value.trim(),
    role: document.getElementById('admin-edit-user-role').value
  };
  const password = document.getElementById('admin-edit-user-password').value;
  if (password) payload.password = password;

  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return showToast('Email inválido.', true);
  }
  if (password && password.length < 8) {
    return showToast('La contraseña debe tener al menos 8 caracteres.', true);
  }

  const btn = document.getElementById('admin-edit-user-save');
  btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>Guardando...';
  try {
    await adminFetch('/users/' + encodeURIComponent(uid), { method: 'PATCH', body: JSON.stringify(payload) });
    showToast('Cambios guardados.');
    closeModal('modal-edit-user');
    await loadMembers(_adminUsersFilter);
  } catch (err) {
    showToast(err.error || 'Error al guardar.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  }
}

// ── Eliminar usuario (borrado definitivo) ─────────────────
function deleteUser(uid) {
  const m = _adminMembers.find(x => x.uid === uid);
  showConfirmDialog({
    title: '¿Eliminar usuario?',
    message: `Se va a eliminar definitivamente a ${m?.email || uid}. Se borra su cuenta de Auth, sus datos y deja de pertenecer a la agencia.`,
    subtext: 'Esta acción no se puede deshacer.',
    confirmLabel: 'Sí, eliminar',
    onConfirm: async () => {
      try {
        await adminFetch('/users/' + encodeURIComponent(uid), {
          method: 'DELETE',
          body: JSON.stringify({ confirm: true })
        });
        showToast('Usuario eliminado.');
        await loadMembers(_adminUsersFilter);
      } catch (err) {
        showToast(err.error || 'Error al eliminar.', true);
      }
    }
  });
}

// ── Eliminar agencia (confirmación con slug) ──────────────
function openDeleteAgencyModal(agencyId) {
  document.getElementById('admin-agency-delete-target').value = agencyId;
  const input = document.getElementById('admin-agency-delete-input');
  input.value = '';
  const btn = document.getElementById('admin-agency-delete-confirm');
  btn.disabled = true;
  btn.textContent = 'Eliminar agencia';
  openModal('modal-agency-delete');
  setTimeout(() => input.focus(), 50);
}

async function confirmDeleteAgency() {
  const agencyId = document.getElementById('admin-agency-delete-target').value;
  const confirmSlug = document.getElementById('admin-agency-delete-input').value.trim();
  if (confirmSlug !== agencyId) return;

  const btn = document.getElementById('admin-agency-delete-confirm');
  btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>Eliminando...';
  try {
    await adminFetch('/agencies/' + encodeURIComponent(agencyId), {
      method: 'DELETE',
      body: JSON.stringify({ confirmSlug })
    });
    showToast('Agencia eliminada.');
    closeModal('modal-agency-delete');
    clearAgencyForm();
    await loadAgencies();
  } catch (err) {
    showToast(err.error || 'Error al eliminar.', true);
    btn.disabled = false;
    btn.textContent = 'Eliminar agencia';
  }
}

// ── Badges ────────────────────────────────────────────────
function planBadge(plan) {
  const colors = { trial: 'var(--text3)', starter: '#2563eb', pro: 'var(--green)' };
  return `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:${colors[plan] || 'var(--text3)'}1a;color:${colors[plan] || 'var(--text3)'};">${esc(plan || 'trial')}</span>`;
}
function statusBadgeAdmin(status) {
  const ok = status !== 'suspended';
  return `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:${ok ? 'var(--green)' : 'var(--red)'}1a;color:${ok ? 'var(--green)' : 'var(--red)'};">${ok ? 'active' : 'suspended'}</span>`;
}

// ── Uso y gasto (reporte para cobro manual) ───────────────
// Lee agencies/{id}/usage/{YYYY-MM-DD} vía GET /usage de admin-api.
let _usageInited = false;

function usageDefaultMonth(now = new Date()) {
  // Mes actual en hora de Argentina (consistente con usageDayId de _usage.cjs).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit',
  }).formatToParts(now);
  const y = (parts.find(p => p.type === 'year') || {}).value;
  const m = (parts.find(p => p.type === 'month') || {}).value;
  return `${y}-${m}`;
}

function initUsagePanel() {
  if (!_usageInited) {
    const monthInput = document.getElementById('admin-usage-month');
    const rangeInput = document.getElementById('admin-usage-range');
    if (monthInput) {
      monthInput.value = usageDefaultMonth();
      monthInput.disabled = rangeInput?.value === 'historical';
    }
    document.getElementById('admin-usage-refresh')?.addEventListener('click', loadUsage);
    rangeInput?.addEventListener('change', () => {
      // Histórico no usa mes.
      if (monthInput) monthInput.disabled = rangeInput.value === 'historical';
      loadUsage();
    });
    monthInput?.addEventListener('change', loadUsage);
    _usageInited = true;
  }
  loadUsage();
}

async function loadUsage() {
  const tbody = document.getElementById('admin-usage-tbody');
  const totalsRow = document.getElementById('admin-usage-totals');
  const status = document.getElementById('admin-usage-status');
  const thKey = document.getElementById('admin-usage-th-key');
  if (!tbody) return;

  const range = document.getElementById('admin-usage-range').value || 'monthly';
  const hist = range === 'historical';
  const month = document.getElementById('admin-usage-month').value || usageDefaultMonth();
  thKey.textContent = (range === 'monthly' || range === 'historical') ? 'Agencia'
    : (range === 'daily' ? 'Día' : 'Semana');

  tbody.innerHTML = `<tr><td colspan="6" style="padding:16px;color:var(--text3);">Cargando...</td></tr>`;
  if (totalsRow) totalsRow.innerHTML = '';
  if (status) { status.style.display = 'none'; status.textContent = ''; }

  try {
    const qs = `?range=${encodeURIComponent(range)}${hist ? '' : `&month=${encodeURIComponent(month)}`}`;
    const json = await adminFetch(`/usage${qs}`);
    renderUsageTable(json, range);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:16px;color:var(--red);">${esc(err.error || 'Error al cargar el uso.')}</td></tr>`;
  }
}

function fmtUsd(v) {
  return Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function renderUsageTable(json, range) {
  const tbody = document.getElementById('admin-usage-tbody');
  const totalsRow = document.getElementById('admin-usage-totals');
  const rows = (json && json.rows) || [];
  const totals = (json && json.totals) || null;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:16px;color:var(--text3);">Sin uso registrado en este período.</td></tr>`;
    if (totalsRow) totalsRow.innerHTML = '';
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${esc(r.label || r.key)}</td>
      <td>${r.scans}</td>
      <td>${r.travel}</td>
      <td><strong>${r.total}</strong></td>
      <td>${r.claudePct}%</td>
      <td>${fmtUsd(r.estimatedCostUsd)}</td>
    </tr>
  `).join('');

  if (totalsRow && totals) {
    totalsRow.innerHTML = `
      <td>Totales</td>
      <td>${totals.scans}</td>
      <td>${totals.travel}</td>
      <td>${totals.total}</td>
      <td>${totals.claudePct}%</td>
      <td>${fmtUsd(totals.estimatedCostUsd)}</td>
    `;
  }
}
export function initAdministracion() {
  document.getElementById('admin-bill-saleCondition').innerHTML = SALE_CONDITIONS.map(value => `<option>${esc(value)}</option>`).join('');

  window.renderAdmin = function () {
    setAdminTab(_adminTab);
  };

  window.setAdminTab = setAdminTab;

  // ── Wire de eventos ───────────────────────────────────────
  document.querySelectorAll('#admin-tabs .admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setAdminTab(btn.dataset.adminTab));
  });

  document.getElementById('admin-ag-save')?.addEventListener('click', () => submitAgencyForm());

  document.getElementById('admin-ag-cancel')?.addEventListener('click', () => clearAgencyForm());

  document.getElementById('admin-ag-logo-file')?.addEventListener('change', handleAgencyLogoChange);

  document.getElementById('admin-ag-logo-remove')?.addEventListener('click', () => {
    adminLogoDataUrl = '';
    setAgencyLogoPreview('');
    const logoFileInput = document.getElementById('admin-ag-logo-file');
    if (logoFileInput) logoFileInput.value = '';
  });

  document.getElementById('admin-us-save')?.addEventListener('click', () => submitUserForm());

  document.getElementById('admin-us-password-gen')?.addEventListener('click', () => {
    const input = document.getElementById('admin-us-password');
    if (!input) return;
    input.type = 'text';
    input.value = generarContrasena();
    input.focus();
    input.select();
    const copy = document.getElementById('admin-us-password-copy');
    if (copy) copy.hidden = false;
  });

  document.getElementById('admin-us-password-copy')?.addEventListener('click', async () => {
    const input = document.getElementById('admin-us-password');
    const value = input?.value || '';
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast('Contraseña copiada.');
    } catch {
      input.focus();
      input.select();
      showToast('Seleccionada. Copiala con Cmd+C.', true);
    }
  });

  document.getElementById('admin-us-filter-agency')?.addEventListener('change', e => {
    _adminUsersFilter = e.target.value;
    loadMembers(_adminUsersFilter);
  });

  // Auto-slug desde el nombre solo en alta
  document.getElementById('admin-ag-name')?.addEventListener('input', e => {
    const slugInput = document.getElementById('admin-ag-slug');
    if (slugInput && !slugInput.disabled && !slugInput.dataset.touched) {
      slugInput.value = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    }
  });

  document.getElementById('admin-ag-slug')?.addEventListener('input', e => {
    e.target.dataset.touched = '1';
  });

  // Wiring modal editar usuario
  document.getElementById('admin-edit-user-save')?.addEventListener('click', () => submitEditUser());

  document.getElementById('admin-edit-user-cancel')?.addEventListener('click', () => closeModal('modal-edit-user'));

  document.getElementById('modal-edit-user-close-btn')?.addEventListener('click', () => closeModal('modal-edit-user'));

  // Wiring modal eliminar agencia
  document.getElementById('admin-agency-delete-cancel')?.addEventListener('click', () => closeModal('modal-agency-delete'));

  document.getElementById('modal-agency-delete-close-btn')?.addEventListener('click', () => closeModal('modal-agency-delete'));

  document.getElementById('admin-agency-delete-confirm')?.addEventListener('click', () => confirmDeleteAgency());

  document.getElementById('admin-agency-delete-input')?.addEventListener('input', e => {
    const target = document.getElementById('admin-agency-delete-target').value;
    document.getElementById('admin-agency-delete-confirm').disabled = e.target.value.trim() !== target;
  });

  document.addEventListener('click', e => {
    const edit = e.target.closest('[data-agency-edit]');
    if (edit) { openEditAgency(edit.dataset.agencyEdit); return; }
    const suspend = e.target.closest('[data-agency-suspend]');
    if (suspend) { toggleAgencyStatus(suspend.dataset.agencySuspend, true); return; }
    const activate = e.target.closest('[data-agency-activate]');
    if (activate) { toggleAgencyStatus(activate.dataset.agencyActivate, false); return; }
    const agDel = e.target.closest('[data-agency-delete]');
    if (agDel) { openDeleteAgencyModal(agDel.dataset.agencyDelete); return; }
    const deact = e.target.closest('[data-user-deactivate]');
    if (deact) { toggleUserActive(deact.dataset.userDeactivate, false); return; }
    const react = e.target.closest('[data-user-activate]');
    if (react) { toggleUserActive(react.dataset.userActivate, true); return; }
    const usEdit = e.target.closest('[data-user-edit]');
    if (usEdit) { openEditUserModal(usEdit.dataset.userEdit); return; }
    const mfaReset = e.target.closest('[data-user-mfa-reset]');
    if (mfaReset) { forceResetUserMfa(mfaReset.dataset.userMfaReset); return; }
    const usDel = e.target.closest('[data-user-delete]');
    if (usDel) { deleteUser(usDel.dataset.userDelete); return; }
  });

  document.addEventListener('change', e => {
    const roleSel = e.target.closest('.admin-role-select');
    if (roleSel) setUserRole(roleSel.dataset.userRole, roleSel.value);
  });
}
