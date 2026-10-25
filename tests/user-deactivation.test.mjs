import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Solo Firebase y observabilidad se simulan; los helpers de autorizacion son reales.
function fixture({ active = true, missing = false, revoked = false } = {}) {
  const docs = new Map([
    ['users/admin', { active: true, agencyId: 'agency', role: 'owner' }],
    ['users/user', { active, agencyId: 'agency', role: 'agent' }],
    ['agencies/agency', { status: 'active' }],
  ]);
  if (missing) docs.delete('users/user');
  const calls = [];
  const sdkAuth = {
    async verifyIdToken(token, checkRevoked) {
      if (revoked && checkRevoked) throw Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' });
      return { uid: token, email: `${token}@test.com`, agencyId: 'agency', role: token === 'admin' ? 'owner' : 'agent', mfaEnrolled: true };
    },
    async getUser(uid) { return { email: `${uid}@test.com`, customClaims: { platformAdmin: uid === 'admin' } }; },
    async updateUser(uid, patch) { calls.push(['updateUser', uid, patch]); },
    async setCustomUserClaims(uid, claims) { calls.push(['claims', uid, claims]); },
    async revokeRefreshTokens(uid) { calls.push(['revoke', uid]); },
  };
  function ref(path) {
    return {
      collection: name => ref(`${path}/${name}`), doc: id => ref(`${path}/${id}`),
      async get() { return { exists: docs.has(path), data: () => docs.get(path) }; },
      async set(value) { docs.set(path, { ...docs.get(path), ...value }); },
      async add() {},
    };
  }
  const admin = { apps: [], credential: { cert: x => x }, initializeApp() {}, auth: () => sdkAuth, firestore: () => ({ collection: name => ref(name) }) };
  const cache = new Map();
  function load(url) {
    if (cache.has(url.href)) return cache.get(url.href).exports;
    const module = { exports: {} };
    cache.set(url.href, module);
    const nativeRequire = createRequire(url);
    const require = id => {
      if (id === 'firebase-admin') return admin;
      if (id === 'firebase-admin/firestore') return { FieldValue: { serverTimestamp: () => 1 } };
      if (id === './_sentry.cjs') return { wrapHandler: fn => fn };
      return id.startsWith('.') ? load(new URL(id, url)) : nativeRequire(id);
    };
    runInNewContext(readFileSync(url, 'utf8'), { require, module, exports: module.exports, console, process: { env: { FIREBASE_SERVICE_ACCOUNT: '{}', PLATFORM_SUPER_ADMIN_EMAILS: 'admin@test.com' } } }, { filename: url.pathname });
    return module.exports;
  }
  return {
    docs, calls, sdkAuth,
    agency: (agencyId, body, actor = 'admin') => load(new URL('../netlify/functions/admin-api.cjs', import.meta.url)).handler({ httpMethod: 'PATCH', path: `/.netlify/functions/admin-api/agencies/${agencyId}`, headers: { authorization: `Bearer ${actor}` }, body: JSON.stringify(body) }),
    verify: () => load(new URL('../netlify/functions/_auth.cjs', import.meta.url)).verifyAuth({ headers: { authorization: 'Bearer user' } }),
    editUser: body => load(new URL('../netlify/functions/admin-api.cjs', import.meta.url)).handler({ httpMethod: 'PATCH', path: '/.netlify/functions/admin-api/users/user', headers: { authorization: 'Bearer admin' }, body: JSON.stringify(body) }),
    patch: active => load(new URL('../netlify/functions/admin-api.cjs', import.meta.url)).handler({ httpMethod: 'PATCH', path: '/.netlify/functions/admin-api/users/user', headers: { authorization: 'Bearer admin' }, body: JSON.stringify({ active }) }),
  };
}

test('cuenta desactivada con claims validos no accede a Functions', async () => {
  assert.equal((await fixture({ active: false }).verify()).status, 403);
});
test('perfil eliminado no conserva acceso por claims antiguos', async () => {
  assert.equal((await fixture({ missing: true }).verify()).status, 403);
});
test('token revocado no accede a Functions', async () => {
  assert.equal((await fixture({ revoked: true }).verify()).status, 401);
});
test('usuario activo conserva acceso', async () => {
  assert.equal((await fixture().verify()).ok, true);
});
for (const active of [false, true]) {
  test(`PATCH active=${active} sincroniza Auth y perfiles`, async () => {
    const f = fixture({ active: !active });
    assert.equal((await f.patch(active)).statusCode, 200);
    assert.equal(f.calls.some(([op, uid, patch]) => op === 'updateUser' && uid === 'user' && patch.disabled === !active), true);
    assert.equal(f.docs.get('users/user').active, active);
    assert.equal(f.docs.get('agencies/agency/members/user').active, active);
    if (!active) assert.equal(f.calls.some(([op]) => op === 'revoke'), true);
  });
}
test('active requiere booleano y no altera datos ante entrada invalida', async () => {
  const f = fixture();
  assert.equal((await f.patch('false')).statusCode, 400);
  assert.equal(f.calls.length, 0);
  assert.equal(f.docs.get('users/user').active, true);
});
test('fallo de Auth no informa exito ni modifica perfiles', async () => {
  const f = fixture();
  f.sdkAuth.updateUser = async () => { throw new Error('Auth unavailable'); };
  assert.equal((await f.patch(false)).statusCode, 500);
  assert.equal(f.docs.get('users/user').active, true);
});

