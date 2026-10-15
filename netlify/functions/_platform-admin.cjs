// ============================================================
//  _platform-admin.cjs — Verificación de super-admin de plataforma
//
//  Doble verificación (defensa en profundidad):
//    1. verifyAuth() de _auth.cjs  → JWT válido + cuenta activa + agencia activa
//    2. claim platformAdmin === true (leído de getUser, autoritativo)
//    3. email en PLATFORM_SUPER_ADMIN_EMAILS (env var de Netlify)
//
//  Si 2 y 3 no coinciden (alguien con claim pero sin email en env), se rechaza
//  y se loguea como posible manipulación.
//
//  checkPlatformAdmin() es una función pura (sin Admin SDK) para que se pueda
//  testear directamente la lógica de autorización.
// ============================================================

const admin = require('firebase-admin');
const { verifyAuth } = require('./_auth.cjs');

function initAdmin() {
  if (admin.apps.length) return;
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!inline) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT no configurada en Netlify.');
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(inline)) });
}

function allowedSuperAdmins() {
  return (process.env.PLATFORM_SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

// Decisión pura de autorización de super-admin.
// Devuelve { ok:true, reason:'ok' } o { ok:false, status:403, reason, error }.
//   reason: 'no-claim'       → sin claim platformAdmin
//           'email-mismatch' → tiene claim pero el email no está en la env var
function checkPlatformAdmin({ claims, email, allowedEmails }) {
  const e = (email || '').toLowerCase();
  const allowed = Array.isArray(allowedEmails) ? allowedEmails : [];
  if (!claims || claims.platformAdmin !== true) {
    return { ok: false, status: 403, reason: 'no-claim', error: 'Acceso restringido a super-administradores.' };
  }
  if (!allowed.includes(e)) {
    return { ok: false, status: 403, reason: 'email-mismatch', error: 'Acceso restringido a super-administradores.' };
  }
  return { ok: true, reason: 'ok' };
}

// Devuelve { ok:true, uid, email, agencyId, role } o { ok:false, status, error }.
async function requirePlatformAdmin(event) {
  // 1. Auth base (reusa _auth.cjs).
  const auth = await verifyAuth(event);
  if (!auth.ok) return auth;

  // 2. Claim platformAdmin (autoritativo desde Auth, no del token que puede estar stale).
  let claims;
  try {
    initAdmin();
    claims = (await admin.auth().getUser(auth.uid)).customClaims || {};
  } catch (err) {
    console.error('_platform-admin: error leyendo claims:', err?.message || err);
    return { ok: false, status: 401, error: 'No se pudo verificar el permiso de super-admin.' };
  }

  // 3. Doble verificación (claim + email en env var).
  const verdict = checkPlatformAdmin({
    claims,
    email: auth.email,
    allowedEmails: allowedSuperAdmins(),
  });
  if (!verdict.ok) {
    if (verdict.reason === 'email-mismatch') {
      console.warn(
        `_platform-admin: ${auth.email} tiene claim platformAdmin pero NO está en PLATFORM_SUPER_ADMIN_EMAILS. ` +
        `Posible manipulación — acceso denegado.`
      );
    }
    return { ok: false, status: verdict.status, error: verdict.error };
  }

  return { ok: true, uid: auth.uid, email: auth.email, agencyId: auth.agencyId, role: auth.role };
}

module.exports = { requirePlatformAdmin, initAdmin, allowedSuperAdmins, checkPlatformAdmin };
