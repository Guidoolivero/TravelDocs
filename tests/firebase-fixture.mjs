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
  const added = [];
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
    async getUsers(ids) { if (ids.length > 100) throw new Error('auth/maximum-user-count-exceeded'); return { users: ids.filter(({ uid }) => accounts.has(uid)).map(({ uid }) => ({ uid, ...structuredClone(accounts.get(uid)) })), notFound: [] }; },
    async getUserByEmail(email) {
      const entry = [...accounts].find(([, account]) => account.email === email);
      if (!entry) throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
      return { uid: entry[0], ...structuredClone(entry[1]) };
    },
    async updateUser(uid, patch) { calls.push(['updateUser', uid, patch]); Object.assign(accounts.get(uid), patch); },
    async setCustomUserClaims(uid, claims) { calls.push(['claims', uid, claims]); accounts.get(uid).customClaims = structuredClone(claims); },
    async revokeRefreshTokens(uid) { calls.push(['revoke', uid]); },
    async deleteUser(uid) { calls.push(['deleteUser', uid]); accounts.delete(uid); },
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
        return { id: path.split('/').at(-1), ref: ref(path), exists: docs.has(path), data: () => {
          const value = structuredClone(data);
          if (value?.expiresAt instanceof Date) value.expiresAt = { toMillis: () => data.expiresAt.getTime() };
          return value;
        } };
      },
      async set(value, options) { docs.set(path, mergeFields(options?.merge ? docs.get(path) : {}, value)); },
      async update(value) { docs.set(path, mergeFields(docs.get(path), value)); },
      async delete() { docs.delete(path); },
      async add(value) { added.push([path, structuredClone(value)]); },
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
      if (id.endsWith('/_sentry.cjs')) return modules._sentry || { wrapHandler: fn => fn, reportError: async () => {} };
      if (Object.hasOwn(modules, id)) return modules[id];
      const mocked = Object.keys(modules).find(key => key.startsWith('.') && new URL(key, new URL('../netlify/functions/', import.meta.url)).href === new URL(id, url).href);
      if (mocked) return modules[mocked];
      return id.startsWith('.') && !id.endsWith('.mjs') ? load(new URL(id, url)) : nativeRequire(id);
    };
    runInNewContext(readFileSync(url, 'utf8'), { require, module, exports: module.exports, console, Date: TestDate, setTimeout, clearTimeout, AbortController, AbortSignal, Buffer, URL, Response, fetch: globalThis.fetch,
      process: { env: { FIREBASE_SERVICE_ACCOUNT: '{}', PLATFORM_SUPER_ADMIN_EMAILS: 'admin@test.com', ...env } } }, { filename: url.pathname });
    return module.exports;
  }
  // Llama la entrada v2 con un Request y devuelve la respuesta con la forma que leen los tests.
  async function call(name, path, body, actor, method, query = {}) {
    const url = new URL(`https://test.local/.netlify/functions/${name}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const res = await load(new URL(`../netlify/functions/${name}.cjs`, import.meta.url)).default(new Request(url, {
      method, headers: { authorization: `Bearer ${actor}` }, body: method === 'GET' ? undefined : JSON.stringify(body),
    }));
    return { statusCode: res.status, headers: Object.fromEntries(res.headers), body: await res.text() };
  }
  return {
    docs, calls, added, sdkAuth, tokens, accounts, clock,
    recordUsage: body => load(new URL('../netlify/functions/_usage.cjs', import.meta.url)).recordUsage(body),
    request: (path, body, method = 'GET', query = {}) => call('admin-api', path, body, 'admin', method, query),
    invoke: (name, body = {}, actor = 'admin', httpMethod = 'POST') => call(name, '', body, actor, httpMethod),
    agency: (agencyId, body, actor = 'admin') => call('admin-api', `/agencies/${agencyId}`, body, actor, 'PATCH'),
    verify: () => load(new URL('../netlify/functions/_auth.cjs', import.meta.url)).verifyAuth({ headers: { authorization: 'Bearer user' } }),
    editUser: body => call('admin-api', '/users/user', body, 'admin', 'PATCH'),
    patch: active => call('admin-api', '/users/user', { active }, 'admin', 'PATCH'),
  };
}

