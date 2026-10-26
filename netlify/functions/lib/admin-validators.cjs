// ============================================================
//  admin-validators.cjs — validaciones puras para el panel super-admin
//
//  Funciones puras (sin Admin SDK ni env vars) para poder testear
//  sin emulator ni service account. Espejo del patron de
//  checkPlatformAdmin en _platform-admin.cjs.
//
//  El backend (admin-api.cjs) las llama ANTES de tocar Auth/Firestore.
// ============================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ¿Se puede eliminar la agencia?
//   reason: 'last-agency'   → es la unica agencia de la plataforma
//           'self-member'   → el super-admin es miembro de esa agencia
//           'ok'
function canDeleteAgency({ agencyCount, superAdminUid, superAdminMemberUids }) {
  if (Number(agencyCount) <= 1) {
    return { ok: false, reason: 'last-agency', error: 'No se puede eliminar la ultima agencia de la plataforma.' };
  }
  const uids = Array.isArray(superAdminMemberUids) ? superAdminMemberUids : [];
  if (superAdminUid && uids.includes(superAdminUid)) {
    return { ok: false, reason: 'self-member', error: 'No podes eliminar la agencia a la que perteneces.' };
  }
  return { ok: true, reason: 'ok' };
}

// ¿Se puede eliminar el usuario?
//   reason: 'self'         → el super-admin se quiere eliminar a si mismo
//           'last-owner'   → es el unico owner activo de su agencia
//           'ok'
function canDeleteUser({ targetUid, superAdminUid, targetRole, targetActive = true, activeOwnerCount }) {
  if (targetUid && targetUid === superAdminUid) {
    return { ok: false, reason: 'self', error: 'No podes eliminar tu propia cuenta.' };
  }
  // Contar solo owners activos: permite limpiar owners inactivos huerfanos.
  if (targetRole === 'owner' && targetActive && Number(activeOwnerCount) <= 1) {
    return { ok: false, reason: 'last-owner', error: 'No se puede eliminar el unico owner de la agencia. Asigna otro owner primero.' };
  }
  return { ok: true, reason: 'ok' };
}

// Valida el patch de un usuario (email/password opcionales).
//   - email === currentEmail (o undefined) → emailChanged:false (no-op)
//   - email invalido → ok:false
//   - password vacio/undefined → passwordChanged:false (no-op)
//   - password < 8 → ok:false
//   Devuelve { ok, emailChanged, passwordChanged, error }
function validateUserPatch({ email, password, currentEmail }) {
  const norm = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
  const newEmail = norm(email);
  const current = norm(currentEmail);
  const emailChanged = newEmail !== '' && newEmail !== current;
  if (emailChanged && !EMAIL_RE.test(newEmail)) {
    return { ok: false, emailChanged: false, passwordChanged: false, error: 'Email invalido.' };
  }

  const hasPassword = typeof password === 'string' && password.length > 0;
  const passwordChanged = hasPassword;
  if (passwordChanged && password.length < 8) {
    return { ok: false, emailChanged, passwordChanged: false, error: 'La contraseña debe tener al menos 8 caracteres.' };
  }

  return { ok: true, emailChanged, passwordChanged, normalizedEmail: emailChanged ? newEmail : undefined };
}

module.exports = { canDeleteAgency, canDeleteUser, validateUserPatch };
