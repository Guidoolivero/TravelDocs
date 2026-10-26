import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

// Solo Firebase y observabilidad se simulan; los helpers de autorizacion son reales.
export function fixture({ active = true, missing = false, revoked = false, env = {}, modules = {} } = {}) {
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
  function mergeFields(old, patch) {
    const result = { ...old };
    for (const [key, value] of Object.entries(patch)) {
      result[key] = value?.__increment__ !== undefined ? (Number(old?.[key]) || 0) + value.__increment__
        : value && Object.getPrototypeOf(value)?.constructor?.name === 'Object' ? mergeFields(old?.[key], value) : structuredClone(value);
    }
    return result;
  }
  function ref(path, filters = []) {
    return {
      path, id: path.split('/').at(-1),
      collection: name => ref(`${path}/${name}`), doc: id => ref(`${path}/${id}`),
      where: (field, op, value) => ref(path, [...filters, [field, op, value]]),
      async get() {
        if (path.split('/').length % 2) {
          const children = [...docs.keys()].filter(p => p.startsWith(path + '/') && p.split('/').length === path.split('/').length + 1)
            .filter(p => filters.every(([field, op, value]) => op === '==' ? docs.get(p)[field] === value : op === '>=' ? docs.get(p)[field] >= value : docs.get(p)[field] <= value));
          const snapshots = await Promise.all(children.map(p => ref(p).get()));
          return { docs: snapshots, size: snapshots.length, forEach: fn => snapshots.forEach(fn) };
        }
        const data = structuredClone(docs.get(path));
        return { id: path.split('/').at(-1), ref: ref(path), exists: docs.has(path), data: () => structuredClone(data) };
      },
      async set(value, options) { docs.set(path, mergeFields(options?.merge ? docs.get(path) : {}, value)); },
      async update(value) { docs.set(path, mergeFields(docs.get(path), value)); },
      async add() {},
    };
  }
  const firestore = () => ({
    collection: name => ref(name),
    runTransaction(callback) {
      const result = transactionQueue.then(async () => {
        const writes = [];
        const value = await callback({ get: r => r.get(), set: (r, data, options) => writes.push(() => r.set(data, options)), update: (r, data) => writes.push(() => r.update(data)) });
        for (const write of writes) await write();
        return value;
      });
      transactionQueue = result.catch(() => {});
      return result;
    },
  });
  firestore.FieldValue = { serverTimestamp: () => 1, delete: () => undefined, increment: n => ({ __increment__: n }) };
  const admin = { apps: [], credential: { cert: x => x }, initializeApp() {}, auth: () => sdkAuth, firestore };
  const cache = new Map();
  function load(url) {
    if (cache.has(url.href)) return cache.get(url.href).exports;
    const module = { exports: {} };
    cache.set(url.href, module);
    const nativeRequire = createRequire(url);
    const require = id => {
      if (id === 'firebase-admin') return admin;
      if (id === 'firebase-admin/firestore') return { FieldValue: firestore.FieldValue };
      if (id === './_sentry.cjs') return { wrapHandler: fn => fn };
      if (Object.hasOwn(modules, id)) return modules[id];
      return id.startsWith('.') && !id.endsWith('.mjs') ? load(new URL(id, url)) : nativeRequire(id);
    };
    runInNewContext(readFileSync(url, 'utf8'), { require, module, exports: module.exports, console, Date: TestDate, setTimeout, clearTimeout, AbortController, AbortSignal, Buffer,
      process: { env: { FIREBASE_SERVICE_ACCOUNT: '{}', PLATFORM_SUPER_ADMIN_EMAILS: 'admin@test.com', ...env } } }, { filename: url.pathname });
    return module.exports;
  }
  return {
    docs, calls, sdkAuth, tokens, accounts, clock,
    recordUsage: body => load(new URL('../netlify/functions/_usage.cjs', import.meta.url)).recordUsage(body),
    request: (path, body, method = 'GET', query = {}) => load(new URL('../netlify/functions/admin-api.cjs', import.meta.url)).handler({ httpMethod: method, path: `/.netlify/functions/admin-api${path}`, headers: { authorization: 'Bearer admin' }, body: JSON.stringify(body), queryStringParameters: query }),
    invoke: (name, body = {}, actor = 'admin', httpMethod = 'POST') => load(new URL(`../netlify/functions/${name}.cjs`, import.meta.url)).handler({ httpMethod, path: `/.netlify/functions/${name}`, headers: { authorization: `Bearer ${actor}` }, body: JSON.stringify(body) }),
    agency: (agencyId, body, actor = 'admin') => load(new URL('../netlify/functions/admin-api.cjs', import.meta.url)).handler({ httpMethod: 'PATCH', path: `/.netlify/functions/admin-api/agencies/${agencyId}`, headers: { authorization: `Bearer ${actor}` }, body: JSON.stringify(body) }),
    verify: () => load(new URL('../netlify/functions/_auth.cjs', import.meta.url)).verifyAuth({ headers: { authorization: 'Bearer user' } }),
    editUser: body => load(new URL('../netlify/functions/admin-api.cjs', import.meta.url)).handler({ httpMethod: 'PATCH', path: '/.netlify/functions/admin-api/users/user', headers: { authorization: 'Bearer admin' }, body: JSON.stringify(body) }),
    patch: active => load(new URL('../netlify/functions/admin-api.cjs', import.meta.url)).handler({ httpMethod: 'PATCH', path: '/.netlify/functions/admin-api/users/user', headers: { authorization: 'Bearer admin' }, body: JSON.stringify({ active }) }),
  };
}

