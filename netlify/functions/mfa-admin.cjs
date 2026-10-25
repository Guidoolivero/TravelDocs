// ============================================================
//  Netlify Function: mfa-admin
//  Gestión de 2FA dentro de una agencia (owner/admin):
//    GET    /members        → lista miembros con estado mfaEnrolled
//    POST   /reset          → resetea 2FA de un usuario verificando
//                              su código de recuperación
//    POST   /force-reset    → resetea sin código (solo platformAdmin)
//
//  Reset: borra el factor TOTP del usuario en Auth, baja el claim
//  mfaEnrolled a false, consume recoveryCodes y revoca las sesiones. El usuario entra con
//  solo contraseña y re-enrola.
// ============================================================

const crypto = require('crypto');
const admin = require('firebase-admin');
const { verifyAuth } = require('./_auth.cjs');
const { requirePlatformAdmin } = require('./_platform-admin.cjs');

function initAdmin() {
  if (admin.apps.length) return;
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!inline) throw new Error('FIREBASE_SERVICE_ACCOUNT no configurada en Netlify.');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(inline)) });
}

function db() { initAdmin(); return admin.firestore(); }
function auth() { initAdmin(); return admin.auth(); }

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

// Devuelve true si el código coincide con algún hash de recoveryCodes.
function codeMatches(code, recoveryCodes) {
  if (!Array.isArray(recoveryCodes)) return false;
  const clean = (code || '').trim().toUpperCase();
  for (const entry of recoveryCodes) {
    if (!entry || !entry.salt || !entry.hash) continue;
    const h = crypto.createHash('sha256').update(entry.salt + ':' + clean).digest('hex');
    if (h === entry.hash) return true;
  }
  return false;
}

// Lista los miembros de la agencia del caller con su estado mfaEnrolled.
async function listMembers(authResult) {
  const membersSnap = await db().collection('agencies').doc(authResult.agencyId).collection('members').get();
  const out = [];
  for (const m of membersSnap.docs) {
    const data = m.data() || {};
    let mfaEnrolled = false;
    try {
      const ur = await auth().getUser(m.id);
      mfaEnrolled = (ur.multiFactor?.enrolledFactors || []).some(f => f.factorId === 'totp');
    } catch (_) { /* usuario podría no existir en Auth */ }
    out.push({ uid: m.id, email: data.email || '', displayName: data.displayName || '', role: data.role || '', mfaEnrolled });
  }
  return reply(200, { members: out });
}

// Resetea el 2FA de targetUid. Si force=false, exige recoveryCode válido.
async function resetMfa(authResult, body, force) {
  const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim() : '';
  if (!targetUid) return reply(400, { error: 'Falta targetUid.' });
  const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode.trim() : '';
  if (!force && !recoveryCode) return reply(400, { error: 'Falta el codigo de recuperacion.' });

  try {
    const userRef = db().collection('users').doc(targetUid);
    // Consumir el codigo y cerrar las sesiones antes de modificar Auth.
    const rejected = await db().runTransaction(async transaction => {
      const snap = await transaction.get(userRef);
      const user = snap.data() || {};
      if (!snap.exists || (!force && user.agencyId !== authResult.agencyId)) {
        return { status: 404, error: 'El usuario no pertenece a tu agencia.' };
      }
      if (!force && !codeMatches(recoveryCode, user.recoveryCodes)) {
        return { status: 403, error: 'Codigo de recuperacion invalido.' };
      }
      transaction.set(userRef, {
        recoveryCodes: [], mfaResetAt: Math.floor(Date.now() / 1000),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return null;
    });
    if (rejected) return reply(rejected.status, { error: rejected.error });

    // Borrar el factor TOTP en Auth.
    await auth().updateUser(targetUid, { multiFactor: { enrolledFactors: [] } });
    // Bajar claim mfaEnrolled (preservando el resto).
    const ur = await auth().getUser(targetUid);
    const existing = ur.customClaims || {};
    await auth().setCustomUserClaims(targetUid, { ...existing, mfaEnrolled: false });
    await auth().revokeRefreshTokens(targetUid);
    // Cerrar tambien logins completados mientras se eliminaba el factor.
    await db().runTransaction(async transaction => {
      const snap = await transaction.get(userRef);
      transaction.set(userRef, {
        mfaResetAt: Math.max(Math.floor(Date.now() / 1000), snap.data()?.mfaResetAt || 0),
        recoveryCodes: [], updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return reply(200, { ok: true });
  } catch (err) {
    console.error('mfa-admin reset: error:', err?.message || err);
    return reply(500, { error: 'No se pudo resetear el 2FA.' });
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return reply(204, {});
  if (!['GET', 'POST'].includes(event.httpMethod)) return reply(405, { error: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { error: 'Body invalido.' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Body invalido.' });
  const path = (event.path || '').replace(/^\/+/, '').replace(/^\.netlify\/functions\/mfa-admin\/?/, '');
  const action = body.action || path || '';
  const force = event.httpMethod === 'POST' && action === 'force-reset';
  const authResult = force ? await requirePlatformAdmin(event) : await verifyAuth(event);
  if (!authResult.ok) return reply(authResult.status, { error: authResult.error });
  if (!force && authResult.role !== 'owner' && authResult.role !== 'admin') {
    return reply(403, { error: 'Solo owner/admin pueden gestionar el 2FA.' });
  }

  try {
    if (event.httpMethod === 'GET' || action === 'members') return await listMembers(authResult);
    if (action === 'reset' || force) return await resetMfa(authResult, body, force);
    return reply(404, { error: 'Accion no reconocida.' });
  } catch (err) {
    console.error('mfa-admin: error:', err?.message || err);
    return reply(500, { error: 'Error interno.' });
  }
};

exports.handler = require('./_sentry.cjs').wrapHandler(exports.handler);
