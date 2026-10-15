// ============================================================
//  tenant-helpers.cjs — vinculación usuario ↔ agencia (Functions)
//
//  Espejo CommonJS de scripts/lib/seed-helpers.mjs.
//  Mantener ambos sincronizados: cualquier cambio acá se replica
//  en el .mjs y viceversa. (No se compartió un único archivo por
//  la frontera ESM/CommonJS entre scripts y Netlify Functions.)
//
//  Correcciones vs la versión original (v1.1 del plan):
//  - displayName se guarda también en members/{uid} (no solo en users/{uid}).
//  - setCustomUserClaims es sobrescritura total: se acepta extraClaims para
//    mergear y preservar claims existentes (ej. platformAdmin).
// ============================================================

// Busca un UID por email en Firebase Auth. Devuelve null si no existe.
async function findUidByEmail(auth, email) {
  try {
    const user = await auth.getUserByEmail(email);
    return user.uid;
  } catch (err) {
    if (err.code === 'auth/user-not-found') return null;
    throw err;
  }
}

// Vincula un usuario a una agencia:
//  - users/{uid}        { agencyId, email, role, displayName, active }
//  - members/{uid}       { email, role, displayName, active, invitedAt, lastLoginAt }
//  - custom claims       { agencyId, role, ...extraClaims }  (merge, no sobrescribe)
//
//  extraClaims permite sumar claims sin pisar los existentes (ej. platformAdmin).
async function linkUserToAgency({ db, auth, uid, agencyId, member, now, extraClaims = {} }) {
  const email = member.email.toLowerCase();

  await db.collection('users').doc(uid).set({
    agencyId,
    email,
    role: member.role,
    displayName: member.displayName || null,
    active: true,
    createdAt: now,
  }, { merge: true });

  await db.collection('agencies').doc(agencyId).collection('members').doc(uid).set({
    email,
    role: member.role,
    displayName: member.displayName || null,
    active: true,
    invitedAt: now,
    lastLoginAt: null,
  }, { merge: true });

  // Merge de claims: leer existentes y combinar (setCustomUserClaims pisa todo).
  const existing = (await auth.getUser(uid)).customClaims || {};
  await auth.setCustomUserClaims(uid, {
    ...existing,
    agencyId,
    role: member.role,
    ...extraClaims,
  });
}

module.exports = { findUidByEmail, linkUserToAgency };
