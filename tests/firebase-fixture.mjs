import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

// Solo Firebase y observabilidad se simulan; los helpers de autorizacion son reales.
export function fixture({ active = true, missing = false, revoked = false } = {}) {
  const docs = new Map([
    ['users/admin', { active: true, agencyId: 'agency', role: 'owner' }],
    ['users/user', { active, agencyId: 'agency', role: 'agent' }],
    ['agencies/agency', { status: 'active' }],
  ]);
  if (missing) docs.delete('users/user');
  const calls = [];
  const clock = { now: Date.now() };
  class TestDate extends Date { static now() { return clock.now; } }
  const tokens = new Map(['admin', 'user'].map(uid => [uid, {
    uid, email: `${uid}@test.com`, agencyId: 'agency', role: uid === 'admin' ? 'owner' : 'agent',
    platformAdmin: uid === 'admin', mfaEnrolled: true, firebase: { sign_in_second_factor: 'totp' }, auth_time: Math.floor(Date.now() / 1000) - 60,
  }]));
  const accounts = new Map(['admin', 'user'].map(uid => [uid, {
    email: `${uid}@test.com`, customClaims: { platformAdmin: uid === 'admin', mfaEnrolled: true },
    multiFactor: { enrolledFactors: [{ factorId: 'totp' }] },
  }]));
  const sdkAuth = {
    async verifyIdToken(token, checkRevoked) {
      if (revoked && checkRevoked) throw Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' });
      return structuredClone(tokens.get(token));
    },
    async getUser(uid) { return structuredClone(accounts.get(uid)); },
    async updateUser(uid, patch) { calls.push(['updateUser', uid, patch]); Object.assign(accounts.get(uid), patch); },
    async setCustomUserClaims(uid, claims) { calls.push(['claims', uid, claims]); accounts.get(uid).customClaims = structuredClone(claims); },
    async revokeRefreshTokens(uid) { calls.push(['revoke', uid]); },
  };
  let transactionQueue = Promise.resolve();
  function ref(path) {
    return {
      path,
      collection: name => ref(`${path}/${name}`), doc: id => ref(`${path}/${id}`),
      async get() { const data = structuredClone(docs.get(path)); return { exists: docs.has(path), data: () => structuredClone(data) }; },
      async set(value) { docs.set(path, { ...docs.get(path), ...value }); },
      async add() {},
    };
  }
  const firestore = () => ({
    collection: name => ref(name),
    runTransaction(callback) {
      const result = transactionQueue.then(async () => {
        const writes = [];
        const value = await callback({ get: r => r.get(), set: (r, data, options) => writes.push(() => r.set(data, options)) });
        for (const write of writes) await write();
        return value;
      });
      transactionQueue = result.catch(() => {});
      return result;
    },
  });
  firestore.FieldValue = { serverTimestamp: () => 1, delete: () => undefined };
  const admin = { apps: [], credential: { cert: x => x }, initializeApp() {}, auth: () => sdkAuth, firestore };
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
    runInNewContext(readFileSync(url, 'utf8'), { require, module, exports: module.exports, console, Date: TestDate, process: { env: { FIREBASE_SERVICE_ACCOUNT: '{}', PLATFORM_SUPER_ADMIN_EMAILS: 'admin@test.com' } } }, { filename: url.pathname });
    return module.exports;
  }
  return {
    docs, calls, sdkAuth, tokens, accounts, clock,
    invoke: (name, body = {}, actor = 'admin', httpMethod = 'POST') => load(new URL(`../netlify/functions/${name}.cjs`, import.meta.url)).handler({ httpMethod, path: `/.netlify/functions/${name}`, headers: { authorization: `Bearer ${actor}` }, body: JSON.stringify(body) }),
    agency: (agencyId, body, actor = 'admin') => load(new URL('../netlify/functions/admin-api.cjs', import.meta.url)).handler({ httpMethod: 'PATCH', path: `/.netlify/functions/admin-api/agencies/${agencyId}`, headers: { authorization: `Bearer ${actor}` }, body: JSON.stringify(body) }),
    verify: () => load(new URL('../netlify/functions/_auth.cjs', import.meta.url)).verifyAuth({ headers: { authorization: 'Bearer user' } }),
    editUser: body => load(new URL('../netlify/functions/admin-api.cjs', import.meta.url)).handler({ httpMethod: 'PATCH', path: '/.netlify/functions/admin-api/users/user', headers: { authorization: 'Bearer admin' }, body: JSON.stringify(body) }),
    patch: active => load(new URL('../netlify/functions/admin-api.cjs', import.meta.url)).handler({ httpMethod: 'PATCH', path: '/.netlify/functions/admin-api/users/user', headers: { authorization: 'Bearer admin' }, body: JSON.stringify({ active }) }),
  };
}

