// ============================================================
//  admin-api.cjs — Panel de Administración (super-admin)
//  Endpoint único con routing por método + path (opción A del plan).
//
//  Rutas:
//    GET    /agencies                    → listar agencias (+ memberCount)
//    POST   /agencies                    → crear agencia
//    PATCH  /agencies/:agencyId          → editar agencia (branding, alerts, plan, status)
//    DELETE /agencies/:agencyId          → eliminar agencia (cascada + Auth de miembros)
//    GET    /agencies/:agencyId/members  → listar miembros de una agencia
//    POST   /users                       → crear o vincular usuario
//    PATCH  /users/:uid                  → editar usuario (rol, active, displayName, email, password)
//    DELETE /users/:uid                  → eliminar usuario (Auth + users + members)
//
//  Todas las rutas requieren super-admin (_platform-admin.cjs).
//  No loguear passwords. Auditoría en auditLogs/{id}.
// ============================================================

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { requirePlatformAdmin, initAdmin } = require('./_platform-admin.cjs');
const { findUidByEmail, linkUserToAgency } = require('./lib/tenant-helpers.cjs');
const { canDeleteAgency, canDeleteUser, validateUserPatch } = require('./lib/admin-validators.cjs');

const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const VALID_ROLES = ['owner', 'admin', 'agent'];
const VALID_PLANS = ['trial', 'starter', 'pro'];
const VALID_STATUS = ['active', 'suspended'];

function db() {
  initAdmin();
  return admin.firestore();
}
function auth() {
  initAdmin();
  return admin.auth();
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return reply(204, {});

  const adminAuth = await requirePlatformAdmin(event);
  if (!adminAuth.ok) return reply(adminAuth.status, { error: adminAuth.error });

  const { method, segments } = parseRoute(event);

  try {
    // ── AGENCIAS ───────────────────────────────────────────
    if (segments[0] === 'agencies') {
      if (method === 'GET' && segments.length === 1) return await listAgencies();
      if (method === 'POST' && segments.length === 1) return await createAgency(event, adminAuth);
      if (method === 'PATCH' && segments.length === 2) return await updateAgency(segments[1], event, adminAuth);
      if (method === 'DELETE' && segments.length === 2) return await deleteAgency(segments[1], event, adminAuth);
      if (method === 'GET' && segments.length === 3 && segments[2] === 'members') {
        return await listMembers(segments[1]);
      }
    }

    // ── USUARIOS ───────────────────────────────────────────
    if (segments[0] === 'users') {
      if (method === 'POST' && segments.length === 1) return await createOrLinkUser(event, adminAuth);
      if (method === 'PATCH' && segments.length === 2) return await updateUser(segments[1], event, adminAuth);
      if (method === 'DELETE' && segments.length === 2) return await deleteUser(segments[1], event, adminAuth);
    }

    // ── USO Y GASTO (reporte para cobro manual) ───────────
    if (segments[0] === 'usage') {
      if (method === 'GET' && segments.length === 1) return await listUsage(event);
    }

    return reply(404, { error: 'Ruta no encontrada.' });
  } catch (err) {
    console.error('admin-api: error no manejado:', err?.message || err);
    return reply(500, { error: 'Error interno del servidor.' });
  }
};

// ============================================================
//  Routing
// ============================================================
function parseRoute(event) {
  const segments = (event.path || '').split('/').filter(Boolean);
  const idx = segments.indexOf('admin-api');
  const rest = idx >= 0 ? segments.slice(idx + 1) : segments;
  return { method: event.httpMethod, segments: rest };
}

function body(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return null;
  }
}

// ============================================================
//  Agencias
// ============================================================
async function listAgencies() {
  const snap = await db().collection('agencies').get();
  const agencies = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const membersSnap = await db().collection('agencies').doc(doc.id).collection('members').get();
    agencies.push({
      id: doc.id,
      name: data.name || '',
      slug: data.slug || doc.id,
      plan: data.plan || 'trial',
      status: data.status || 'active',
      memberCount: membersSnap.size,
      branding: data.branding || {},
      alerts: data.alerts || {},
    });
  }
  return reply(200, { agencies });
}

