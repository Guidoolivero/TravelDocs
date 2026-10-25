// ============================================================
//  _auth.cjs — Validación de ID token + tenant multi-agencia
//  Verifica JWT con Admin SDK, lee users/{uid} y valida agencyId.
// ============================================================

const admin = require('firebase-admin');

let adminReady = false;

function initAdmin() {
  if (adminReady) return;

  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!inline) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT no configurada en Netlify.');
  }

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(inline)),
  });
  adminReady = true;
}

async function verifyAuth(event, { requireMfa = true } = {}) {
  try {
    initAdmin();
  } catch (err) {
    return { ok: false, status: 500, error: err?.message || 'Error de configuración del servidor.' };
  }

  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, status: 401, error: 'Falta token de autenticación.' };
  }

  try {
    const decoded = await admin.auth().verifyIdToken(match[1], true);
    const uid = decoded.uid;
    let email = (decoded.email || '').toLowerCase();

    const userSnap = await admin.firestore().collection('users').doc(uid).get();
    if (!userSnap.exists) {
      return { ok: false, status: 403, error: 'Usuario no autorizado.' };
    }
    const data = userSnap.data() || {};
    if (data.active === false) {
      return { ok: false, status: 403, error: 'Cuenta desactivada.' };
    }

    if (data.mfaResetAt != null && !(decoded.auth_time > data.mfaResetAt)) {
      return { ok: false, status: 401, error: 'Tu sesion fue reseteada. Volve a iniciar sesion.' };
    }

    const agencyId = data.agencyId;
    const role = data.role;
    if (typeof agencyId !== 'string' || !agencyId.trim() || !['owner', 'admin', 'agent'].includes(role)) {
      return { ok: false, status: 403, error: 'Usuario sin agencia o rol valido.' };
    }
    if ((decoded.agencyId != null && decoded.agencyId !== agencyId) ||
        (decoded.role != null && decoded.role !== role)) {
      return { ok: false, status: 403, error: 'Tus permisos cambiaron. Volve a iniciar sesion.' };
    }
    if (!email) email = (data.email || '').toLowerCase();

    const agencySnap = await admin.firestore().collection('agencies').doc(agencyId).get();
    if (!agencySnap.exists) {
      return { ok: false, status: 403, error: 'Agencia no encontrada.' };
    }

    const agency = agencySnap.data() || {};
    if (agency.status && agency.status !== 'active') {
      return { ok: false, status: 403, error: 'Agencia inactiva.' };
    }

    // 2FA: exigir evidencia del segundo factor emitida por Firebase para esta sesion.
    // El enrolamiento usa requireMfa:false; no habilita acceso a datos.
    // REQUIRE_2FA: env var 'true' de Netlify lo fuerza ya (para probar en staging);
    // si no, se activa solo el 21/09/2026 00:00 ART (misma fecha que public/js/config.js).
    const REQUIRE_2FA = process.env.REQUIRE_2FA === 'true' ||
      Date.now() >= Date.parse('2026-09-21T00:00:00-03:00');
    if (requireMfa && REQUIRE_2FA && decoded.firebase?.sign_in_second_factor !== 'totp') {
      return { ok: false, status: 403, error: 'Ingresa con tu autenticador para usar el sistema.' };
    }

    return { ok: true, uid, agencyId, role, email, authTime: decoded.auth_time };
  } catch (err) {
    const code = err?.code || '';
    if (code === 'auth/id-token-expired' || code === 'auth/argument-error') {
      return { ok: false, status: 401, error: 'Token inválido o expirado.' };
    }
    console.error('_auth: error verificando token:', err?.message || err);
    return { ok: false, status: 401, error: 'Token inválido o expirado.' };
  }
}

module.exports = { verifyAuth };