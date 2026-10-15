import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  multiFactor,
  getMultiFactorResolver,
  TotpMultiFactorGenerator,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG, REQUIRE_2FA } from './config.js';
import { initDB, getUserAgency, getAgency } from './db.js';
import { storeAgencyId, clearStoredAgencyId, getStoredAgencyId, applyBranding } from './tenant.js';

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
initDB(app);

const form = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('btn-login');
const errorMessage = document.getElementById('error-msg');

// Paneles 2FA
const mfaCodePanel = document.getElementById('mfa-code-panel');
const mfaSetupPanel = document.getElementById('mfa-setup-panel');
const recoveryView = document.getElementById('recovery-codes-view');

// Estado del flujo 2FA
let _mfaPending = false;       // true durante el flujo 2FA: evita el redirect auto de onAuthStateChanged
let _pendingUser = null;       // usuario firmado pendiente de enrolamiento
let _pendingResolver = null;   // resolver para el signin con MFA
let _pendingSecret = null;     // secreto TOTP del enrolamiento en curso
let _lastRecoveryCodes = [];   // códigos mostrados (para el botón Copiar)

const UNAUTHORIZED_MSG =
  'Tu cuenta no está autorizada para acceder. Contactá al administrador de tu agencia.';

function showError(msg) {
  if (!errorMessage) return;
  errorMessage.textContent = msg;
  errorMessage.classList.add('show');
}

function resetLoginButton() {
  if (!loginButton) return;
  loginButton.disabled = false;
  loginButton.textContent = 'Ingresar';
}

// Muestra un panel 2FA y oculta el form + los demás paneles.
function showPanel(panel) {
  form.style.display = 'none';
  mfaCodePanel.style.display = 'none';
  mfaSetupPanel.style.display = 'none';
  recoveryView.style.display = 'none';
  if (panel) panel.style.display = '';
}

function showLoginForm() {
  _mfaPending = false;
  _pendingUser = null;
  _pendingResolver = null;
  _pendingSecret = null;
  form.style.display = '';
  mfaCodePanel.style.display = 'none';
  mfaSetupPanel.style.display = 'none';
  recoveryView.style.display = 'none';
}

async function resolveAgencyForUser(uid) {
  const agencyId = await getUserAgency(uid);
  if (!agencyId) return null;

  const agency = await getAgency(agencyId);
  if (!agency || (agency.status && agency.status !== 'active')) return null;

  return { agencyId, agency };
}

async function completeLogin(user) {
  // 2FA: si está habilitado y no tiene factor enrolado, forzar enrolamiento.
  if (REQUIRE_2FA && multiFactor(user).enrolledFactors.length === 0) {
    _pendingUser = user;
    _mfaPending = true;
    await startEnrollment(user);
    return false;
  }

  const resolved = await resolveAgencyForUser(user.uid);
  if (!resolved) {
    clearStoredAgencyId();
    await signOut(auth);
    showError(UNAUTHORIZED_MSG);
    showLoginForm();
    resetLoginButton();
    return false;
  }

  storeAgencyId(resolved.agencyId);
  // Tráfico interno en GA4: el equipo de la agencia dueña no contamina métricas
  // (el flag lo lee js/analytics.js al cargar la app).
  if (resolved.agencyId === 'trading-travel') {
    try { sessionStorage.setItem('td_internal', '1'); } catch { /* storage no disponible */ }
  }
  localStorage.removeItem('td_lastClose');
  applyBranding(resolved.agency.branding);
  await user.getIdToken(true);
  window.location.href = './index.html';
  return true;
}

async function loadStoredBranding() {
  const agencyId = getStoredAgencyId();
  if (!agencyId) return;
  try {
    const agency = await getAgency(agencyId);
    if (agency?.branding) applyBranding(agency.branding);
  } catch {
    // Sin sesión previa válida; branding por defecto en HTML
  }
}

loadStoredBranding();

const params = new URLSearchParams(window.location.search);
if (params.get('error') === 'unauthorized') {
  showError(UNAUTHORIZED_MSG);
  window.history.replaceState({}, '', window.location.pathname);
}
if (params.get('reason') === 'expired') {
  showError('Tu sesión expiró por inactividad. Volvé a ingresar.');
  window.history.replaceState({}, '', window.location.pathname);
}
if (params.get('reason') === 'need2fa') {
  showError('Debés activar el 2FA para continuar.');
  window.history.replaceState({}, '', window.location.pathname);
}

onAuthStateChanged(auth, async user => {
  if (!user) return;
  if (_mfaPending) return; // el flujo 2FA maneja el redirect manualmente
  await completeLogin(user);
});

// ── 2FA: enrolamiento (primer login, obligatorio) ───────────
async function startEnrollment(user) {
  try {
    const session = await multiFactor(user).getSession();
    const secret = await TotpMultiFactorGenerator.generateSecret(session);
    _pendingSecret = secret;
    const qrUrl = secret.generateQrCodeUrl(user.email, 'TravelDocs');
    await renderQr(qrUrl);
    document.getElementById('mfa-enroll-code').value = '';
    showPanel(mfaSetupPanel);
    resetLoginButton();
  } catch (err) {
    console.error('Error iniciando enrolamiento 2FA:', err);
    showError('No se pudo iniciar el enrolamiento del autenticador. Intentá de nuevo.');
    showLoginForm();
  }
}