async function createAgency(event, adminAuth) {
  const b = body(event);
  if (!b) return reply(400, { error: 'Body inválido (JSON requerido).' });

  const slug = (b.slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return reply(400, { error: 'Slug inválido. 3-40 chars: a-z, 0-9, guiones.' });
  if (!VALID_PLANS.includes(b.plan)) return reply(400, { error: 'Plan inválido.' });
  if (!VALID_STATUS.includes(b.status || 'active')) return reply(400, { error: 'Estado inválido.' });

  const existing = await db().collection('agencies').doc(slug).get();
  if (existing.exists) return reply(409, { error: `Ya existe una agencia con slug "${slug}".` });

  const doc = {
    name: (b.name || '').trim(),
    slug,
    plan: b.plan,
    status: b.status || 'active',
    branding: sanitizeBranding(b.branding),
    alerts: sanitizeAlerts(b.alerts),
    memberCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await db().collection('agencies').doc(slug).set(doc);
  await audit(adminAuth, 'create-agency', { agencyId: slug });
  return reply(200, { ok: true, agencyId: slug });
}

async function updateAgency(agencyId, event, adminAuth) {
  const b = body(event);
  if (!b) return reply(400, { error: 'Body inválido (JSON requerido).' });

  const ref = db().collection('agencies').doc(agencyId);
  const snap = await ref.get();
  if (!snap.exists) return reply(404, { error: 'Agencia no encontrada.' });

  const patch = { updatedAt: FieldValue.serverTimestamp() };
  if (b.name !== undefined) patch.name = String(b.name).trim();
  if (b.plan !== undefined) {
    if (!VALID_PLANS.includes(b.plan)) return reply(400, { error: 'Plan inválido.' });
    patch.plan = b.plan;
  }
  if (b.status !== undefined) {
    if (!VALID_STATUS.includes(b.status)) return reply(400, { error: 'Estado inválido.' });
    if (b.status === 'suspended' && agencyId === adminAuth.agencyId) {
      return reply(409, { error: 'No podes suspender la agencia vinculada a tu cuenta de administrador.' });
    }
    patch.status = b.status;
  }
  if (b.branding !== undefined) patch.branding = sanitizeBranding(b.branding);
  if (b.alerts !== undefined) patch.alerts = sanitizeAlerts(b.alerts);

  await ref.set(patch, { merge: true });
  await audit(adminAuth, 'update-agency', { agencyId, changes: Object.keys(patch) });
  return reply(200, { ok: true });
}

async function listMembers(agencyId) {
  const agencySnap = await db().collection('agencies').doc(agencyId).get();
  if (!agencySnap.exists) return reply(404, { error: 'Agencia no encontrada.' });

  const snap = await db().collection('agencies').doc(agencyId).collection('members').get();
  const members = snap.docs.map(d => {
    const m = d.data() || {};
    return { uid: d.id, email: m.email || '', displayName: m.displayName || '', role: m.role || '', active: m.active !== false };
  });
  return reply(200, { members });
}

// ============================================================
//  Usuarios
// ============================================================
async function createOrLinkUser(event, adminAuth) {
  const b = body(event);
  if (!b) return reply(400, { error: 'Body inválido (JSON requerido).' });

  const email = (b.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return reply(400, { error: 'Email inválido.' });
  if (!VALID_ROLES.includes(b.role)) return reply(400, { error: 'Rol inválido.' });
  const agencyId = (b.agencyId || '').trim();
  if (!SLUG_RE.test(agencyId)) return reply(400, { error: 'agencyId inválido.' });

  const agencySnap = await db().collection('agencies').doc(agencyId).get();
  if (!agencySnap.exists) return reply(404, { error: 'Agencia no encontrada.' });

  const password = b.password ? String(b.password) : null;
  if (password && password.length < 8) return reply(400, { error: 'La contraseña debe tener al menos 8 caracteres.' });

  // ¿Ya existe en Auth?
  let uid = await findUidByEmail(auth(), email);
  let created = false;

  if (!uid) {
    // Usuario nuevo → password obligatorio.
    if (!password) {
      return reply(400, { error: 'Contraseña obligatoria para usuarios nuevos (mín. 8 chars).' });
    }
    try {
      const user = await auth().createUser({ email, password, emailVerified: true, displayName: b.displayName || undefined });
      uid = user.uid;
      created = true;
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        return reply(409, { error: 'El email ya existe en Auth. Reintentá: el sistema lo vinculará.' });
      }
      console.error('admin-api: createUser falló:', err?.message || err);
      return reply(500, { error: 'No se pudo crear el usuario en Auth.' });
    }
  } else {
    // Usuario existente → verificar que no esté en otra agencia.
    const account = await auth().getUser(uid);
    if (account.disabled) return reply(409, { error: 'La cuenta esta desactivada. Usa Reactivar antes de vincularla.' });
    const userDoc = await db().collection('users').doc(uid).get();
    const existing = userDoc.data() || {};
    if (existing.agencyId && existing.agencyId !== agencyId) {
      return reply(409, { error: `El usuario ya pertenece a la agencia "${existing.agencyId}". El MVP no soporta multi-agencia.` });
    }
    // Si vino password, resetearla.
    if (password) {
      try {
        await auth().updateUser(uid, { password, emailVerified: true });
      } catch (err) {
        console.error('admin-api: updateUser(password) falló:', err?.message || err);
        return reply(500, { error: 'No se pudo resetear la contraseña.' });
      }
    }
  }

  await linkUserToAgency({
    db: db(),
    auth: auth(),
    uid,
    agencyId,
    member: { email, role: b.role, displayName: b.displayName || '' },
    now: FieldValue.serverTimestamp(),
  });

  await audit(adminAuth, created ? 'create-user' : 'link-user', { agencyId, targetUid: uid, email });
  return reply(200, { ok: true, uid, email, created });
}

async function updateUser(uid, event, adminAuth) {
  const b = body(event);
  if (!b) return reply(400, { error: 'Body inválido (JSON requerido).' });

  // El super-admin no se edita a si mismo desde aca (se edita por Firebase Console).
  if (uid === adminAuth.uid) {
    return reply(409, { error: 'No podes editar tu propia cuenta de super-admin desde aqui.' });
  }

  let userRec;
  try {
    userRec = await auth().getUser(uid);
  } catch (err) {
    return reply(404, { error: 'Usuario no encontrado en Auth.' });
  }

  const userDoc = await db().collection('users').doc(uid).get();
  const existing = userDoc.data() || {};
  const agencyId = existing.agencyId;
  if (!agencyId) return reply(409, { error: 'El usuario no tiene agencia asignada.' });

  // Validar email/password con helper puro antes de tocar Auth.
  const v = validateUserPatch({ email: b.email, password: b.password, currentEmail: userRec.email });
  if (!v.ok) return reply(400, { error: v.error });

  const patch = {};
  const memberPatch = {};
  if (b.displayName !== undefined) {
    patch.displayName = String(b.displayName);
    memberPatch.displayName = String(b.displayName);
  }
  if (b.role !== undefined) {
    if (!VALID_ROLES.includes(b.role)) return reply(400, { error: 'Rol inválido.' });
    patch.role = b.role;
    memberPatch.role = b.role;
  }
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return reply(400, { error: 'active debe ser booleano.' });
    patch.active = b.active;
    memberPatch.active = b.active;
  }

  // Email: actualizar en Auth y sincronizar users/{uid} + members/{uid}.
  if (v.emailChanged) {
    try {
      await auth().updateUser(uid, { email: v.normalizedEmail });
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        return reply(409, { error: 'Ese email ya pertenece a otro usuario en Auth.' });
      }
      console.error('admin-api: updateUser(email) falló:', err?.message || err);
      return reply(500, { error: 'No se pudo actualizar el email en Auth.' });
    }
    patch.email = v.normalizedEmail;
    memberPatch.email = v.normalizedEmail;
  }

  // Password: solo en Auth, no se persiste en Firestore.
  if (v.passwordChanged) {
    try {
      await auth().updateUser(uid, { password: b.password });
    } catch (err) {
      console.error('admin-api: updateUser(password) falló:', err?.message || err);
      return reply(500, { error: 'No se pudo cambiar la contraseña.' });
    }
  }

  if (b.active !== undefined) {
    try {
      await auth().updateUser(uid, { disabled: !b.active });
    } catch (err) {
      console.error('admin-api: updateUser(disabled) fallo:', err?.message || err);
      return reply(500, { error: 'No se pudo actualizar el estado de la cuenta en Auth.' });
    }
  }

  if (Object.keys(patch).length) {
    patch.updatedAt = FieldValue.serverTimestamp();
    await db().collection('users').doc(uid).set(patch, { merge: true });
  }
  if (Object.keys(memberPatch).length) {
    await db().collection('agencies').doc(agencyId).collection('members').doc(uid).set(memberPatch, { merge: true });
  }

  // Merge de claims: preservar platformAdmin si existía.
  if (b.role !== undefined || b.active === false) {
    const claims = userRec.customClaims || {};
    if (b.role !== undefined) claims.role = b.role;
    // El estado activo se valida en Auth y users/{uid}, no en claims.
    await auth().setCustomUserClaims(uid, claims);
  }

  // Revocar sesiones activas si se desactivó, cambió el email o cambió la password.
  if (b.active === false || v.emailChanged || v.passwordChanged) {
    try {
      await auth().revokeRefreshTokens(uid);
    } catch (err) {
      console.error('admin-api: revokeRefreshTokens falló:', err?.message || err);
    }
  }

  await audit(adminAuth, 'update-user', {
    agencyId,
    targetUid: uid,
    changes: Object.keys(patch),
    emailChanged: v.emailChanged,
    passwordChanged: v.passwordChanged, // booleano: nunca loguear el valor de la password
  });
  return reply(200, { ok: true });
}

