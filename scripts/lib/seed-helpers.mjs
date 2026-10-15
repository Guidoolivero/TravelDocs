// ============================================================
//  seed-helpers.mjs — vinculación usuario ↔ agencia (scripts CLI)
//
//  Espejo ESM de netlify/functions/lib/tenant-helpers.cjs.
//  Mantener ambos sincronizados.
//
//  Correcciones v1.1:
//  - displayName también en members/{uid}.
//  - Merge de claims vía extraClaims (preserva platformAdmin).
// ============================================================

export async function findUidByEmail(auth, email) {
  try {
    const user = await auth.getUserByEmail(email);
    return user.uid;
  } catch (err) {
    if (err.code === 'auth/user-not-found') return null;
    throw err;
  }
}

export async function linkUserToAgency({ db, auth, uid, agencyId, member, now, extraClaims = {} }) {
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

  // 2FA TOTP exige email verificado. Las cuentas son internas (creadas por admin),
  // así que se marca verificado al vincular.
  await auth.updateUser(uid, { emailVerified: true });
}
