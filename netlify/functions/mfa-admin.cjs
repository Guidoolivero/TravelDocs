// ============================================================
//  Netlify Function: mfa-admin
//  Gestión de 2FA dentro de una agencia (owner/admin):
//    GET    /members        → lista miembros con estado mfaEnrolled
//    POST   /reset          → resetea 2FA de un usuario verificando
//                              su código de recuperación
//    POST   /force-reset    → resetea sin código (solo platformAdmin)
//
//  Reset: borra el factor TOTP del usuario en Auth, baja el claim
//  mfaEnrolled a false y limpia recoveryCodes. El usuario entra con
//  solo contraseña y re-enrola.
// ============================================================

const crypto = require('crypto');
const admin = require('firebase-admin');
const { verifyAuth } = require('./_auth.cjs');

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
      mfaEnrolled = ur.customClaims?.mfaEnrolled === true;
    } catch (_) { /* usuario podría no existir en Auth */ }
    out.push({ uid: m.id, email: data.email || '', displayName: data.displayName || '', role: data.role || '', mfaEnrolled });
  }
  return reply(200, { members: out });
}

// Resetea el 2FA de targetUid. Si force=false, exige recoveryCode válido.
async function resetMfa(authResult, body, force) {
  const targetUid = (body.targetUid || '').trim();
  if (!targetUid) return reply(400, { error: 'Falta targetUid.' });

  // El target debe ser miembro de la misma agencia (salvo platform admin con force).
  const memberSnap = await db().collection('agencies').doc(authResult.agencyId).collection('members').doc(targetUid).get();
  if (!memberSnap.exists) {
    return reply(404, { error: 'El usuario no pertenece a tu agencia.' });
  }

  if (!force) {
    const recoveryCode = (body.recoveryCode || '').trim();
    if (!recoveryCode) return reply(400, { error: 'Falta el código de recuperación.' });
    const userDoc = await db().collection('users').doc(targetUid).get();
    const recoveryCodes = (userDoc.data() || {}).recoveryCodes;
    if (!codeMatches(recoveryCode, recoveryCodes)) {
      return reply(403, { error: 'Código de recuperación inválido.' });
    }
  }

  try {
    // Borrar el factor TOTP en Auth.
    await auth().updateUser(targetUid, { multiFactor: { enrolledFactors: [] } });
    // Bajar claim mfaEnrolled (preservando el resto).
    const ur = await auth().getUser(targetUid);
    const existing = ur.customClaims || {};
    await auth().setCustomUserClaims(targetUid, { ...existing, mfaEnrolled: false });
    // Solo un force-reset limpia el código de recuperación (el usuario lo perdió).
    // En un reseteo normal con código, este se CONSERVA (es reutilizable).
    if (force) {
      await db().collection('users').doc(targetUid).set(
        { recoveryCodes: admin.firestore.FieldValue.delete(), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    return reply(200, { ok: true });
  } catch (err) {
    console.error('mfa-admin reset: error:', err?.message || err);
    return reply(500, { error: 'No se pudo resetear el 2FA.' });
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return reply(204, {});

  // Auth completa (requireMfa:true): el admin ya tiene 2FA.
  const authResult = await verifyAuth(event);
  if (!authResult.ok) return reply(authResult.status, { error: authResult.error });

  // Solo owner/admin pueden gestionar 2FA de la agencia.
  if (authResult.role !== 'owner' && authResult.role !== 'admin') {
    return reply(403, { error: 'Solo owner/admin pueden gestionar el 2FA.' });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { /* GET no lleva body */ }

  const path = (event.path || '').replace(/^\/+/, '').replace(/^\.netlify\/functions\/mfa-admin\/?/, '');
  const action = (body.action || path || '').toLowerCase();

  try {
    if (event.httpMethod === 'GET' || action === 'members') {
      return await listMembers(authResult);
    }
    if (action === 'reset') {
      return await resetMfa(authResult, body, false);
    }
    if (action === 'force-reset') {
      // force-reset solo platformAdmin.
      const tokenResult = await auth().verifyIdToken((event.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      if (tokenResult.platformAdmin !== true) {
        return reply(403, { error: 'Solo un platform admin puede forzar el reseteo.' });
      }
      return await resetMfa(authResult, body, true);
    }
    return reply(404, { error: 'Acción no reconocida.' });
  } catch (err) {
    console.error('mfa-admin: error:', err?.message || err);
    return reply(500, { error: 'Error interno.' });
  }
};

exports.handler = require('./_sentry.cjs').wrapHandler(exports.handler);