// ============================================================
//  Eliminación (destructiva, irreversible)
// ============================================================

// DELETE /agencies/:agencyId
// Borra la agencia, todas sus subcolecciones (recursiveDelete), las cuentas
// Auth de sus miembros y los docs users/{uid} de esos miembros.
// Body: { confirmSlug } — debe coincidir exactamente con agencyId.
async function deleteAgency(agencyId, event, adminAuth) {
  if (!SLUG_RE.test(agencyId)) return reply(400, { error: 'agencyId inválido.' });

  const b = body(event);
  if (!b) return reply(400, { error: 'Body inválido (JSON requerido).' });
  if ((b.confirmSlug || '').trim() !== agencyId) {
    return reply(400, { error: 'El slug de confirmación no coincide.' });
  }

  const agencyRef = db().collection('agencies').doc(agencyId);
  const agencySnap = await agencyRef.get();
  if (!agencySnap.exists) return reply(404, { error: 'Agencia no encontrada.' });

  // Validaciones puras: última agencia y auto-pertenencia del super-admin.
  const allAgenciesSnap = await db().collection('agencies').get();
  const membersSnap = await agencyRef.collection('members').get();
  const memberUids = membersSnap.docs.map(d => d.id);
  const verdict = canDeleteAgency({
    agencyCount: allAgenciesSnap.size,
    superAdminUid: adminAuth.uid,
    superAdminMemberUids: memberUids,
  });
  if (!verdict.ok) return reply(409, { error: verdict.error });

  // 1. Borrar cuentas Auth de los miembros (antes de destruir la agencia,
  //    para poder seguir leyendo members si algo falla). Catch por uid.
  const authErrors = [];
  for (const uid of memberUids) {
    try {
      await auth().deleteUser(uid);
    } catch (err) {
      if (err.code === 'auth/user-not-found') continue; // ya borrado
      authErrors.push({ uid, error: err?.message || String(err) });
    }
  }

  // 2. Borrar doc de agencia + todas sus subcolecciones en cascada.
  try {
    await admin.firestore().recursiveDelete(agencyRef);
  } catch (err) {
    console.error('admin-api: recursiveDelete(agency) falló:', err?.message || err);
    authErrors.push({ agencyId, error: 'recursiveDelete falló: ' + (err?.message || err) });
  }

  // 3. Borrar users/{uid} de cada miembro (coleccion raiz, no la toca recursiveDelete).
  for (const uid of memberUids) {
    try {
      await db().collection('users').doc(uid).delete();
    } catch (err) {
      authErrors.push({ uid, error: 'users delete: ' + (err?.message || err) });
    }
  }

  if (authErrors.length) console.error('admin-api: deleteAgency errores parciales:', authErrors);

  await audit(adminAuth, 'delete-agency', { agencyId, memberCount: memberUids.length, authErrors });
  return reply(200, { ok: true, deletedMembers: memberUids.length, authErrors });
}

