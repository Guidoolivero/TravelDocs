// ============================================================
//  Netlify Function: mfa-complete
//  Se llama DESPUÉS de que el cliente enroló el factor TOTP vía
//  Firebase Auth. Hace dos cosas:
//    1) Genera un codigo de recuperacion de un solo uso, lo
//       hashea (SHA-256 + salt) y lo guarda en users/{uid}.
//       Lo devuelve en claro una sola vez.
//    2) Setea el custom claim `mfaEnrolled: true` (preservando
//       agencyId/role) como marca informativa. El acceso requiere
//       que Firebase certifique TOTP en la sesion.
//
//  Auth ligera: verifyAuth con requireMfa:false (el usuario aún
//  no tiene el claim, justamente viene a setearlo).
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

// Alfabeto sin caracteres ambiguos (sin I, O, 0, 1) para que sea fácil de leer/tipear.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Genera UN código de recuperación con formato XXXX-XXXX-XXXX-XXXX.
function genCode() {
  const seg = () => {
    const bytes = crypto.randomBytes(4);
    let s = '';
    for (let i = 0; i < 4; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return s;
  };
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}

// Hashea un código con un salt aleatorio. Devuelve { salt, hash }.
function hashCode(code) {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + ':' + code).digest('hex');
  return { salt, hash };
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method Not Allowed' });

  // requireMfa:false: el usuario viene de enrolar, todavía sin claim.
  const authResult = await verifyAuth(event, { requireMfa: false });
  if (!authResult.ok) return reply(authResult.status, { error: authResult.error });

  const { uid, authTime } = authResult;

  try {
    // Verificar que el usuario realmente enroló un factor TOTP en Firebase Auth.
    const userRecord = await auth().getUser(uid);
    const enrolled = (userRecord.multiFactor && userRecord.multiFactor.enrolledFactors) || [];
    if (!enrolled.some(f => f.factorId === 'totp')) {
      return reply(400, { error: 'Todavía no enrolaste el autenticador.' });
    }

    // Setear claim mfaEnrolled:true preservando claims existentes.
    const existingClaims = userRecord.customClaims || {};

    const userRef = db().collection('users').doc(uid);
    const result = await db().runTransaction(async transaction => {
      const userDoc = await transaction.get(userRef);
      const user = userDoc.data() || {};
      if (!userDoc.exists || (user.mfaResetAt != null && !(authTime > user.mfaResetAt))) return { stale: true };
      const existingCodes = user.recoveryCodes || [];
      if (existingCodes.length > 0) return { existing: true };

      const code = genCode();
      transaction.set(userRef, {
        recoveryCodes: [hashCode(code)], updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return { recoveryCodes: [code] };
    });
    if (result.stale) return reply(401, { error: 'Tu sesion fue reseteada. Volve a ingresar.' });
    await auth().setCustomUserClaims(uid, { ...existingClaims, mfaEnrolled: true });
    return reply(200, result);
  } catch (err) {
    console.error('mfa-complete: error:', err?.message || err);
    return reply(500, { error: 'No se pudo completar el enrolamiento del 2FA.' });
  }
};

exports.handler = require('./_sentry.cjs').wrapHandler(exports.handler);