test('agencia suspendida rechaza Functions y la reactivacion restaura acceso', async () => {
  const f = fixture();
  f.docs.set('agencies/agency', { status: 'suspended' });
  assert.equal((await f.verify()).status, 403);
  f.docs.set('agencies/agency', { status: 'active' });
  assert.equal((await f.verify()).ok, true);
});
test('agencia eliminada rechaza Functions', async () => {
  const f = fixture();
  f.docs.delete('agencies/agency');
  assert.equal((await f.verify()).status, 403);
});

test('platformAdmin no puede suspender su propia agencia ni aplicar cambios parciales', async () => {
  const f = fixture();
  assert.equal((await f.agency('agency', { status: 'suspended', name: 'Cambio' })).statusCode, 409);
  assert.equal(f.docs.get('agencies/agency').status, 'active');
  assert.equal(f.docs.get('agencies/agency').name, undefined);
});
test('platformAdmin conserva edicion propia y suspension/reactivacion de otra agencia', async () => {
  const f = fixture();
  assert.equal((await f.agency('agency', { name: 'Nombre', status: 'active' })).statusCode, 200);
  f.docs.set('agencies/client', { status: 'active' });
  for (const status of ['suspended', 'active']) {
    assert.equal((await f.agency('client', { status })).statusCode, 200);
    assert.equal(f.docs.get('agencies/client').status, status);
  }
});

test('platformAdmin conserva edicion de plan, nombre, branding y alertas', async () => {
  const f = fixture();
  f.docs.set('agencies/client', { status: 'active', slug: 'client', memberCount: 2 });
  const patch = { name: 'Agencia cliente', plan: 'pro', branding: { appName: 'Cliente' }, alerts: { email: 'agency@test.com' } };
  assert.equal((await f.agency('client', patch)).statusCode, 200);
  const saved = f.docs.get('agencies/client');
  for (const [key, value] of Object.entries(patch)) {
    assert.equal(JSON.stringify(saved[key]), JSON.stringify(value));
  }
  assert.equal(saved.slug, 'client');
  assert.equal(saved.memberCount, 2);
});
for (const role of ['owner', 'admin', 'agent']) {
  test(`${role} sin platformAdmin no modifica agencias por API`, async () => {
    const f = fixture();
    f.docs.set('users/user', { active: true, agencyId: 'agency', role });
    const verify = f.sdkAuth.verifyIdToken;
    f.sdkAuth.verifyIdToken = async (...args) => ({ ...await verify(...args), role });
    assert.equal((await f.agency('agency', { plan: 'pro' }, 'user')).statusCode, 403);
    assert.equal(f.docs.get('agencies/agency').plan, undefined);
  });
}

test('Functions rechaza el rol anterior tras una degradacion', async () => {
  const f = fixture();
  const verify = f.sdkAuth.verifyIdToken;
  f.sdkAuth.verifyIdToken = async (...args) => ({ ...await verify(...args), role: 'owner' });
  assert.equal((await f.verify()).status, 403);
});
test('Functions rechaza la agencia anterior despues de un traslado', async () => {
  const f = fixture();
  f.docs.set('users/user', { active: true, agencyId: 'other', role: 'agent' });
  f.docs.set('agencies/other', { status: 'active' });
  assert.equal((await f.verify()).status, 403);
  const verify = f.sdkAuth.verifyIdToken;
  f.sdkAuth.verifyIdToken = async (...args) => ({ ...await verify(...args), agencyId: 'other' });
  const result = await f.verify();
  assert.equal(result.ok, true);
  assert.equal(result.agencyId, 'other');
});
test('Functions no autoriza un perfil sin agencia o con rol desconocido', async () => {
  for (const profile of [{ role: 'agent' }, { agencyId: 'agency', role: 'superuser' }]) {
    const f = fixture();
    f.docs.set('users/user', { active: true, ...profile });
    assert.equal((await f.verify()).status, 403);
  }
});

test('platformAdmin sincroniza cambios de rol y el token anterior pierde acceso', async () => {
  const f = fixture();
  assert.equal((await f.editUser({ role: 'owner' })).statusCode, 200);
  assert.equal(f.docs.get('users/user').role, 'owner');
  assert.equal(f.docs.get('agencies/agency/members/user').role, 'owner');
  assert.equal(f.calls.some(([op, uid, claims]) => op === 'claims' && uid === 'user' && claims.role === 'owner'), true);
  assert.equal((await f.verify()).status, 403);
  const verify = f.sdkAuth.verifyIdToken;
  f.sdkAuth.verifyIdToken = async (...args) => ({ ...await verify(...args), role: 'owner' });
  assert.equal((await f.verify()).ok, true);
});
test('Functions conserva el fallback al perfil para tokens sin claims de tenant', async () => {
  const f = fixture();
  const verify = f.sdkAuth.verifyIdToken;
  f.sdkAuth.verifyIdToken = async (...args) => ({ ...await verify(...args), agencyId: undefined, role: undefined });
  assert.equal((await f.verify()).ok, true);
});
