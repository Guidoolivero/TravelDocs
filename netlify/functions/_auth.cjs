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
    let agencyId = decoded.agencyId || null;
    let role = decoded.role || null;

    const userSnap = await admin.firestore().collection('users').doc(uid).get();
    if (!userSnap.exists) {
      return { ok: false, status: 403, error: 'Usuario no autorizado.' };
    }
    const data = userSnap.data() || {};
    if (data.active === false) {
      return { ok: false, status: 403, error: 'Cuenta desactivada.' };
    }

    if (!agencyId || !role) {
      agencyId = data.agencyId || null;
      role = data.role || null;
      if (!email) email = (data.email || '').toLowerCase();
    }

    if (!agencyId || !role) {
      return { ok: false, status: 403, error: 'Usuario sin agencia asignada.' };
    }

    const agencySnap = await admin.firestore().collection('agencies').doc(agencyId).get();
    if (!agencySnap.exists) {
      return { ok: false, status: 403, error: 'Agencia no encontrada.' };
    }

    const agency = agencySnap.data() || {};
    if (agency.status && agency.status !== 'active') {
      return { ok: false, status: 403, error: 'Agencia inactiva.' };
    }

    // 2FA: si requireMfa + REQUIRE_2FA y el claim mfaEnrolled no está en true,
    // rechazar. Excepción: las Functions de enrolamiento usan requireMfa:false.
    // REQUIRE_2FA: env var 'true' de Netlify lo fuerza ya (para probar en staging);
    // si no, se activa solo el 21/09/2026 00:00 ART (misma fecha que public/js/config.js).
    const REQUIRE_2FA = process.env.REQUIRE_2FA === 'true' ||
      Date.now() >= Date.parse('2026-09-21T00:00:00-03:00');
    if (requireMfa && REQUIRE_2FA && decoded.mfaEnrolled !== true) {
      return { ok: false, status: 403, error: 'Debés activar el 2FA para usar el sistema.' };
    }

    return { ok: true, uid, agencyId, role, email };
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