async function renderQr(text) {
  const canvas = document.getElementById('qr-canvas');
  try {
    const QRCode = (await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm')).default;
    await QRCode.toCanvas(canvas, text, { width: 200 });
  } catch (err) {
    console.error('Error renderizando QR:', err);
  }
}

document.getElementById('btn-mfa-enroll')?.addEventListener('click', async () => {
  const code = (document.getElementById('mfa-enroll-code').value || '').trim();
  if (!/^\d{6}$/.test(code)) { showError('Ingresá los 6 dígitos del autenticador.'); return; }
  if (!_pendingUser || !_pendingSecret) { showLoginForm(); return; }

  const btn = document.getElementById('btn-mfa-enroll');
  btn.disabled = true; btn.textContent = 'Activando...';
  errorMessage?.classList.remove('show');

  try {
    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(_pendingSecret, code);
    await multiFactor(_pendingUser).enroll(assertion, 'Google Authenticator');
    // Setear claim mfaEnrolled + (si es primer enrolamiento) generar código de recuperación.
    const result = await completeMfaEnrollment(_pendingUser);
    if (result.existing) {
      // Re-enrolamiento: ya tiene código de recuperación guardado, no lo mostramos de nuevo.
      await _pendingUser.getIdToken(true);
      _mfaPending = false;
      await completeLogin(_pendingUser);
    } else {
      showRecoveryCodes(result.recoveryCodes || []);
    }
  } catch (err) {
    console.error('Error enrolando 2FA:', err);
    showError('Código incorrecto o expirado. Revisá el autenticador e intentá de nuevo.');
    btn.disabled = false; btn.textContent = 'Activar autenticador';
  }
});

async function completeMfaEnrollment(user) {
  const idToken = await user.getIdToken();
  const fnUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8888/.netlify/functions/mfa-complete'
    : '/.netlify/functions/mfa-complete';
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
    body: '{}'
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || 'No se pudo completar el 2FA.');
  return json;
}

function showRecoveryCodes(codes) {
  _lastRecoveryCodes = codes;
  const list = document.getElementById('recovery-codes-list');
  list.innerHTML = codes.map(c => `<code style="display:inline-block;background:var(--surface2);padding:10px 16px;border-radius:8px;text-align:center;font-family:var(--mono);font-size:18px;font-weight:600;letter-spacing:.05em;">${c}</code>`).join('');
  showPanel(recoveryView);
}

document.getElementById('btn-copy-codes')?.addEventListener('click', async () => {
  if (!_lastRecoveryCodes || !_lastRecoveryCodes.length) return;
  const text = _lastRecoveryCodes.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    showToast('Código copiado al portapapeles.');
  } catch {
    // Fallback: popup con el código para copiar a mano.
    window.prompt('Copiá este código (Ctrl+C):', text);
  }
});

function showToast(msg) {
  let t = document.getElementById('login-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'login-toast';
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;z-index:50;opacity:0;transition:opacity .2s;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 2200);
}

document.getElementById('btn-recovery-done')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-recovery-done');
  btn.disabled = true; btn.textContent = 'Ingresando...';
  try {
    await _pendingUser.getIdToken(true); // refresca el claim mfaEnrolled
    _mfaPending = false;
    await completeLogin(_pendingUser);
  } catch (err) {
    console.error('Error finalizando 2FA:', err);
    btn.disabled = false; btn.textContent = 'Los guardé, continuar';
    showError('No se pudo finalizar. Intentá de nuevo.');
  }
});

// ── 2FA: código del autenticador (usuario ya enrolado) ──────
function showMfaCodePanel() {
  const input = document.getElementById('mfa-code');
  input.value = '';
  showPanel(mfaCodePanel);
  resetLoginButton();
  input.focus();
}

mfaCodePanel?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = (document.getElementById('mfa-code').value || '').trim();
  if (!/^\d{6}$/.test(code)) { showError('Ingresá los 6 dígitos del autenticador.'); return; }
  if (!_pendingResolver) { showLoginForm(); return; }

  const btn = document.getElementById('btn-mfa-verify');
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = 'Validando...';
  errorMessage?.classList.remove('show');

  try {
    const hint = _pendingResolver.hints[0];
    const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
    const cred = await _pendingResolver.resolveSignIn(assertion);
    _mfaPending = false;
    await completeLogin(cred.user);
  } catch (err) {
    console.error('Error validando código MFA:', err);
    showError('Código incorrecto. Intentá de nuevo.');
    btn.disabled = false; btn.textContent = 'Validar';
  }
});

// ── Login email + contraseña ────────────────────────────────
form?.addEventListener('submit', async event => {
  event.preventDefault();

  const email = emailInput?.value.trim() || '';
  const password = passwordInput?.value || '';

  if (loginButton) {
    loginButton.disabled = true;
    loginButton.innerHTML = '<span class="spinner"></span>Ingresando...';
  }
  errorMessage?.classList.remove('show');

  _mfaPending = true; // evita el redirect auto mientras dura el flujo 2FA

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    // Sign-in OK → usuario sin 2FA enrolado → completeLogin fuerza el enrolamiento.
    const ok = await completeLogin(cred.user);
    if (!ok) return;
  } catch (err) {
    if (err.code === 'auth/multi-factor-auth-required') {
      // Usuario con 2FA enrolado: pedir código del autenticador.
      _pendingResolver = getMultiFactorResolver(auth, err);
      _pendingUser = null;
      _mfaPending = true;
      showMfaCodePanel();
      return;
    }
    _mfaPending = false;
    const msgs = {
      'auth/invalid-credential': 'Email o contraseña incorrectos.',
      'auth/user-not-found': 'No existe una cuenta con ese email.',
      'auth/wrong-password': 'Contraseña incorrecta.',
      'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos.',
      'auth/network-request-failed': 'Error de conexión. Verificá tu internet.',
    };
    showError(msgs[err.code] || 'Error al ingresar. Intentá de nuevo.');
    resetLoginButton();
  }
});
