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
      return { uid: token, email: `${token}@test.com`, agencyId: 'agency', role: 'owner', mfaEnrolled: true };
    },
    async getUser(uid) { return { email: `${uid}@test.com`, customClaims: { platformAdmin: uid === 'admin' } }; },
    async updateUser(uid, patch) { calls.push(['updateUser', uid, patch]); },
    async setCustomUserClaims() {},
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
    verify: () => load(new URL('../netlify/functions/_auth.cjs', import.meta.url)).verifyAuth({ headers: { authorization: 'Bearer user' } }),
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