// DELETE /users/:uid
// Borra Auth + users/{uid} + members/{uid}. Impide auto-eliminación y
// eliminar al único owner activo de la agencia.
// Body: { confirm: true }
async function deleteUser(uid, event, adminAuth) {
  const b = body(event);
  if (!b || b.confirm !== true) return reply(400, { error: 'Falta confirmación.' });

  // Leer users/{uid} para obtener agencyId y rol.
  const userDoc = await db().collection('users').doc(uid).get();
  const data = userDoc.data() || {};
  const agencyId = data.agencyId || null;
  const targetRole = data.role || null;

  // Contar owners activos de la agencia (solo si tiene agencyId).
  let activeOwnerCount = 0;
  if (agencyId) {
    const ownersSnap = await db().collection('agencies').doc(agencyId)
      .collection('members').where('role', '==', 'owner').get();
    activeOwnerCount = ownersSnap.docs.filter(d => (d.data() || {}).active !== false).length;
  }

  const verdict = canDeleteUser({
    targetUid: uid,
    superAdminUid: adminAuth.uid,
    targetRole,
    targetActive: data.active !== false,
    activeOwnerCount,
  });
  if (!verdict.ok) return reply(409, { error: verdict.error });

  // Verificar que exista en Auth (usuario huérfano sin Auth → 404).
  try {
    await auth().getUser(uid);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      // Si tampoco hay doc en Firestore, no existe.
      if (!userDoc.exists) return reply(404, { error: 'Usuario no encontrado.' });
    } else {
      console.error('admin-api: deleteUser getUser falló:', err?.message || err);
      return reply(500, { error: 'No se pudo verificar el usuario.' });
    }
  }

  // 1. Borrar Auth.
  try {
    await auth().deleteUser(uid);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') {
      console.error('admin-api: deleteUser Auth falló:', err?.message || err);
      return reply(500, { error: 'No se pudo eliminar el usuario de Auth.' });
    }
  }

  // 2. Borrar users/{uid} y members/{uid} (catch individual, no crítico).
  try { await db().collection('users').doc(uid).delete(); }
  catch (err) { console.error('admin-api: users delete falló:', err?.message || err); }
  if (agencyId) {
    try { await db().collection('agencies').doc(agencyId).collection('members').doc(uid).delete(); }
    catch (err) { console.error('admin-api: members delete falló:', err?.message || err); }
  }

  await audit(adminAuth, 'delete-user', { agencyId, targetUid: uid });
  return reply(200, { ok: true });
}

