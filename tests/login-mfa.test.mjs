import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Se prueba el evento de Auth del modulo real; Firebase y el DOM son los bordes simulados.
function loginFixture(secondFactor) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', disabled: false, style: {}, classList: { add() {}, remove() {} }, listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } });
    return elements.get(id);
  }
  const calls = { signOut: 0, agencyRead: 0 };
  const user = { uid: 'user', email: 'user@test.com', getIdTokenResult: async () => ({ claims: { firebase: secondFactor ? { sign_in_second_factor: secondFactor } : {} } }), getIdToken: async () => 'token' };
  const window = { location: { search: '', pathname: '/login.html', href: '/login.html' }, history: { replaceState() {} } };
  let authChanged;
  const source = readFileSync(new URL('../public/js/login.js', import.meta.url), 'utf8').replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\n/gm, '');
  runInNewContext(source, {
    initializeApp: () => ({}), FIREBASE_CONFIG: {}, REQUIRE_2FA: true, getAuth: () => ({}), initDB() {},
    onAuthStateChanged: (_, fn) => { authChanged = fn; }, multiFactor: () => ({ enrolledFactors: [{ factorId: 'totp' }] }),
    signOut: async () => { calls.signOut++; }, getStoredAgencyId: () => null, clearStoredAgencyId() {}, storeAgencyId() {}, applyBranding() {},
    getUserAgency: async () => 'agency', getAgency: async () => { calls.agencyRead++; return { status: 'active' }; },
    document: { getElementById: element }, window, sessionStorage: { setItem() {} }, URLSearchParams, console,
  });
  return { calls, window, element, authenticate: () => authChanged(user) };
}

test('login con factor enrolado pero sesion sin MFA vuelve al formulario antes de leer la agencia', async () => {
  const f = loginFixture();
  await f.authenticate();
  assert.equal(f.calls.signOut, 1);
  assert.equal(f.calls.agencyRead, 0);
  assert.equal(f.window.location.href, '/login.html');
});
test('login con sesion TOTP valida accede a su agencia', async () => {
  const f = loginFixture('totp');
  await f.authenticate();
  assert.equal(f.calls.signOut, 0);
  assert.equal(f.calls.agencyRead, 1);
  assert.equal(f.window.location.href, './index.html');
});
