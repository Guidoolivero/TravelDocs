// ============================================================
//  Netlify Function: mfa-complete
//  Se llama DESPUÉS de que el cliente enroló el factor TOTP vía
//  Firebase Auth. Hace dos cosas:
//    1) Genera 8 códigos de recuperación de un solo uso, los
//       hashea (SHA-256 + salt) y los guarda en users/{uid}.
//       Los devuelve en claro (se muestran una sola vez).
//    2) Setea el custom claim `mfaEnrolled: true` (preservando
//       agencyId/role) para que _auth.cjs deje pasar las demás
//       Functions.
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

  const { uid } = authResult;

  try {
    // Verificar que el usuario realmente enroló un factor TOTP en Firebase Auth.
    const userRecord = await auth().getUser(uid);
    const enrolled = (userRecord.multiFactor && userRecord.multiFactor.enrolledFactors) || [];
    if (!enrolled.length) {
      return reply(400, { error: 'Todavía no enrolaste el autenticador.' });
    }

    // Setear claim mfaEnrolled:true preservando claims existentes.
    const existingClaims = userRecord.customClaims || {};
    await auth().setCustomUserClaims(uid, { ...existingClaims, mfaEnrolled: true });

    // Si el usuario ya tiene un código de recuperación (re-enrolamiento tras un
    // reseteo normal), NO lo regeneramos: el que guardó sigue siendo válido.
    // Solo se genera uno nuevo en el primer enrolamiento o después de un force-reset.
    const userDoc = await db().collection('users').doc(uid).get();
    const existingCodes = (userDoc.data() || {}).recoveryCodes || [];
    if (existingCodes.length > 0) {
      return reply(200, { existing: true });
    }

    // Primer enrolamiento (o post force-reset): generar 1 código de recuperación.
    const code = genCode();
    const hashed = [hashCode(code)];

    // Guardar el hash en users/{uid}.recoveryCodes (write:false para el cliente;
    // lo escribe el Admin SDK, que saltea firestore.rules).
    await db().collection('users').doc(uid).set(
      { recoveryCodes: hashed, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    return reply(200, { recoveryCodes: [code] });
  } catch (err) {
    console.error('mfa-complete: error:', err?.message || err);
    return reply(500, { error: 'No se pudo completar el enrolamiento del 2FA.' });
  }
};

exports.handler = require('./_sentry.cjs').wrapHandler(exports.handler);