// ============================================================
//  Uso y gasto — reporte por agencia para cobro manual
// ============================================================
//
//  Lee agencies/{agencyId}/usage/{YYYY-MM-DD} (escrito por _usage.cjs)
//  y agrega por rango. El gasto es ESTIMADO: tariffas por env var, ya
//  que Google factura por key/proyecto, no por agencia.
//
//  GET /usage?range=daily|weekly|monthly|historical&month=YYYY-MM
//    - daily/weekly: filas por día/semana (suma de todas las agencias)
//      dentro del mes seleccionado.
//    - monthly: una fila por agencia, total del mes.
//    - historical: una fila por agencia, todo el histórico.
//  Cada fila: { key, label, scans, travel, total, claudeCount, claudePct,
//               estimatedCostUsd }.

const VALID_RANGES = ['daily', 'weekly', 'monthly', 'historical'];
const MONTH_RE = /^\d{4}-\d{2}$/;

// Tarifas estimadas por unidad (USD). Defaults chicos; sobreescribir con env vars.
function costRates() {
  return {
    scanGemini: Number(process.env.COST_PER_SCAN_GEMINI) || 0.001,
    scanClaude: Number(process.env.COST_PER_SCAN_CLAUDE) || 0.01,
    travel:     Number(process.env.COST_PER_TRAVEL)     || 0.005,
  };
}

// Lunes de la semana ISO de una fecha (dayId = YYYY-MM-DD).
function isoWeekStart(dayId) {
  const [y, m, d] = dayId.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay(); // 0=dom .. 6=sab
  const diff = (day === 0 ? -6 : 1 - day); // volver al lunes
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function monthBounds(month) {
  // month = YYYY-MM → [firstDay, lastDay] como YYYY-MM-DD (strings comparables lexicográficamente).
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

function currentMonth(now = new Date()) {
  // Mes actual en hora de Argentina (consistente con usageDayId de _usage.cjs).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit',
  }).formatToParts(now);
  const y = (parts.find(p => p.type === 'year') || {}).value;
  const m = (parts.find(p => p.type === 'month') || {}).value;
  return `${y}-${m}`;
}

function emptyAgg() {
  return { scans: 0, travel: 0, claudeCount: 0 };
}

function addDocToAgg(agg, data) {
  const bySrc = data.bySource || {};
  agg.scans += Number(data.scans) || 0;
  agg.travel += Number(data.travel) || 0;
  agg.claudeCount += (Number(bySrc.claude) || 0) + (Number(data['bySource.claude']) || 0);
}

function aggCost(agg, rates) {
  const gemini = agg.scans - agg.claudeCount; // scans atribuidos a Gemini
  return Number((
    Math.max(0, gemini) * rates.scanGemini +
    agg.claudeCount * rates.scanClaude +
    agg.travel * rates.travel
  ).toFixed(4));
}

function aggRow(key, label, agg, rates) {
  const total = agg.scans + agg.travel;
  const claudePct = total > 0 ? Math.round((agg.claudeCount / agg.scans) * 1000) / 10 : 0;
  return {
    key,
    label,
    scans: agg.scans,
    travel: agg.travel,
    total,
    claudeCount: agg.claudeCount,
    claudePct,
    estimatedCostUsd: aggCost(agg, rates),
  };
}

async function listUsage(event) {
  const q = event.queryStringParameters || {};
  const range = VALID_RANGES.includes(q.range) ? q.range : 'monthly';
  const month = (q.month && MONTH_RE.test(q.month)) ? q.month : currentMonth();

  const rates = costRates();
  const agenciesSnap = await db().collection('agencies').get();
  const agencies = agenciesSnap.docs.map(d => ({ id: d.id, name: (d.data() || {}).name || d.id }));

  // Histórico vs mensual/diario/semanal: el histórico lee todo; los demás filtran al mes.
  const filterByMonth = range !== 'historical';
  const [fromDay, toDay] = filterByMonth ? monthBounds(month) : [null, null];

  // Para daily/weekly agrupamos por período; para monthly/historical por agencia.
  const byKey = new Map(); // key -> { agg, label, agencyName? }
  const grandAgg = emptyAgg();

  for (const ag of agencies) {
    let snap;
    if (filterByMonth) {
      snap = await db().collection('agencies').doc(ag.id).collection('usage')
        .where('dayId', '>=', fromDay).where('dayId', '<=', toDay).get();
    } else {
      snap = await db().collection('agencies').doc(ag.id).collection('usage').get();
    }

    if (range === 'monthly' || range === 'historical') {
      const agg = emptyAgg();
      for (const doc of snap.docs) addDocToAgg(agg, doc.data() || {});
      addDocToAgg(grandAgg, { scans: agg.scans, travel: agg.travel, bySource: { claude: agg.claudeCount } });
      if (agg.scans || agg.travel) {
        byKey.set(ag.id, { agg, label: ag.name });
      }
    } else {
      // daily/weekly: agrupar por día o semana dentro del mes.
      for (const doc of snap.docs) {
        const data = doc.data() || {};
        const dayId = data.dayId || doc.id;
        const key = range === 'daily' ? dayId : isoWeekStart(dayId);
        addDocToAgg(grandAgg, data);
        const entry = byKey.get(key) || { agg: emptyAgg(), label: key };
        addDocToAgg(entry.agg, data);
        byKey.set(key, entry);
      }
    }
  }

  let rows;
  if (range === 'monthly' || range === 'historical') {
    rows = [...byKey.entries()]
      .map(([key, { agg, label }]) => aggRow(key, label, agg, rates))
      .sort((a, b) => b.total - a.total);
  } else {
    rows = [...byKey.entries()]
      .map(([key, { agg }]) => aggRow(key, key, agg, rates))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  return reply(200, {
    range,
    month: filterByMonth ? month : null,
    rates,
    rows,
    totals: aggRow('totales', 'Totales', grandAgg, rates),
  });
}

// ============================================================
//  Validación / helpers
// ============================================================
function sanitizeBranding(b) {
  if (!b || typeof b !== 'object') return {};
  const out = {};
  if (b.appName) out.appName = String(b.appName);
  // logoUrl admite string vacío para poder BORRAR el logo (merge:true lo persiste como '').
  if (b.logoUrl !== undefined) out.logoUrl = String(b.logoUrl);
  if (b.primaryColor) out.primaryColor = String(b.primaryColor);
  return out;
}

function sanitizeAlerts(a) {
  if (!a || typeof a !== 'object') return {};
  const out = {};
  if (a.email) out.email = String(a.email).trim();
  if (a.emailjsPublicKey) out.emailjsPublicKey = String(a.emailjsPublicKey);
  if (a.emailjsServiceId) out.emailjsServiceId = String(a.emailjsServiceId);
  if (a.emailjsTemplateId) out.emailjsTemplateId = String(a.emailjsTemplateId);
  // Nota: la Private Key de EmailJS (strict mode) NO se guarda acá: el doc de
  // la agencia lo lee el browser de cualquier miembro (getAgency trae el doc
  // completo). Vive solo como env var EMAILJS_PRIVATE_KEY del site y la usa
  // send-alerts.cjs.
  return out;
}

// Auditoría: escribe auditLogs/{id}. No incluye passwords.
async function audit(adminAuth, action, details) {
  try {
    await db().collection('auditLogs').add({
      action,
      performedBy: adminAuth.uid,
      performedByEmail: adminAuth.email || '',
      agencyId: details?.agencyId || null,
      targetUid: details?.targetUid || null,
      details: details || {},
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // La auditoría no debe romper la operación principal.
    console.error('admin-api: audit falló:', err?.message || err);
  }
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

exports.handler = require('./_sentry.cjs').wrapHandler(exports.handler);
